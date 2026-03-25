from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import platform
import time

import cv2


IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


@dataclass(slots=True)
class FramePacket:
    frame_index: int
    timestamp_ms: float
    frame: object


def parse_source(source: str | int) -> str | int:
    if isinstance(source, int):
        return source
    if isinstance(source, str) and source.isdigit():
        return int(source)
    return source


def is_probable_local_media_path(source: str | int | None) -> bool:
    if not isinstance(source, str):
        return False
    lowered = source.lower()
    return (
        "/" in source
        or "." in Path(source).name
        or lowered.endswith((".mp4", ".avi", ".mov", ".mkv", ".m4v", ".webm"))
    )


def is_probable_image_path(source: str | int | None) -> bool:
    if not isinstance(source, str):
        return False
    return Path(source).suffix.lower() in IMAGE_EXTENSIONS


def is_live_camera_source(source: str | int | None) -> bool:
    return isinstance(parse_source(source), int)


def resolve_capture_backend(source: str | int | None, backend: str | None = None) -> int:
    backend_name = (backend or "auto").strip().lower()
    backend_map = {
        "auto": None,
        "any": cv2.CAP_ANY,
        "avfoundation": getattr(cv2, "CAP_AVFOUNDATION", cv2.CAP_ANY),
    }

    if backend_name not in backend_map:
        raise ValueError(
            f"Unsupported camera backend '{backend}'. Supported values: auto, any, avfoundation."
        )

    if backend_name != "auto":
        return backend_map[backend_name]

    if is_live_camera_source(source) and platform.system() == "Darwin":
        return getattr(cv2, "CAP_AVFOUNDATION", cv2.CAP_ANY)

    return cv2.CAP_ANY


class FrameSource:
    def __init__(
        self,
        source: str | int | None = None,
        frames_dir: str | None = None,
        camera_backend: str | None = None,
        camera_warmup_frames: int = 20,
        camera_read_retries: int = 60,
    ):
        self.source = source
        self.frames_dir = Path(frames_dir) if frames_dir else None
        self.camera_backend = camera_backend
        self.camera_warmup_frames = max(camera_warmup_frames, 0)
        self.camera_read_retries = max(camera_read_retries, 1)
        if source is None and self.frames_dir is None:
            raise ValueError("Provide either a video source or a frames directory.")

    def iter_frames(self):
        if self.frames_dir is not None:
            yield from self._iter_image_directory()
            return
        if is_probable_image_path(self.source):
            yield from self._iter_single_image()
            return
        yield from self._iter_capture()

    def _iter_capture(self):
        parsed_source = parse_source(self.source)

        if is_probable_local_media_path(self.source):
            source_path = Path(str(self.source)).expanduser()
            if not source_path.exists():
                raise FileNotFoundError(
                    f"Video source file not found: {source_path}. "
                    "Pass a real video path, a webcam index like --source 0, "
                    "or a frame directory with --frames-dir."
                )

        backend = resolve_capture_backend(self.source, self.camera_backend)
        capture = cv2.VideoCapture(parsed_source, backend)
        if not capture.isOpened():
            raise RuntimeError(
                f"Unable to open source: {self.source}. "
                "If this is a file, confirm the path exists and OpenCV can decode it. "
                "If this is a webcam, try --source 0. "
                "If this is a frame sequence, use --frames-dir /path/to/frames."
            )

        if is_live_camera_source(self.source):
            self._warmup_camera(capture)

        frame_index = 0
        try:
            while True:
                ok, frame = capture.read()
                if not ok:
                    if is_live_camera_source(self.source):
                        raise RuntimeError(
                            "Camera opened but no frames were received. "
                            "On macOS, make sure your terminal app and Python have Camera permission in "
                            "System Settings > Privacy & Security > Camera, then retry. "
                            "You can also try `--camera-backend any`."
                        )
                    break
                timestamp_ms = capture.get(cv2.CAP_PROP_POS_MSEC)
                if timestamp_ms <= 0 and is_live_camera_source(self.source):
                    timestamp_ms = time.time() * 1000.0
                yield FramePacket(frame_index=frame_index, timestamp_ms=timestamp_ms, frame=frame)
                frame_index += 1
        finally:
            capture.release()

    def _warmup_camera(self, capture) -> None:
        for _ in range(self.camera_warmup_frames):
            capture.grab()
            time.sleep(0.01)

        for _ in range(self.camera_read_retries):
            ok, frame = capture.read()
            if ok and frame is not None:
                return
            time.sleep(0.05)

        raise RuntimeError(
            "Camera source opened, but OpenCV could not read any frames after startup. "
            "This usually means camera permission is blocked or the selected backend is wrong. "
            "On macOS, allow Camera access for your terminal and Python, then retry. "
            "You can also try `--camera-backend any`."
        )

    def _iter_image_directory(self):
        if not self.frames_dir.exists():
            raise FileNotFoundError(f"Frames directory not found: {self.frames_dir}")
        if not self.frames_dir.is_dir():
            raise NotADirectoryError(f"Frames path is not a directory: {self.frames_dir}")

        image_paths = sorted(
            path for path in self.frames_dir.iterdir() if path.suffix.lower() in IMAGE_EXTENSIONS
        )
        if not image_paths:
            raise RuntimeError(f"No frames found in {self.frames_dir}")

        for frame_index, image_path in enumerate(image_paths):
            frame = cv2.imread(str(image_path))
            if frame is None:
                continue
            yield FramePacket(
                frame_index=frame_index,
                timestamp_ms=float(frame_index),
                frame=frame,
            )

    def _iter_single_image(self):
        image_path = Path(str(self.source)).expanduser()
        if not image_path.exists():
            raise FileNotFoundError(f"Image source file not found: {image_path}")

        frame = cv2.imread(str(image_path))
        if frame is None:
            raise RuntimeError(f"Unable to decode image source: {image_path}")

        yield FramePacket(frame_index=0, timestamp_ms=0.0, frame=frame)
