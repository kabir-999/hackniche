from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
import math

from .config import ComplianceConfig
from .schemas import AlertEvent, DetectionBox, FrameComplianceResult, TrackBox, WorkerCompliance


POSITIVE_LABELS = {
    "helmet": {"helmet"},
    "vest": {"vest"},
    "gloves": {"gloves"},
    "mask": {"mask"},
}

NEGATIVE_LABELS = {
    "helmet": {"no_helmet"},
    "vest": {"no_vest"},
    "gloves": {"no_gloves"},
    "mask": {"no_mask"},
}


def clamp_box(box: tuple[float, float, float, float]) -> tuple[float, float, float, float]:
    x1, y1, x2, y2 = box
    return (min(x1, x2), min(y1, y2), max(x1, x2), max(y1, y2))


def intersection_area(
    box_a: tuple[float, float, float, float], box_b: tuple[float, float, float, float]
) -> float:
    ax1, ay1, ax2, ay2 = box_a
    bx1, by1, bx2, by2 = box_b
    overlap_x1 = max(ax1, bx1)
    overlap_y1 = max(ay1, by1)
    overlap_x2 = min(ax2, bx2)
    overlap_y2 = min(ay2, by2)
    if overlap_x2 <= overlap_x1 or overlap_y2 <= overlap_y1:
        return 0.0
    return float((overlap_x2 - overlap_x1) * (overlap_y2 - overlap_y1))


def box_area(box: tuple[float, float, float, float]) -> float:
    x1, y1, x2, y2 = box
    return max(0.0, x2 - x1) * max(0.0, y2 - y1)


def point_in_box(point: tuple[float, float], box: tuple[float, float, float, float]) -> bool:
    x, y = point
    x1, y1, x2, y2 = box
    return x1 <= x <= x2 and y1 <= y <= y2


def clamp_region_to_mask(
    region_box: tuple[float, float, float, float],
    mask_shape: tuple[int, int],
) -> tuple[int, int, int, int]:
    height, width = mask_shape
    x1, y1, x2, y2 = region_box
    return (
        max(0, min(width, int(math.floor(x1)))),
        max(0, min(height, int(math.floor(y1)))),
        max(0, min(width, int(math.ceil(x2)))),
        max(0, min(height, int(math.ceil(y2)))),
    )


@dataclass(slots=True)
class TrackState:
    history: deque[dict] = field(default_factory=deque)
    missing_counts: dict[str, int] = field(
        default_factory=lambda: {"helmet": 0, "vest": 0, "gloves": 0, "mask": 0}
    )
    helmet_alert_sent: bool = False
    last_seen_frame: int = 0


