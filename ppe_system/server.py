from __future__ import annotations

import asyncio
from base64 import b64encode
from copy import deepcopy
from pathlib import Path

import cv2
import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

from .config import ComplianceConfig, DepthConfig, DetectorConfig, RuntimeConfig, SamConfig, SystemConfig, TrackerConfig
from .dataset_export import DatasetExporter
from .depth import MidasDepthEstimator
from .pipeline import PPECompliancePipeline
from .visualization import annotate_frame


def _build_config(
    model_path: str,
    sam_enabled: bool = True,
    sam_local_files_only: bool = False,
    inference_image_size: int = 512,
    depth_enabled: bool = False,
    depth_model_id: str = "Intel/dpt-hybrid-midas",
    depth_local_files_only: bool = False,
    depth_max_frame_side: int = 384,
    depth_process_every_n_frames: int = 2,
) -> SystemConfig:
    return SystemConfig(
        detector=DetectorConfig(model_path=model_path, image_size=inference_image_size),
        sam=SamConfig(
            enabled=sam_enabled,
            local_files_only=sam_local_files_only,
            segment_person_boxes=False,
            segment_ppe_boxes=True,
            max_detections_per_frame=16,
        ),
        depth=DepthConfig(
            enabled=depth_enabled,
            model_id=depth_model_id,
            local_files_only=depth_local_files_only,
            max_frame_side=depth_max_frame_side,
            process_every_n_frames=depth_process_every_n_frames,
        ),
        tracker=TrackerConfig(),
        compliance=ComplianceConfig(),
        runtime=RuntimeConfig(display=False, save_annotated=False),
    )


