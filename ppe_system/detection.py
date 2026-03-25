from __future__ import annotations

from pathlib import Path

import torch
from ultralytics import YOLO

from .config import DetectorConfig
from .schemas import DetectionBox


CLASS_NAME_MAP = {
    "person": "person",
    "worker": "person",
    "hardhat": "helmet",
    "helmet": "helmet",
    "safety_vest": "vest",
    "vest": "vest",
    "gloves": "gloves",
    "mask": "mask",
    "no_hardhat": "no_helmet",
    "no_safety_vest": "no_vest",
    "no_gloves": "no_gloves",
    "no_mask": "no_mask",
}


def normalize_class_name(name: str) -> str:
    normalized = name.strip().lower().replace("-", "_").replace(" ", "_")
    while "__" in normalized:
        normalized = normalized.replace("__", "_")
    return normalized


def resolve_device(requested_device: str) -> str:
    if requested_device != "auto":
        return requested_device
    return "cuda:0" if torch.cuda.is_available() else "cpu"


class YoloPpeDetector:
    def __init__(self, config: DetectorConfig):
        self.config = config
        model_path = Path(config.model_path)
        if not model_path.exists():
            raise FileNotFoundError(f"YOLO model not found at {model_path}")

        self.device = resolve_device(config.device)
        self.model = YOLO(str(model_path))
        self.model.to(self.device)

    def infer(self, frame) -> tuple[list[DetectionBox], list[DetectionBox]]:
        result = self.model.predict(
            source=frame,
            conf=self.config.confidence,
            imgsz=self.config.image_size,
            device=self.device,
            verbose=False,
        )[0]

        people: list[DetectionBox] = []
        ppe: list[DetectionBox] = []
        boxes = result.boxes
        if boxes is None:
            return people, ppe

        names = result.names
        for box in boxes:
            cls_idx = int(box.cls[0].item())
            raw_name = names[cls_idx] if isinstance(names, list) else names.get(cls_idx, str(cls_idx))
            canonical_name = CLASS_NAME_MAP.get(normalize_class_name(raw_name), "")
            if not canonical_name or canonical_name not in self.config.classes_of_interest:
                continue

            confidence = float(box.conf[0].item())
            if canonical_name == "person" and confidence < self.config.person_confidence:
                continue

            x1, y1, x2, y2 = box.xyxy[0].tolist()
            detection = DetectionBox(
                label=raw_name,
                canonical_label=canonical_name,
                confidence=confidence,
                bbox=(x1, y1, x2, y2),
            )
            if canonical_name == "person":
                people.append(detection)
            else:
                ppe.append(detection)

        return people, ppe


def run_yolo_detection(frame, detector: YoloPpeDetector) -> tuple[list[DetectionBox], list[DetectionBox]]:
    return detector.infer(frame)