class ComplianceEngine:
    def __init__(self, config: ComplianceConfig):
        self.config = config
        self.states: dict[int, TrackState] = {}

    def evaluate_frame(
        self,
        tracks: list[TrackBox],
        ppe_detections: list[DetectionBox],
        frame_index: int,
        timestamp_ms: float,
    ) -> FrameComplianceResult:
        workers: list[WorkerCompliance] = []
        alerts: list[AlertEvent] = []

        for track in tracks:
            state = self.states.setdefault(
                track.track_id, TrackState(history=deque(maxlen=self.config.history_size))
            )
            state.last_seen_frame = frame_index

            bbox = clamp_box(track.bbox)
            item_states = {
                "helmet": self._evaluate_item("helmet", bbox, ppe_detections),
                "vest": self._evaluate_item("vest", bbox, ppe_detections),
                "gloves": self._evaluate_item("gloves", bbox, ppe_detections),
                "mask": self._evaluate_item("mask", bbox, ppe_detections),
            }

            for item, present in item_states.items():
                state.missing_counts[item] = 0 if present else state.missing_counts[item] + 1

            violations = [item for item in self.config.required_items if not item_states[item]]
            worker = WorkerCompliance(
                id=f"ID_{track.track_id}",
                track_id=track.track_id,
                bbox=[int(round(value)) for value in bbox],
                helmet=item_states["helmet"],
                vest=item_states["vest"],
                gloves=item_states["gloves"],
                mask=item_states["mask"],
                compliant=not violations,
                violations=violations,
                missing_counts=dict(state.missing_counts),
                last_seen_frame=frame_index,
            )
            state.history.append(
                {
                    "frame_index": frame_index,
                    "timestamp_ms": timestamp_ms,
                    "helmet": worker.helmet,
                    "vest": worker.vest,
                    "gloves": worker.gloves,
                    "mask": worker.mask,
                    "compliant": worker.compliant,
                    "violations": list(worker.violations),
                }
            )
            workers.append(worker)

            if (
                state.missing_counts["helmet"] >= self.config.missing_alert_frames
                and not state.helmet_alert_sent
            ):
                alerts.append(
                    AlertEvent(
                        id=worker.id,
                        track_id=track.track_id,
                        rule="missing_helmet_persisted",
                        frame_index=frame_index,
                        message=(
                            f"{worker.id} is missing a helmet for "
                            f"{state.missing_counts['helmet']} consecutive frames."
                        ),
                    )
                )
                state.helmet_alert_sent = True

            if worker.helmet:
                state.helmet_alert_sent = False

        self._drop_stale_tracks(frame_index)
        return FrameComplianceResult(
            frame_index=frame_index,
            timestamp_ms=timestamp_ms,
            workers=workers,
            alerts=alerts,
            detections=ppe_detections,
        )

    def get_track_history(self, track_id: int) -> list[dict]:
        state = self.states.get(track_id)
        return list(state.history) if state else []

    def _drop_stale_tracks(self, frame_index: int) -> None:
        stale_track_ids = [
            track_id
            for track_id, state in self.states.items()
            if frame_index - state.last_seen_frame > self.config.stale_track_frames
        ]
        for track_id in stale_track_ids:
            del self.states[track_id]

    def _evaluate_item(
        self,
        item_name: str,
        person_bbox: tuple[float, float, float, float],
        ppe_detections: list[DetectionBox],
    ) -> bool:
        region_boxes = self._build_region_boxes(item_name, person_bbox)
        positives = []
        negatives = []

        for detection in ppe_detections:
            center = detection.center()
            if not point_in_box(center, person_bbox):
                continue

            region_match_score = self._best_region_score(detection, region_boxes)
            minimum_score = (
                self.config.min_mask_region_overlap
                if detection.mask is not None
                else self.config.min_region_overlap
            )
            if region_match_score < minimum_score:
                continue

            if detection.canonical_label in POSITIVE_LABELS[item_name]:
                positives.append(region_match_score * detection.confidence)
            elif detection.canonical_label in NEGATIVE_LABELS[item_name]:
                negatives.append(region_match_score * detection.confidence)

        if positives:
            return max(positives) >= max(negatives, default=0.0)
        if negatives:
            return False
        return False

    def _best_region_score(
        self,
        detection: DetectionBox,
        region_boxes: list[tuple[float, float, float, float]],
    ) -> float:
        bbox_score = self._best_bbox_region_score(detection.bbox, region_boxes)
        mask_score = self._best_mask_region_score(detection, region_boxes)
        return mask_score if detection.mask is not None else bbox_score

    def _best_bbox_region_score(
        self,
        detection_bbox: tuple[float, float, float, float],
        region_boxes: list[tuple[float, float, float, float]],
    ) -> float:
        detection_area = box_area(detection_bbox)
        if detection_area <= 0.0:
            return 0.0
        return max(
            (
                intersection_area(detection_bbox, region_box) / detection_area
                for region_box in region_boxes
            ),
            default=0.0,
        )

    def _best_mask_region_score(
        self,
        detection: DetectionBox,
        region_boxes: list[tuple[float, float, float, float]],
    ) -> float:
        if detection.mask is None or detection.mask_area <= 0:
            return 0.0

        best_score = 0.0
        for region_box in region_boxes:
            x1, y1, x2, y2 = clamp_region_to_mask(region_box, detection.mask.shape)
            if x2 <= x1 or y2 <= y1:
                continue
            region_mask = detection.mask[y1:y2, x1:x2]
            if region_mask.size == 0:
                continue
            overlap_pixels = int(region_mask.sum())
            best_score = max(best_score, overlap_pixels / max(detection.mask_area, 1))
        return best_score

    def _build_region_boxes(
        self, item_name: str, person_bbox: tuple[float, float, float, float]
    ) -> list[tuple[float, float, float, float]]:
        x1, y1, x2, y2 = person_bbox
        width = x2 - x1
        height = y2 - y1
        center_margin = width * self.config.center_margin_ratio

        def region_from_ratios(
            top_ratio: float,
            bottom_ratio: float,
            left_pad: float = 0.0,
            right_pad: float = 0.0,
        ) -> tuple[float, float, float, float]:
            return (
                x1 + left_pad,
                y1 + (height * top_ratio),
                x2 - right_pad,
                y1 + (height * bottom_ratio),
            )

        if item_name == "helmet":
            return [
                region_from_ratios(
                    self.config.head_region_y[0],
                    self.config.head_region_y[1],
                    center_margin,
                    center_margin,
                )
            ]
        if item_name == "mask":
            return [
                region_from_ratios(
                    self.config.face_region_y[0],
                    self.config.face_region_y[1],
                    center_margin,
                    center_margin,
                )
            ]
        if item_name == "vest":
            return [
                region_from_ratios(
                    self.config.torso_region_y[0],
                    self.config.torso_region_y[1],
                    width * 0.12,
                    width * 0.12,
                )
            ]
        if item_name == "gloves":
            side_width = width * self.config.side_region_width_ratio
            return [
                (
                    x1 - (width * 0.05),
                    y1 + (height * self.config.gloves_region_y[0]),
                    x1 + side_width,
                    y1 + (height * self.config.gloves_region_y[1]),
                ),
                (
                    x2 - side_width,
                    y1 + (height * self.config.gloves_region_y[0]),
                    x2 + (width * 0.05),
                    y1 + (height * self.config.gloves_region_y[1]),
                ),
            ]
        return [person_bbox]


def compute_compliance(
    engine: ComplianceEngine,
    tracks: list[TrackBox],
    ppe_detections: list[DetectionBox],
    frame_index: int,
    timestamp_ms: float,
) -> FrameComplianceResult:
    return engine.evaluate_frame(
        tracks=tracks,
        ppe_detections=ppe_detections,
        frame_index=frame_index,
        timestamp_ms=timestamp_ms,
    )
