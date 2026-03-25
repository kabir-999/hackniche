# PPE Compliance System

This package adds a modular Python PPE compliance pipeline to the warehouse project using:

- YOLOv8 via Ultralytics for detection
- Segment Anything Model (SAM) from Hugging Face for pixel-accurate masks
- DeepSORT for worker tracking
- OpenCV for CCTV/image/video IO and rendering
- FastAPI WebSocket server for continuous browser-to-backend streaming

## Features

- Accepts a live stream, video file, webcam index, RTSP source, single image, or frame directory
- Uses the custom `best.pt` model for `Person`, `Hardhat`, `Safety Vest`, `Gloves`, `Mask`, and `NO-*` detections
- Uses YOLO bounding boxes as SAM prompts to produce precise segmentation masks
- Tracks workers with persistent IDs using DeepSORT
- Evaluates PPE compliance per tracked worker with region-aware YOLO + SAM overlap checks
- Emits per-frame JSON output and optional JSONL logging
- Draws worker IDs and compliance status on annotated frames
- Overlays semi-transparent segmentation masks for detected PPE and people
- Maintains per-track compliance history and raises an alert if the helmet is missing for more than `N` frames

## Install

```bash
python3 -m pip install -r requirements-ppe.txt
```

The first SAM-enabled run may download `facebook/sam-vit-base` from Hugging Face.

## Run On Video

```bash
python3 run_ppe_monitor.py --model best.pt --source input.mp4 --show --output-video outputs/annotated.mp4 --output-jsonl outputs/frames.jsonl
```

With explicit SAM settings:

```bash
python3 run_ppe_monitor.py --model best.pt --source input.mp4 --show --sam-model facebook/sam-vit-base --process-every-n 2
```

If you are offline but already cached the SAM weights:

```bash
python3 run_ppe_monitor.py --model best.pt --source input.mp4 --show --sam-local-files-only
```

## Run On Frame Sequence

```bash
python3 run_ppe_monitor.py --model best.pt --frames-dir sample_frames --output-jsonl outputs/frames.jsonl
```

## Run On A Single Image

```bash
python3 run_ppe_monitor.py --model best.pt --source frame.jpg --output-jsonl outputs/frame.jsonl
```

## JSON Output

Each processed frame is emitted as JSON:

```json
{
  "frame_index": 12,
  "timestamp_ms": 400.0,
  "workers": [
    {
      "id": "ID_1",
      "track_id": 1,
      "bbox": [100, 50, 220, 360],
      "helmet": true,
      "vest": true,
      "gloves": false,
      "mask": true,
      "compliant": false,
      "violations": ["gloves"],
      "missing_counts": {
        "helmet": 0,
        "vest": 0,
        "gloves": 4,
        "mask": 0
      },
      "last_seen_frame": 12
    }
  ],
  "alerts": [
    {
      "id": "ID_4",
      "track_id": 4,
      "rule": "missing_helmet_persisted",
      "frame_index": 12,
      "message": "ID_4 is missing a helmet for 15 consecutive frames."
    }
  ],
  "detections": [
    {
      "label": "Hardhat",
      "canonical_label": "helmet",
      "confidence": 0.94,
      "bbox": [118, 42, 173, 102],
      "iou_score": 0.97,
      "mask_area": 1842
    }
  ]
}
```

## Python API

```python
import cv2

from ppe_system.api import create_pipeline, process_frame_json

pipeline = create_pipeline()
frame = cv2.imread("frame.jpg")
result = process_frame_json(pipeline, frame=frame, frame_index=0)
print(result)
```

## Notes

- GPU acceleration is used automatically when `torch.cuda.is_available()` is true, or you can pass `--device cuda:0`.
- The compliance logic uses region-aware spatial checks:
  - helmet in head region
  - mask in face region
  - vest in torso region
  - gloves near left/right arm regions
- When SAM is enabled, YOLO detections are refined with segmentation masks, and PPE is treated as present only when the mask overlaps the expected worker region.
- For real-time throughput, `--process-every-n 2` or `--process-every-n 3` can substantially reduce load while preserving live output.
- If `deep-sort-realtime` is not installed, the tracker module will raise a clear install error at startup.

## Continuous Website Streaming

Start the backend:

```bash
python3 run_ppe_server.py --model best.pt --host 127.0.0.1 --port 8000
```

Then start the frontend:

```bash
npm run dev
```

Open the website, click `Start Virtual Monitoring`, and the page will:

- capture frames continuously from the Three.js CCTV scene
- send them to the backend over WebSocket
- run YOLOv8 + SAM + DeepSORT on the backend
- return live compliance results to the Three.js UI
