from __future__ import annotations

import argparse
import random
import shutil
from dataclasses import dataclass
from pathlib import Path

import cv2
import yaml
from ultralytics import YOLO

from ppe_system.config import DetectorConfig, SamConfig
from ppe_system.dataset_export import detection_to_polygon
from ppe_system.detection import YoloPpeDetector, resolve_device, run_yolo_detection
from ppe_system.schemas import DetectionBox
from ppe_system.segmentation import SamSegmenter, run_sam_segmentation


TRAIN_CLASS_NAMES = ("person", "helmet", "vest", "gloves", "mask")
TRAIN_CLASS_TO_INDEX = {name: idx for idx, name in enumerate(TRAIN_CLASS_NAMES)}

MIN_CONFIDENCE = {
    "person": 0.35,
    "helmet": 0.52,
    "vest": 0.48,
    "gloves": 0.48,
    "mask": 0.52,
}

MAX_ITEMS_PER_PERSON = {
    "helmet": 1,
    "vest": 1,
    "gloves": 2,
    "mask": 1,
}


@dataclass(slots=True)
class GeneratedSample:
    image_path: Path
    label_lines: list[str]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Auto-generate pixel labels with YOLO + SAM and train YOLO segmentation for Three.js PPE."
    )
    parser.add_argument(
        "--source-dir",
        default="dataset/annotated",
        help="Directory containing source JPG/PNG frames.",
    )
    parser.add_argument(
        "--model",
        default="best.pt",
        help="Teacher YOLO model for pseudo-label generation.",
    )
    parser.add_argument(
        "--student-model",
        default="yolov8n-seg.pt",
        help="Student segmentation model to fine-tune.",
    )
    parser.add_argument(
        "--output-dir",
        default="dataset/auto_seg",
        help="Output dataset root containing YOLO-seg split and labels.",
    )
    parser.add_argument("--epochs", type=int, default=20, help="Segmentation training epochs.")
    parser.add_argument("--batch", type=int, default=8, help="Training batch size.")
    parser.add_argument("--imgsz", type=int, default=640, help="Training image size.")
    parser.add_argument("--val-ratio", type=float, default=0.2, help="Validation split ratio.")
    parser.add_argument("--seed", type=int, default=42, help="Random seed for split.")
    parser.add_argument(
        "--device",
        default="auto",
        help="Training device (`auto`, `cpu`, `0`, etc.).",
    )
    parser.add_argument(
        "--sam-local-files-only",
        action="store_true",
        help="Load SAM from local cache only (no internet download).",
    )
    parser.add_argument(
        "--skip-training",
        action="store_true",
        help="Only generate pseudo-label dataset and stop before model training.",
    )
    return parser.parse_args()


def box_area(box: tuple[float, float, float, float]) -> float:
    x1, y1, x2, y2 = box
    return max(0.0, x2 - x1) * max(0.0, y2 - y1)


def box_iou(box_a: tuple[float, float, float, float], box_b: tuple[float, float, float, float]) -> float:
    ax1, ay1, ax2, ay2 = box_a
    bx1, by1, bx2, by2 = box_b
    inter_x1 = max(ax1, bx1)
    inter_y1 = max(ay1, by1)
    inter_x2 = min(ax2, bx2)
    inter_y2 = min(ay2, by2)
    if inter_x2 <= inter_x1 or inter_y2 <= inter_y1:
        return 0.0
    inter = (inter_x2 - inter_x1) * (inter_y2 - inter_y1)
    union = box_area(box_a) + box_area(box_b) - inter
    return inter / max(union, 1e-6)


def box_center(box: tuple[float, float, float, float]) -> tuple[float, float]:
    x1, y1, x2, y2 = box
    return (0.5 * (x1 + x2), 0.5 * (y1 + y2))


def expand_box(box: tuple[float, float, float, float], ratio: float) -> tuple[float, float, float, float]:
    x1, y1, x2, y2 = box
    width = x2 - x1
    height = y2 - y1
    pad_x = width * ratio
    pad_y = height * ratio
    return (x1 - pad_x, y1 - pad_y, x2 + pad_x, y2 + pad_y)


def point_in_box(point: tuple[float, float], box: tuple[float, float, float, float]) -> bool:
    x, y = point
    x1, y1, x2, y2 = box
    return x1 <= x <= x2 and y1 <= y <= y2


