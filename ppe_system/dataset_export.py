from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

from .schemas import DetectionBox, FrameComplianceResult


CLASS_TO_INDEX = {
    "person": 0,
    "helmet": 1,
    "vest": 2,
    "gloves": 3,
    "mask": 4,
    "no_helmet": 5,
    "no_vest": 6,
    "no_gloves": 7,
    "no_mask": 8,
}


@dataclass(slots=True)
class DatasetPaths:
    root: Path
    images: Path
    labels: Path
    masks: Path


def ensure_dataset_dirs(root: str | Path = "dataset") -> DatasetPaths:
    root_path = Path(root)
    images = root_path / "images"
    labels = root_path / "labels"
    masks = root_path / "masks"

    images.mkdir(parents=True, exist_ok=True)
    labels.mkdir(parents=True, exist_ok=True)
    masks.mkdir(parents=True, exist_ok=True)

    return DatasetPaths(root=root_path, images=images, labels=labels, masks=masks)


class DatasetExporter:
    def __init__(self, root: str | Path = "dataset"):
        self.paths = ensure_dataset_dirs(root)

    def save_frame(self, frame, result: FrameComplianceResult) -> dict[str, str]:
        base_name = f"frame_{result.frame_index:06d}"
        image_path = self.paths.images / f"{base_name}.jpg"
        label_path = self.paths.labels / f"{base_name}.txt"

        cv2.imwrite(str(image_path), frame, [int(cv2.IMWRITE_JPEG_QUALITY), 95])

        mask_paths = []
        label_lines = []
        for index, detection in enumerate(result.detections):
            class_index = CLASS_TO_INDEX.get(detection.canonical_label)
            if class_index is None:
                continue

            polygon = detection_to_polygon(detection, frame.shape[1], frame.shape[0])
            if len(polygon) < 6:
                continue

            label_lines.append(
                " ".join(
                    [str(class_index)] + [f"{value:.6f}" for value in polygon]
                )
            )

            if detection.mask is not None:
                mask_path = self.paths.masks / f"{base_name}_{index:02d}_{detection.canonical_label}.png"
                mask_image = (detection.mask.astype(np.uint8)) * 255
                cv2.imwrite(str(mask_path), mask_image)
                mask_paths.append(str(mask_path))

        label_path.write_text("\n".join(label_lines), encoding="utf-8")
        return {
            "image": str(image_path),
            "label": str(label_path),
            "masks": mask_paths,
        }


def detection_to_polygon(
    detection: DetectionBox,
    image_width: int,
    image_height: int,
) -> list[float]:
    if detection.mask is not None:
        polygon = mask_to_yolo_polygon(detection.mask, image_width, image_height)
        if polygon:
            return polygon

    x1, y1, x2, y2 = detection.bbox
    return normalize_polygon(
        [x1, y1, x2, y1, x2, y2, x1, y2],
        image_width,
        image_height,
    )


def mask_to_yolo_polygon(mask: np.ndarray, image_width: int, image_height: int) -> list[float]:
    mask_image = (mask.astype(np.uint8)) * 255
    contours, _ = cv2.findContours(mask_image, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return []

    contour = max(contours, key=cv2.contourArea)
    if cv2.contourArea(contour) < 4:
        return []

    epsilon = 0.002 * cv2.arcLength(contour, True)
    simplified = cv2.approxPolyDP(contour, epsilon, True)
    flattened = simplified.reshape(-1, 2).astype(float).flatten().tolist()
    if len(flattened) < 6:
        return []

    return normalize_polygon(flattened, image_width, image_height)


def normalize_polygon(points: list[float], image_width: int, image_height: int) -> list[float]:
    normalized = []
    for index, value in enumerate(points):
        if index % 2 == 0:
            normalized.append(min(max(value / max(image_width, 1), 0.0), 1.0))
        else:
            normalized.append(min(max(value / max(image_height, 1), 0.0), 1.0))
    return normalized
