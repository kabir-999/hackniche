from __future__ import annotations

import argparse
import json
from pathlib import Path

from ppe_system.config import ComplianceConfig, DetectorConfig, RuntimeConfig, SamConfig, SystemConfig, TrackerConfig
from ppe_system.pipeline import PPECompliancePipeline


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Real-time PPE compliance monitoring with YOLOv8 + DeepSORT",
        epilog=(
            "Examples:\n"
            "  python3 run_ppe_monitor.py --model best.pt --source /path/to/video.mp4 --show\n"
            "  python3 run_ppe_monitor.py --model best.pt --source 0 --show\n"
            "  python3 run_ppe_monitor.py --model best.pt --frames-dir /path/to/frames"
        ),
        formatter_class=argparse.RawTextHelpFormatter,
    )
    parser.add_argument("--model", default="best.pt", help="Path to the custom YOLOv8 weights file.")
    parser.add_argument("--source", default=None, help="Video path, RTSP URL, or webcam index.")
    parser.add_argument("--frames-dir", default=None, help="Directory containing an ordered frame sequence.")
    parser.add_argument("--device", default="auto", help="Inference device: auto, cpu, cuda:0, ...")
    parser.add_argument("--imgsz", type=int, default=640, help="YOLO inference image size.")
    parser.add_argument("--conf", type=float, default=0.25, help="Global detection confidence threshold.")
    parser.add_argument("--person-conf", type=float, default=0.35, help="Minimum confidence for person detections.")
    parser.add_argument("--alert-frames", type=int, default=15, help="Trigger helmet alerts after N consecutive missing frames.")
    parser.add_argument("--sam-model", default="facebook/sam-vit-base", help="Hugging Face SAM model id.")
    parser.add_argument("--disable-sam", action="store_true", help="Disable SAM segmentation and use YOLO-only overlap logic.")
    parser.add_argument("--sam-local-files-only", action="store_true", help="Load SAM only from the local Hugging Face cache.")
    parser.add_argument("--camera-backend", default="auto", help="Camera backend for live sources: auto, any, avfoundation.")
    parser.add_argument("--camera-warmup", type=int, default=20, help="Warmup grabs before treating a live camera as failed.")
    parser.add_argument("--camera-retries", type=int, default=60, help="Frame read retries for live camera startup.")
    parser.add_argument("--show", action="store_true", help="Display the annotated live stream.")
    parser.add_argument("--output-video", default=None, help="Optional path to save the annotated output video.")
    parser.add_argument("--output-jsonl", default=None, help="Optional path to save frame-wise JSONL output.")
    parser.add_argument("--max-frames", type=int, default=None, help="Stop after N frames.")
    parser.add_argument("--process-every-n", type=int, default=1, help="Run YOLO/SAM every Nth frame and reuse the latest result in between.")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    if args.source is None and args.frames_dir is None:
        raise SystemExit(
            "Provide either --source or --frames-dir.\n"
            "Examples:\n"
            "  python3 run_ppe_monitor.py --model best.pt --source /path/to/video.mp4 --show\n"
            "  python3 run_ppe_monitor.py --model best.pt --source 0 --show\n"
            "  python3 run_ppe_monitor.py --model best.pt --frames-dir /path/to/frames"
        )

    model_path = Path(args.model)
    if not model_path.exists():
        raise SystemExit(f"Model file not found: {model_path}")

    if args.frames_dir is not None:
        frames_dir = Path(args.frames_dir).expanduser()
        if not frames_dir.exists():
            raise SystemExit(f"Frames directory not found: {frames_dir}")
        if not frames_dir.is_dir():
            raise SystemExit(f"Frames path is not a directory: {frames_dir}")

    if args.source is not None and isinstance(args.source, str):
        source_path = Path(args.source).expanduser()
        if not args.source.isdigit() and source_path.suffix and not source_path.exists():
            raise SystemExit(
                f"Video source file not found: {source_path}\n"
                "Use a real video file path, or use `--source 0` for your default webcam."
            )

    config = SystemConfig(
        detector=DetectorConfig(
            model_path=str(model_path),
            confidence=args.conf,
            person_confidence=args.person_conf,
            image_size=args.imgsz,
            device=args.device,
        ),
        sam=SamConfig(
            enabled=not args.disable_sam,
            model_id=args.sam_model,
            local_files_only=args.sam_local_files_only,
        ),
        tracker=TrackerConfig(),
        compliance=ComplianceConfig(missing_alert_frames=args.alert_frames),
        runtime=RuntimeConfig(
            display=args.show,
            output_video_path=args.output_video,
            output_jsonl_path=args.output_jsonl,
            max_frames=args.max_frames,
            save_annotated=bool(args.output_video or args.show),
            process_every_n_frames=args.process_every_n,
        ),
    )

    pipeline = PPECompliancePipeline(config)
    last_result = None

    for result, _ in pipeline.process_source(
        source=args.source,
        frames_dir=args.frames_dir,
        camera_backend=args.camera_backend,
        camera_warmup_frames=args.camera_warmup,
        camera_read_retries=args.camera_retries,
    ):
        last_result = result
        print(json.dumps(result.to_dict()), flush=True)

    if last_result is None:
        print(json.dumps({"workers": [], "alerts": [], "message": "No frames processed."}), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