def find_best_person_match(
    detection: DetectionBox,
    people: list[DetectionBox],
    context_padding: float = 0.18,
) -> tuple[int, DetectionBox] | None:
    center = box_center(detection.bbox)
    best_match: tuple[int, DetectionBox] | None = None
    best_distance = float("inf")

    for index, person in enumerate(people):
        context_box = expand_box(person.bbox, context_padding)
        if not point_in_box(center, context_box):
            continue
        person_center = box_center(person.bbox)
        distance = ((center[0] - person_center[0]) ** 2 + (center[1] - person_center[1]) ** 2) ** 0.5
        if distance < best_distance:
            best_distance = distance
            best_match = (index, person)

    return best_match


def is_plausible_on_person(
    detection: DetectionBox,
    person: DetectionBox,
) -> bool:
    px1, py1, px2, py2 = person.bbox
    person_w = max(1e-6, px2 - px1)
    person_h = max(1e-6, py2 - py1)
    person_area = max(1e-6, box_area(person.bbox))
    center_x, center_y = box_center(detection.bbox)
    rel_x = (center_x - px1) / person_w
    rel_y = (center_y - py1) / person_h
    area_ratio = box_area(detection.bbox) / person_area
    label = detection.canonical_label

    if label == "helmet":
        return 0.12 <= rel_x <= 0.88 and -0.03 <= rel_y <= 0.44 and 0.004 <= area_ratio <= 0.22
    if label == "vest":
        return 0.07 <= rel_x <= 0.93 and 0.18 <= rel_y <= 0.88 and 0.03 <= area_ratio <= 0.72
    if label == "mask":
        return 0.18 <= rel_x <= 0.82 and 0.02 <= rel_y <= 0.58 and 0.001 <= area_ratio <= 0.12
    if label == "gloves":
        side_ok = rel_x <= 0.34 or rel_x >= 0.66
        return side_ok and 0.30 <= rel_y <= 1.04 and 0.001 <= area_ratio <= 0.12
    return False


def filter_pseudo_labels(
    frame,
    people: list[DetectionBox],
    ppe_detections: list[DetectionBox],
) -> list[DetectionBox]:
    filtered_people = [
        detection
        for detection in people
        if detection.canonical_label == "person" and detection.confidence >= MIN_CONFIDENCE["person"]
    ]
    frame_hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)

    def mask_color_fraction(mask, ranges: list[tuple[tuple[int, int, int], tuple[int, int, int]]]) -> float:
        if mask is None or int(mask.sum()) <= 0:
            return 0.0
        points = frame_hsv[mask]
        if points.size == 0:
            return 0.0
        matched = 0
        for lower, upper in ranges:
            lower_arr = lower
            upper_arr = upper
            in_range = (
                (points[:, 0] >= lower_arr[0])
                & (points[:, 0] <= upper_arr[0])
                & (points[:, 1] >= lower_arr[1])
                & (points[:, 1] <= upper_arr[1])
                & (points[:, 2] >= lower_arr[2])
                & (points[:, 2] <= upper_arr[2])
            )
            matched = max(matched, int(in_range.sum()))
        return matched / max(len(points), 1)

    def passes_color_guard(detection: DetectionBox) -> bool:
        if detection.mask is None:
            return False
        if detection.canonical_label == "helmet":
            yellow_ratio = mask_color_fraction(
                detection.mask,
                [((15, 80, 80), (42, 255, 255))],
            )
            return yellow_ratio >= 0.12
        if detection.canonical_label == "vest":
            green_ratio = mask_color_fraction(
                detection.mask,
                [((36, 60, 60), (92, 255, 255))],
            )
            return green_ratio >= 0.12
        return True

    accepted: list[tuple[int, DetectionBox]] = []
    for detection in ppe_detections:
        label = detection.canonical_label
        if label not in TRAIN_CLASS_TO_INDEX:
            continue
        if detection.confidence < MIN_CONFIDENCE.get(label, 0.5):
            continue
        if detection.mask is None or detection.mask_area < 16:
            continue
        if not passes_color_guard(detection):
            continue

        matched = find_best_person_match(detection, filtered_people, context_padding=0.18)
        if matched is None and filtered_people:
            continue

        if matched is not None:
            person_index, person_detection = matched
            if not is_plausible_on_person(detection, person_detection):
                continue
        else:
            if label not in {"helmet", "vest"}:
                continue
            person_index = -1

        accepted.append((person_index, detection))

    deduped_ppe: list[DetectionBox] = []
    grouped: dict[tuple[int, str], list[DetectionBox]] = {}
    for person_index, detection in accepted:
        grouped.setdefault((person_index, detection.canonical_label), []).append(detection)

    for (person_index, label), detections in grouped.items():
        limit = MAX_ITEMS_PER_PERSON.get(label, 1)
        kept = sorted(detections, key=lambda item: item.confidence, reverse=True)[:limit]
        deduped_ppe.extend(kept)

    return [*filtered_people, *deduped_ppe]


