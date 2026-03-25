from __future__ import annotations

from .config import SystemConfig
from .pipeline import PPECompliancePipeline, load_models


def create_pipeline(config: SystemConfig | None = None) -> PPECompliancePipeline:
    return load_models(config or SystemConfig())


def process_frame_json(
    pipeline: PPECompliancePipeline,
    frame,
    frame_index: int,
    timestamp_ms: float | None = None,
) -> dict:
    return pipeline.process_frame_json(frame=frame, frame_index=frame_index, timestamp_ms=timestamp_ms)
