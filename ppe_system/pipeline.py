from __future__ import annotations

import copy
import json
import time
from pathlib import Path

import cv2

from .compliance import ComplianceEngine, compute_compliance
from .config import SystemConfig
from .detection import YoloPpeDetector, resolve_device, run_yolo_detection
from .segmentation import SamSegmenter, run_sam_segmentation
from .schemas import FrameComplianceResult
from .sources import FrameSource
from .tracking import DeepSortTrackerAdapter
from .visualization import draw_results


class PPECompliancePipeline:
    def __init__(self, config: SystemConfig):
        self.config = config
        self.device = resolve_device(config.detector.device)
        self.detector = YoloPpeDetector(config.detector)
        self.segmenter = SamSegmenter(config.sam, self.device) if config.sam.enabled else None
        self.tracker = DeepSortTrackerAdapter(
            config.tracker,
            gpu_enabled=self.device.startswith("cuda"),
        )
        self.compliance = ComplianceEngine(config.compliance)

    def process_frame(
        self,
        frame,
        frame_index: int,
        timestamp_ms: float | None = None,
    ) -> FrameComplianceResult:
        people, ppe_items = run_yolo_detection(frame, self.detector)
        sam_prompts = []
        if self.config.sam.segment_person_boxes:
            sam_prompts.extend(people)
        if self.config.sam.segment_ppe_boxes:
            sam_prompts.extend(ppe_items)
        segmented = run_sam_segmentation(frame, sam_prompts, self.segmenter)
        segmented_map = {
            (detection.label, detection.confidence, detection.bbox): detection
            for detection in segmented
        }
        people = [
            segmented_map.get((detection.label, detection.confidence, detection.bbox), detection)
            for detection in people
        ]
        ppe_items = [
            segmented_map.get((detection.label, detection.confidence, detection.bbox), detection)
            for detection in ppe_items
        ]
        tracks = self.tracker.update(people, frame)
        result = compute_compliance(
            engine=self.compliance,
            tracks=tracks,
            ppe_detections=ppe_items,
            frame_index=frame_index,
            timestamp_ms=float(timestamp_ms if timestamp_ms is not None else frame_index),
        )
        result.detections = [*people, *ppe_items]
        return result

    def process_frame_json(
        self,
        frame,
        frame_index: int,
        timestamp_ms: float | None = None,
    ) -> dict:
        return self.process_frame(frame, frame_index, timestamp_ms).to_dict()

    def process_source(
        self,
        source: str | int | None = None,
        frames_dir: str | None = None,
        camera_backend: str | None = None,
        camera_warmup_frames: int = 20,
        camera_read_retries: int = 60,
    ):
        frame_source = FrameSource(
            source=source,
            frames_dir=frames_dir,
            camera_backend=camera_backend,
            camera_warmup_frames=camera_warmup_frames,
            camera_read_retries=camera_read_retries,
        )
        runtime = self.config.runtime

        video_writer = None
        jsonl_handle = None
        last_time = time.perf_counter()
        output_size = None
        processed_frames = 0
        last_result: FrameComplianceResult | None = None
        process_every_n_frames = max(1, runtime.process_every_n_frames)

        if runtime.output_jsonl_path:
            jsonl_path = Path(runtime.output_jsonl_path)
            jsonl_path.parent.mkdir(parents=True, exist_ok=True)
            jsonl_handle = jsonl_path.open("w", encoding="utf-8")

        try:
            for packet in frame_source.iter_frames():
                if packet.frame_index % process_every_n_frames == 0 or last_result is None:
                    result = self.process_frame(packet.frame, packet.frame_index, packet.timestamp_ms)
                    last_result = result
                else:
                    result = copy.deepcopy(last_result)
                    result.frame_index = packet.frame_index
                    result.timestamp_ms = packet.timestamp_ms
                    result.alerts = []

                now = time.perf_counter()
                elapsed = max(now - last_time, 1e-6)
                fps = 1.0 / elapsed
                last_time = now

                annotated = None
                if runtime.save_annotated or runtime.display:
                    annotated = draw_results(
                        packet.frame,
                        result,
                        show_fps=runtime.show_fps_overlay,
                        fps=fps,
                    )

                if runtime.output_video_path and annotated is not None:
                    if video_writer is None:
                        height, width = annotated.shape[:2]
                        output_size = (width, height)
                        output_path = Path(runtime.output_video_path)
                        output_path.parent.mkdir(parents=True, exist_ok=True)
                        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
                        video_writer = cv2.VideoWriter(str(output_path), fourcc, max(fps, 15.0), output_size)
                    video_writer.write(annotated)

                if jsonl_handle is not None:
                    jsonl_handle.write(json.dumps(result.to_dict()) + "\n")

                if runtime.display and annotated is not None:
                    cv2.imshow(runtime.display_window_name, annotated)
                    if cv2.waitKey(1) & 0xFF == ord("q"):
                        break

                processed_frames += 1
                yield result, annotated

                if runtime.max_frames is not None and processed_frames >= runtime.max_frames:
                    break
        finally:
            if video_writer is not None:
                video_writer.release()
            if jsonl_handle is not None:
                jsonl_handle.close()
            if runtime.display:
                cv2.destroyAllWindows()


def load_models(config: SystemConfig) -> PPECompliancePipeline:
    return PPECompliancePipeline(config)