def build_color_mask_detections(frame) -> list[DetectionBox]:
    frame_h, frame_w = frame.shape[:2]
    frame_area = float(frame_h * frame_w)
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    kernels = {
        "helmet": cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)),
        "vest": cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5)),
    }
    masks = {
        "helmet": cv2.inRange(hsv, (15, 90, 80), (42, 255, 255)),
        "vest": cv2.inRange(hsv, (36, 55, 55), (92, 255, 255)),
    }
    detections: list[DetectionBox] = []

    for label, binary in masks.items():
        cleaned = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernels[label], iterations=1)
        cleaned = cv2.morphologyEx(cleaned, cv2.MORPH_CLOSE, kernels[label], iterations=2)
        contours, _ = cv2.findContours(cleaned, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for contour in contours:
            contour_area = float(cv2.contourArea(contour))
            if contour_area < 22:
                continue
            x, y, w, h = cv2.boundingRect(contour)
            if w <= 0 or h <= 0:
                continue
            area_ratio = contour_area / frame_area
            fill_ratio = contour_area / max(float(w * h), 1.0)
            aspect = w / max(float(h), 1.0)

            if label == "helmet":
                if not (0.00004 <= area_ratio <= 0.014):
                    continue
                if not (0.45 <= aspect <= 2.2):
                    continue
                if fill_ratio < 0.22:
                    continue
            if label == "vest":
                if not (0.00009 <= area_ratio <= 0.05):
                    continue
                if not (0.28 <= aspect <= 2.9):
                    continue
                if fill_ratio < 0.18:
                    continue
                if h > frame_h * 0.45 or w > frame_w * 0.3:
                    continue

            obj_mask = cv2.drawContours(
                image=cv2.cvtColor(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY), cv2.COLOR_GRAY2BGR)[:, :, 0] * 0,
                contours=[contour],
                contourIdx=-1,
                color=1,
                thickness=cv2.FILLED,
            ).astype(bool)
            detections.append(
                DetectionBox(
                    label=label,
                    canonical_label=label,
                    confidence=0.73 if label == "helmet" else 0.68,
                    bbox=(float(x), float(y), float(x + w), float(y + h)),
                    mask=obj_mask,
                    mask_area=int(obj_mask.sum()),
                )
            )

    return detections


def dedupe_detections(detections: list[DetectionBox], iou_threshold: float = 0.72) -> list[DetectionBox]:
    deduped: list[DetectionBox] = []
    by_label: dict[str, list[DetectionBox]] = {}
    for detection in sorted(detections, key=lambda item: item.confidence, reverse=True):
        bucket = by_label.setdefault(detection.canonical_label, [])
        if any(box_iou(detection.bbox, existing.bbox) >= iou_threshold for existing in bucket):
            continue
        bucket.append(detection)
        deduped.append(detection)
    return deduped


def iter_image_paths(source_dir: Path) -> list[Path]:
    extensions = ("*.jpg", "*.jpeg", "*.png", "*.bmp", "*.webp")
    image_paths: list[Path] = []
    for pattern in extensions:
        image_paths.extend(source_dir.glob(pattern))
    return sorted(image_paths)


def detections_to_yolo_seg_lines(
    detections: list[DetectionBox],
    image_width: int,
    image_height: int,
) -> list[str]:
    lines: list[str] = []
    for detection in detections:
        class_index = TRAIN_CLASS_TO_INDEX.get(detection.canonical_label)
        if class_index is None:
            continue
        polygon = detection_to_polygon(detection, image_width, image_height)
        if len(polygon) < 6:
            continue
        lines.append(" ".join([str(class_index)] + [f"{value:.6f}" for value in polygon]))
    return lines


