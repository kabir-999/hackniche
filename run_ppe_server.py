from __future__ import annotations

import argparse

import uvicorn

from ppe_system.server import create_app


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Start the live PPE backend server.")
    parser.add_argument("--model", default="best.pt", help="Path to the YOLOv8 model weights.")
    parser.add_argument("--disable-sam", action="store_true", help="Disable SAM segmentation on the backend.")
    parser.add_argument("--sam-local-files-only", action="store_true", help="Load SAM only from the local Hugging Face cache.")
    parser.add_argument("--imgsz", type=int, default=512, help="YOLO inference size for live monitoring.")
    parser.add_argument("--max-frame-side", type=int, default=640, help="Resize incoming live frames so the largest side is at most this value.")
    parser.add_argument("--preview-max-width", type=int, default=480, help="Resize the returned preview image to this width for lower latency.")
    parser.add_argument("--enable-depth", action="store_true", help="Enable MiDaS depth estimation for the full live frame.")
    parser.add_argument("--depth-model", default="Intel/dpt-hybrid-midas", help="Hugging Face model id for MiDaS-compatible depth estimation.")
    parser.add_argument("--depth-local-files-only", action="store_true", help="Load the depth model only from the local Hugging Face cache.")
    parser.add_argument("--depth-max-frame-side", type=int, default=384, help="Resize live frames for depth estimation so the largest side is at most this value.")
    parser.add_argument("--depth-every-n", type=int, default=2, help="Compute depth every Nth processed frame and reuse the last depth preview in between.")
    parser.add_argument("--save-dataset", action="store_true", help="Save streamed frames and labels to the dataset folder during live monitoring.")
    parser.add_argument("--dataset-stride", type=int, default=12, help="If dataset saving is enabled, save only every Nth processed frame.")
    parser.add_argument("--host", default="127.0.0.1", help="Host interface for the backend server.")
    parser.add_argument("--port", type=int, default=8000, help="Port for the backend server.")
    parser.add_argument("--reload", action="store_true", help="Enable uvicorn reload for development.")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    app = create_app(
        model_path=args.model,
        sam_enabled=not args.disable_sam,
        sam_local_files_only=args.sam_local_files_only,
        inference_image_size=args.imgsz,
        max_frame_side=args.max_frame_side,
        preview_max_width=args.preview_max_width,
        depth_enabled=args.enable_depth,
        depth_model_id=args.depth_model,
        depth_local_files_only=args.depth_local_files_only,
        depth_max_frame_side=args.depth_max_frame_side,
        depth_process_every_n_frames=args.depth_every_n,
        save_dataset=args.save_dataset,
        dataset_stride=args.dataset_stride,
    )
    uvicorn.run(app, host=args.host, port=args.port, reload=args.reload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