class LivePpeServer:
    def __init__(
        self,
        model_path: str = "best.pt",
        sam_enabled: bool = True,
        sam_local_files_only: bool = False,
        inference_image_size: int = 512,
        max_frame_side: int = 640,
        preview_max_width: int = 480,
        save_dataset: bool = False,
        dataset_stride: int = 12,
        depth_enabled: bool = False,
        depth_model_id: str = "Intel/dpt-hybrid-midas",
        depth_local_files_only: bool = False,
        depth_max_frame_side: int = 384,
        depth_process_every_n_frames: int = 2,
    ):
        resolved_model = Path(model_path).expanduser()
        if not resolved_model.exists():
            raise FileNotFoundError(f"Model file not found: {resolved_model}")

        self.model_path = str(resolved_model)
        self.pipeline = PPECompliancePipeline(
            _build_config(
                self.model_path,
                sam_enabled=sam_enabled,
                sam_local_files_only=sam_local_files_only,
                inference_image_size=inference_image_size,
                depth_enabled=depth_enabled,
                depth_model_id=depth_model_id,
                depth_local_files_only=depth_local_files_only,
                depth_max_frame_side=depth_max_frame_side,
                depth_process_every_n_frames=depth_process_every_n_frames,
            )
        )
        self.max_frame_side = max(256, max_frame_side)
        self.preview_max_width = max(240, preview_max_width)
        self.save_dataset = save_dataset
        self.dataset_stride = max(1, dataset_stride)
        self.dataset_exporter = DatasetExporter("dataset") if save_dataset else None
        self.depth_estimator = MidasDepthEstimator(self.pipeline.config.depth, self.pipeline.device)
        self.depth_stride = max(1, self.pipeline.config.depth.process_every_n_frames)
        self.last_depth_payload = None
        self._latest_frame_result = None
        self.lock = asyncio.Lock()

    async def process_encoded_frame(self, frame_bytes: bytes, frame_index: int) -> dict:
        np_buffer = np.frombuffer(frame_bytes, dtype=np.uint8)
        frame = cv2.imdecode(np_buffer, cv2.IMREAD_COLOR)
        if frame is None:
            raise ValueError("Invalid frame payload. Expected an encoded JPEG/PNG image.")
        frame = self._resize_for_live_processing(frame)

        async with self.lock:
            result = self.pipeline.process_frame(frame=frame, frame_index=frame_index)
            self._latest_frame_result = result
            payload = result.to_dict()
            dataset_files = None
            if self.dataset_exporter is not None and frame_index % self.dataset_stride == 0:
                dataset_files = self.dataset_exporter.save_frame(frame, result)
            depth_payload = self._process_depth(frame, frame_index)

        annotated = annotate_frame(frame, result, show_fps=False, fps=0.0)
        preview_frame = self._resize_for_preview(annotated)
        success, encoded = cv2.imencode(".jpg", preview_frame, [int(cv2.IMWRITE_JPEG_QUALITY), 42])
        preview_data = None
        if success:
            preview_data = f"data:image/jpeg;base64,{b64encode(encoded.tobytes()).decode('utf-8')}"

        return {
            "type": "frame_result",
            "frame_index": frame_index,
            "preview": preview_data,
            "result": payload,
            "dataset_files": dataset_files,
            "depth": depth_payload,
        }

    def _resize_for_live_processing(self, frame):
        height, width = frame.shape[:2]
        largest_side = max(height, width)
        if largest_side <= self.max_frame_side:
            return frame
        scale = self.max_frame_side / float(largest_side)
        resized_size = (max(1, int(round(width * scale))), max(1, int(round(height * scale))))
        return cv2.resize(frame, resized_size, interpolation=cv2.INTER_AREA)

    def _resize_for_preview(self, frame):
        height, width = frame.shape[:2]
        if width <= self.preview_max_width:
            return frame
        scale = self.preview_max_width / float(width)
        resized_size = (self.preview_max_width, max(1, int(round(height * scale))))
        return cv2.resize(frame, resized_size, interpolation=cv2.INTER_AREA)

    def _process_depth(self, frame, frame_index: int):
        if self.depth_estimator.model is None or self.depth_estimator.processor is None:
            return None
        if frame_index % self.depth_stride == 0 or self.last_depth_payload is None:
            latest_result = getattr(self, "_latest_frame_result", None)
            person_boxes = self._derive_depth_person_boxes(frame, latest_result)
            result = self.depth_estimator.estimate(frame, person_boxes=person_boxes)
            self.last_depth_payload = result.to_dict() if result is not None else None
        return deepcopy(self.last_depth_payload)

    def _derive_depth_person_boxes(self, frame, latest_result) -> list[tuple[int, int, int, int]]:
        if latest_result is None:
            return []

        frame_h, frame_w = frame.shape[:2]
        boxes: list[tuple[int, int, int, int]] = []

        if latest_result.workers:
            boxes.extend([tuple(worker.bbox) for worker in latest_result.workers])
        else:
            boxes.extend(
                [
                    tuple(int(round(value)) for value in detection.bbox)
                    for detection in latest_result.detections
                    if detection.canonical_label == "person"
                ]
            )

        if boxes:
            return self._dedupe_boxes(boxes)

        proxy_boxes = []
        for detection in latest_result.detections:
            label = detection.canonical_label
            if label not in {"helmet", "vest", "gloves", "mask"}:
                continue

            x1, y1, x2, y2 = [float(value) for value in detection.bbox]
            width = max(1.0, x2 - x1)
            height = max(1.0, y2 - y1)

            if label == "helmet":
                proxy = (
                    x1 - width * 1.7,
                    y1 - height * 0.25,
                    x2 + width * 1.7,
                    y2 + height * 7.2,
                )
            elif label == "mask":
                proxy = (
                    x1 - width * 2.0,
                    y1 - height * 1.0,
                    x2 + width * 2.0,
                    y2 + height * 6.2,
                )
            elif label == "vest":
                proxy = (
                    x1 - width * 0.75,
                    y1 - height * 1.35,
                    x2 + width * 0.75,
                    y2 + height * 1.85,
                )
            else:
                proxy = (
                    x1 - width * 1.4,
                    y1 - height * 4.2,
                    x2 + width * 1.4,
                    y2 + height * 1.4,
                )

            proxy_boxes.append(self._clamp_box(proxy, frame_w, frame_h))

        return self._dedupe_boxes(proxy_boxes)

    def _clamp_box(self, box, frame_w: int, frame_h: int) -> tuple[int, int, int, int]:
        x1, y1, x2, y2 = box
        clamped = (
            max(0, min(frame_w - 1, int(round(x1)))),
            max(0, min(frame_h - 1, int(round(y1)))),
            max(0, min(frame_w, int(round(x2)))),
            max(0, min(frame_h, int(round(y2)))),
        )
        if clamped[2] <= clamped[0] or clamped[3] <= clamped[1]:
            return (0, 0, 0, 0)
        return clamped

    def _dedupe_boxes(self, boxes: list[tuple[int, int, int, int]]) -> list[tuple[int, int, int, int]]:
        deduped: list[tuple[int, int, int, int]] = []
        for candidate in boxes:
            if candidate[2] <= candidate[0] or candidate[3] <= candidate[1]:
                continue
            if any(self._box_iou(candidate, existing) >= 0.28 for existing in deduped):
                continue
            deduped.append(candidate)
        return deduped

    def _box_iou(
        self,
        box_a: tuple[int, int, int, int],
        box_b: tuple[int, int, int, int],
    ) -> float:
        ax1, ay1, ax2, ay2 = box_a
        bx1, by1, bx2, by2 = box_b
        inter_x1 = max(ax1, bx1)
        inter_y1 = max(ay1, by1)
        inter_x2 = min(ax2, bx2)
        inter_y2 = min(ay2, by2)
        if inter_x2 <= inter_x1 or inter_y2 <= inter_y1:
            return 0.0
        intersection = float((inter_x2 - inter_x1) * (inter_y2 - inter_y1))
        area_a = float(max(0, ax2 - ax1) * max(0, ay2 - ay1))
        area_b = float(max(0, bx2 - bx1) * max(0, by2 - by1))
        return intersection / max(area_a + area_b - intersection, 1e-6)