def build_pseudo_dataset(
    source_dir: Path,
    output_dir: Path,
    teacher_model_path: str,
    device: str,
    sam_local_files_only: bool,
    val_ratio: float,
    seed: int,
) -> tuple[Path, int]:
    if not source_dir.exists():
        raise FileNotFoundError(f"Source directory not found: {source_dir}")

    detector_config = DetectorConfig(
        model_path=teacher_model_path,
        confidence=0.35,
        person_confidence=0.42,
        device=device,
    )
    resolved_device = resolve_device(detector_config.device)
    detector = YoloPpeDetector(detector_config)
    sam_segmenter = SamSegmenter(
        SamConfig(
            enabled=True,
            local_files_only=sam_local_files_only,
            segment_person_boxes=True,
            segment_ppe_boxes=True,
            max_detections_per_frame=48,
        ),
        resolved_device,
    )

    image_paths = iter_image_paths(source_dir)
    if not image_paths:
        raise RuntimeError(f"No images found in {source_dir}")

    samples: list[GeneratedSample] = []
    for image_path in image_paths:
        frame = cv2.imread(str(image_path))
        if frame is None:
            continue

        people, ppe = run_yolo_detection(frame, detector)
        segmented_people = run_sam_segmentation(frame, people, sam_segmenter)
        segmented_ppe = run_sam_segmentation(frame, ppe, sam_segmenter)
        filtered = filter_pseudo_labels(frame, segmented_people, segmented_ppe)
        color_fallback = build_color_mask_detections(frame)
        if filtered:
            filtered = dedupe_detections([*filtered, *color_fallback], iou_threshold=0.72)
        else:
            filtered = dedupe_detections(color_fallback, iou_threshold=0.72)
        label_lines = detections_to_yolo_seg_lines(filtered, frame.shape[1], frame.shape[0])
        if not label_lines:
            continue

        samples.append(
            GeneratedSample(
                image_path=image_path,
                label_lines=label_lines,
            )
        )

    if not samples:
        raise RuntimeError("Pseudo-label generation produced zero usable samples.")

    if output_dir.exists():
        shutil.rmtree(output_dir)
    (output_dir / "images" / "train").mkdir(parents=True, exist_ok=True)
    (output_dir / "images" / "val").mkdir(parents=True, exist_ok=True)
    (output_dir / "labels" / "train").mkdir(parents=True, exist_ok=True)
    (output_dir / "labels" / "val").mkdir(parents=True, exist_ok=True)

    random.Random(seed).shuffle(samples)

    if len(samples) == 1:
        single = samples[0]
        for split in ("train", "val"):
            out_image = output_dir / "images" / split / single.image_path.name
            out_label = output_dir / "labels" / split / f"{single.image_path.stem}.txt"
            shutil.copy2(single.image_path, out_image)
            out_label.write_text("\n".join(single.label_lines), encoding="utf-8")
    else:
        val_count = max(1, int(len(samples) * val_ratio))
        if val_count >= len(samples):
            val_count = len(samples) - 1
        val_set = set(id(sample) for sample in samples[:val_count])

        for sample in samples:
            split = "val" if id(sample) in val_set else "train"
            out_image = output_dir / "images" / split / sample.image_path.name
            out_label = output_dir / "labels" / split / f"{sample.image_path.stem}.txt"
            shutil.copy2(sample.image_path, out_image)
            out_label.write_text("\n".join(sample.label_lines), encoding="utf-8")

    data_yaml = output_dir / "data.yaml"
    yaml_payload = {
        "path": str(output_dir.resolve()),
        "train": "images/train",
        "val": "images/val",
        "names": {idx: name for idx, name in enumerate(TRAIN_CLASS_NAMES)},
    }
    data_yaml.write_text(yaml.safe_dump(yaml_payload, sort_keys=False), encoding="utf-8")
    return data_yaml, len(samples)


def train_model(
    student_model: str,
    data_yaml: Path,
    epochs: int,
    imgsz: int,
    batch: int,
    device: str,
) -> Path:
    student = YOLO(student_model)
    result = student.train(
        data=str(data_yaml),
        task="segment",
        epochs=epochs,
        imgsz=imgsz,
        batch=batch,
        device=resolve_device(device),
        patience=20,
        project="outputs/seg_train",
        name="threejs_ppe_seg",
        exist_ok=True,
        workers=2,
        pretrained=True,
        cache=False,
    )
    save_dir = Path(result.save_dir)
    return save_dir / "weights" / "best.pt"


def main() -> int:
    args = parse_args()
    source_dir = Path(args.source_dir).expanduser()
    output_dir = Path(args.output_dir).expanduser()
    model_path = str(Path(args.model).expanduser())

    data_yaml, sample_count = build_pseudo_dataset(
        source_dir=source_dir,
        output_dir=output_dir,
        teacher_model_path=model_path,
        device=args.device,
        sam_local_files_only=args.sam_local_files_only,
        val_ratio=args.val_ratio,
        seed=args.seed,
    )
    print(f"Generated pseudo-labeled segmentation dataset with {sample_count} samples at {output_dir}")
    print(f"Data config: {data_yaml}")

    if args.skip_training:
        print("Skipped model training because --skip-training was set.")
        return 0

    best_path = train_model(
        student_model=args.student_model,
        data_yaml=data_yaml,
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        device=args.device,
    )
    print(f"Training complete. Best segmentation model: {best_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
