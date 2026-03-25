from __future__ import annotations

import cv2
import numpy as np

from .schemas import FrameComplianceResult


GREEN = (56, 199, 89)
RED = (49, 49, 230)
AMBER = (0, 191, 255)
WHITE = (245, 245, 245)
PANEL = (20, 20, 28)
MASK_COLORS = {
    "helmet": (0, 215, 255),
    "vest": (0, 165, 255),
    "gloves": (150, 150, 150),
    "mask": (255, 120, 120),
    "person": (116, 201, 255),
}


def annotate_frame(frame, result: FrameComplianceResult, show_fps: bool = True, fps: float = 0.0):
    annotated = frame.copy()
    _overlay_detection_masks(annotated, result)
    for worker in result.workers:
        x1, y1, x2, y2 = worker.bbox
        color = GREEN if worker.compliant else RED
        cv2.rectangle(annotated, (x1, y1), (x2, y2), color, 2)

        status = "COMPLIANT" if worker.compliant else f"MISSING: {', '.join(worker.violations)}"
        header = f"{worker.id} | {status}"
        detail = (
            f"H:{int(worker.helmet)} V:{int(worker.vest)} "
            f"G:{int(worker.gloves)} M:{int(worker.mask)}"
        )
        _draw_label(annotated, header, x1, max(24, y1 - 28), color)
        _draw_label(annotated, detail, x1, max(48, y1 - 4), PANEL, text_color=WHITE)

    if result.alerts:
        _draw_label(
            annotated,
            f"ALERTS: {len(result.alerts)}",
            16,
            24,
            AMBER,
            text_color=(10, 10, 10),
        )

    if show_fps:
        _draw_label(
            annotated,
            f"FRAME {result.frame_index} | FPS {fps:.1f}",
            16,
            58,
            PANEL,
            text_color=WHITE,
        )

    return annotated


def draw_results(frame, result: FrameComplianceResult, show_fps: bool = True, fps: float = 0.0):
    return annotate_frame(frame, result, show_fps=show_fps, fps=fps)


def _overlay_detection_masks(frame, result: FrameComplianceResult) -> None:
    if not result.detections:
        return

    overlay = frame.copy()
    for detection in result.detections:
        color = MASK_COLORS.get(detection.canonical_label, (180, 180, 180))
        x1, y1, x2, y2 = [int(round(value)) for value in detection.bbox]
        if detection.mask is not None:
            overlay[detection.mask] = np.array(color, dtype=np.uint8)
        cv2.rectangle(frame, (x1, y1), (x2, y2), color, 1)
        _draw_label(frame, f"{detection.canonical_label} {detection.confidence:.2f}", x1, max(20, y1 - 6), color)

    cv2.addWeighted(overlay, 0.28, frame, 0.72, 0.0, dst=frame)


def _draw_label(frame, text: str, x: int, y: int, bg_color, text_color=WHITE):
    font = cv2.FONT_HERSHEY_SIMPLEX
    scale = 0.55
    thickness = 1
    (width, height), baseline = cv2.getTextSize(text, font, scale, thickness)
    cv2.rectangle(
        frame,
        (x - 4, y - height - 8),
        (x + width + 8, y + baseline - 2),
        bg_color,
        -1,
    )
    cv2.putText(frame, text, (x, y - 4), font, scale, text_color, thickness, cv2.LINE_AA)
