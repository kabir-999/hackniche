from __future__ import annotations

import os
import tempfile
from copy import copy
from pathlib import Path

import cv2
import numpy as np
import torch
from PIL import Image

os.environ.setdefault("MPLCONFIGDIR", str(Path(tempfile.gettempdir()) / "matplotlib"))

from .config import SamConfig
from .schemas import DetectionBox


def _move_batch_to_device(batch: dict, device: str) -> dict:
    moved = {}
    for key, value in batch.items():
        moved[key] = value.to(device) if hasattr(value, "to") else value
    return moved


def _prepare_boxes(detections: list[DetectionBox]) -> list[list[float]]:
    return [[float(x1), float(y1), float(x2), float(y2)] for x1, y1, x2, y2 in (d.bbox for d in detections)]


def _mask_tensor_to_numpy(mask_tensor) -> np.ndarray:
    if hasattr(mask_tensor, "detach"):
        return mask_tensor.detach().cpu().numpy().astype(bool)
    return np.asarray(mask_tensor).astype(bool)


def run_sam_segmentation(frame, detections: list[DetectionBox], segmenter: "SamSegmenter | None") -> list[DetectionBox]:
    if segmenter is None or not detections:
        return detections
    return segmenter.segment(frame, detections)


class SamSegmenter:
    def __init__(self, config: SamConfig, device: str):
        self.config = config
        self.device = device
        self.processor = None
        self.model = None

        if not config.enabled:
            return

        from transformers import SamModel, SamProcessor

        load_kwargs = {"local_files_only": config.local_files_only}
        try:
            self.processor = SamProcessor.from_pretrained(config.model_id, **load_kwargs)
            self.model = SamModel.from_pretrained(config.model_id, **load_kwargs)
        except OSError as exc:
            raise RuntimeError(
                f"Unable to load SAM model '{config.model_id}'. "
                "Ensure internet access for the first download or pre-cache the model locally. "
                "You can temporarily disable SAM with `--disable-sam`."
            ) from exc

        self.model.to(device)
        self.model.eval()

    def segment(self, frame, detections: list[DetectionBox]) -> list[DetectionBox]:
        if self.processor is None or self.model is None or not detections:
            return detections

        limited_detections = sorted(detections, key=lambda detection: detection.confidence, reverse=True)[
            : self.config.max_detections_per_frame
        ]
        passthrough_ids = {id(detection) for detection in limited_detections}

        image = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
        inputs = self.processor(
            images=image,
            input_boxes=[_prepare_boxes(limited_detections)],
            return_tensors="pt",
        )
        original_sizes = inputs["original_sizes"]
        reshaped_input_sizes = inputs["reshaped_input_sizes"]
        inputs = _move_batch_to_device(inputs, self.device)

        with torch.no_grad():
            outputs = self.model(**inputs, multimask_output=self.config.multimask_output)

        masks = self.processor.image_processor.post_process_masks(
            outputs.pred_masks.cpu(),
            original_sizes.cpu(),
            reshaped_input_sizes.cpu(),
            mask_threshold=self.config.mask_threshold,
        )
        iou_scores = outputs.iou_scores.detach().cpu()
        segmented_by_key: dict[tuple[str, float, tuple[float, float, float, float]], DetectionBox] = {}

        if masks:
            processed_masks = masks[0]
            if processed_masks.ndim == 4:
                processed_masks = processed_masks[:, 0, :, :]

            for index, detection in enumerate(limited_detections):
                segmented = copy(detection)
                mask_array = _mask_tensor_to_numpy(processed_masks[index])
                segmented.mask = mask_array
                segmented.mask_area = int(mask_array.sum())
                if iou_scores.ndim >= 3:
                    segmented.iou_score = float(iou_scores[0, index, 0].item())
                elif iou_scores.ndim == 2:
                    segmented.iou_score = float(iou_scores[0, index].item())
                else:
                    segmented.iou_score = float(iou_scores[index].item())
                segmented_by_key[(segmented.label, segmented.confidence, segmented.bbox)] = segmented

        updated_detections = []
        for detection in detections:
            if id(detection) in passthrough_ids:
                updated_detections.append(
                    segmented_by_key.get((detection.label, detection.confidence, detection.bbox), detection)
                )
            else:
                updated_detections.append(detection)

        return updated_detections
