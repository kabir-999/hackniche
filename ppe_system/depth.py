from __future__ import annotations

from base64 import b64encode
from dataclasses import dataclass

import cv2
import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image

from .config import DepthConfig


def _move_batch_to_device(batch: dict, device: str) -> dict:
    moved = {}
    for key, value in batch.items():
        moved[key] = value.to(device) if hasattr(value, "to") else value
    return moved


@dataclass(slots=True)
class DepthResult:
    preview_data_url: str | None
    min_depth: float
    max_depth: float
    mean_depth: float

    def to_dict(self) -> dict:
        return {
            "preview": self.preview_data_url,
            "min_depth": self.min_depth,
            "max_depth": self.max_depth,
            "mean_depth": self.mean_depth,
        }


class MidasDepthEstimator:
    def __init__(self, config: DepthConfig, device: str):
        self.config = config
        self.device = device
        self.processor = None
        self.model = None

        if not config.enabled:
            return

        from transformers import AutoImageProcessor, AutoModelForDepthEstimation

        load_kwargs = {"local_files_only": config.local_files_only}
        try:
            self.processor = AutoImageProcessor.from_pretrained(config.model_id, **load_kwargs)
            self.model = AutoModelForDepthEstimation.from_pretrained(config.model_id, **load_kwargs)
        except OSError as exc:
            raise RuntimeError(
                f"Unable to load MiDaS depth model '{config.model_id}'. "
                "Ensure internet access for the first download or pre-cache it locally."
            ) from exc

        self.model.to(device)
        self.model.eval()

    def estimate(
        self,
        frame: np.ndarray,
        person_boxes: list[tuple[int, int, int, int]] | None = None,
    ) -> DepthResult | None:
        if self.processor is None or self.model is None:
            return None

        resized_frame = self._resize_frame(frame)
        rgb = cv2.cvtColor(resized_frame, cv2.COLOR_BGR2RGB)
        image = Image.fromarray(rgb)
        inputs = self.processor(images=image, return_tensors="pt")
        inputs = _move_batch_to_device(inputs, self.device)

        with torch.no_grad():
            outputs = self.model(**inputs)
            predicted_depth = outputs.predicted_depth

        depth = F.interpolate(
            predicted_depth.unsqueeze(1),
            size=resized_frame.shape[:2],
            mode="bicubic",
            align_corners=False,
        ).squeeze()
        depth_map = depth.detach().cpu().numpy()
        finite_mask = np.isfinite(depth_map)
        if not np.any(finite_mask):
            return DepthResult(preview_data_url=None, min_depth=0.0, max_depth=0.0, mean_depth=0.0)

        valid_values = depth_map[finite_mask]
        min_depth = float(valid_values.min())
        max_depth = float(valid_values.max())
        mean_depth = float(valid_values.mean())

        near_clip = float(np.percentile(valid_values, 2.0))
        far_clip = float(np.percentile(valid_values, 98.0))
        normalized = np.clip((depth_map - near_clip) / max(far_clip - near_clip, 1e-6), 0.0, 1.0)

        # MiDaS returns relative depth, so invert here to make closer surfaces brighter.
        depth_brightness = ((1.0 - normalized) * 255.0).astype(np.uint8)
        depth_brightness = cv2.GaussianBlur(depth_brightness, (0, 0), 1.2)
        composite_bgr = self._render_people_only_depth(
            depth_brightness=depth_brightness,
            resized_shape=resized_frame.shape[:2],
            original_shape=frame.shape[:2],
            person_boxes=person_boxes or [],
        )

        preview = self._encode_preview(composite_bgr)
        return DepthResult(
            preview_data_url=preview,
            min_depth=min_depth,
            max_depth=max_depth,
            mean_depth=mean_depth,
        )

    def _render_people_only_depth(
        self,
        depth_brightness: np.ndarray,
        resized_shape: tuple[int, int],
        original_shape: tuple[int, int],
        person_boxes: list[tuple[int, int, int, int]],
    ) -> np.ndarray:
        canvas = np.zeros((*resized_shape, 3), dtype=np.uint8)
        if not person_boxes:
            return canvas

        resized_h, resized_w = resized_shape
        original_h, original_w = original_shape
        scale_x = resized_w / max(float(original_w), 1.0)
        scale_y = resized_h / max(float(original_h), 1.0)
        mask = np.zeros((resized_h, resized_w), dtype=np.uint8)

        for x1, y1, x2, y2 in person_boxes:
            rx1 = max(0, min(resized_w - 1, int(round(x1 * scale_x))))
            ry1 = max(0, min(resized_h - 1, int(round(y1 * scale_y))))
            rx2 = max(0, min(resized_w, int(round(x2 * scale_x))))
            ry2 = max(0, min(resized_h, int(round(y2 * scale_y))))
            if rx2 <= rx1 or ry2 <= ry1:
                continue

            width = rx2 - rx1
            height = ry2 - ry1
            center = (rx1 + width // 2, ry1 + height // 2)
            axes = (
                max(6, int(width * 0.34)),
                max(10, int(height * 0.52)),
            )
            cv2.ellipse(mask, center, axes, 0, 0, 360, 255, thickness=-1)

        if not np.any(mask):
            return canvas

        mask = cv2.GaussianBlur(mask, (0, 0), 2.2)
        people_depth = cv2.bitwise_and(depth_brightness, depth_brightness, mask=mask)
        people_depth = cv2.equalizeHist(people_depth)
        colorized = cv2.applyColorMap(people_depth, cv2.COLORMAP_PLASMA)
        canvas[mask > 0] = colorized[mask > 0]
        return canvas

    def _resize_frame(self, frame: np.ndarray) -> np.ndarray:
        height, width = frame.shape[:2]
        largest_side = max(height, width)
        if largest_side <= self.config.max_frame_side:
            return frame
        scale = self.config.max_frame_side / float(largest_side)
        resized_size = (max(1, int(round(width * scale))), max(1, int(round(height * scale))))
        return cv2.resize(frame, resized_size, interpolation=cv2.INTER_AREA)

    def _encode_preview(self, depth_frame: np.ndarray) -> str | None:
        success, encoded = cv2.imencode(".jpg", depth_frame, [int(cv2.IMWRITE_JPEG_QUALITY), 48])
        if not success:
            return None
        return f"data:image/jpeg;base64,{b64encode(encoded.tobytes()).decode('utf-8')}"