def create_app(
    model_path: str = "best.pt",
    sam_enabled: bool = True,
    sam_local_files_only: bool = False,
    inference_image_size: int = 512,
    max_frame_side: int = 640,
    preview_max_width: int = 480,
    save_dataset: bool = False,
    dataset_stride: int = 12,
    depth_enabled: bool = False,
    depth_model_id: str = "Intel/dpt-hybrid-midas",
    depth_local_files_only: bool = False,
    depth_max_frame_side: int = 384,
    depth_process_every_n_frames: int = 2,
) -> FastAPI:
    server = LivePpeServer(
        model_path=model_path,
        sam_enabled=sam_enabled,
        sam_local_files_only=sam_local_files_only,
        inference_image_size=inference_image_size,
        max_frame_side=max_frame_side,
        preview_max_width=preview_max_width,
        save_dataset=save_dataset,
        dataset_stride=dataset_stride,
        depth_enabled=depth_enabled,
        depth_model_id=depth_model_id,
        depth_local_files_only=depth_local_files_only,
        depth_max_frame_side=depth_max_frame_side,
        depth_process_every_n_frames=depth_process_every_n_frames,
    )
    app = FastAPI(title="Warehouse PPE Compliance Backend", version="1.0.0")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health")
    async def health():
        return {
            "status": "ok",
            "model_path": server.model_path,
            "device": server.pipeline.device,
            "depth_enabled": server.depth_estimator.model is not None,
        }

    @app.get("/")
    async def root():
        return JSONResponse(
            {
                "status": "ok",
                "message": "Warehouse PPE backend is running.",
                "health_url": "/health",
                "websocket_url": "/ws/ppe",
                "depth_enabled": server.depth_estimator.model is not None,
                "next_step": "Start the Vite frontend with `npm run dev`, then use the website to begin live monitoring.",
            }
        )

    @app.get("/favicon.ico")
    async def favicon():
        return Response(status_code=204)

    @app.websocket("/ws/ppe")
    async def ppe_socket(websocket: WebSocket):
        await websocket.accept()
        await websocket.send_json(
            {
                "type": "ready",
                "model_path": server.model_path,
                "device": server.pipeline.device,
                "depth_enabled": server.depth_estimator.model is not None,
                "message": "PPE backend connected",
            }
        )

        frame_index = 0
        try:
            while True:
                message = await websocket.receive()

                if message.get("type") == "websocket.disconnect":
                    break

                if message.get("bytes") is not None:
                    try:
                        response = await server.process_encoded_frame(message["bytes"], frame_index)
                    except Exception as exc:  # pragma: no cover - runtime path
                        await websocket.send_json(
                            {
                                "type": "error",
                                "frame_index": frame_index,
                                "message": str(exc),
                            }
                        )
                    else:
                        await websocket.send_json(response)
                        frame_index += 1
                    continue

                text_payload = message.get("text", "")
                if text_payload == "ping":
                    await websocket.send_json({"type": "pong"})
                else:
                    await websocket.send_json(
                        {
                            "type": "error",
                            "message": "Unsupported payload. Send JPEG/PNG bytes or 'ping'.",
                        }
                    )
        except WebSocketDisconnect:
            return

    return app
