from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(slots=True)
class DetectorConfig:
    model_path: str = "best.pt"
    confidence: float = 0.25
    person_confidence: float = 0.35
    image_size: int = 640
    device: str = "auto"
    require_person_context_for_ppe: bool = True
    person_context_padding_ratio: float = 0.18
    min_ppe_confidence: dict[str, float] = field(
        default_factory=lambda: {
            "helmet": 0.55,
            "vest": 0.45,
            "gloves": 0.4,
            "mask": 0.5,
            "no_helmet": 0.5,
            "no_vest": 0.45,
            "no_gloves": 0.4,
            "no_mask": 0.5,
        }
    )
    classes_of_interest: tuple[str, ...] = (
        "person",
        "helmet",
        "vest",
        "gloves",
        "mask",
        "no_helmet",
        "no_vest",
        "no_gloves",
        "no_mask",
    )


@dataclass(slots=True)
class SamConfig:
    enabled: bool = True
    model_id: str = "facebook/sam-vit-base"
    local_files_only: bool = False
    multimask_output: bool = False
    mask_threshold: float = 0.0
    max_detections_per_frame: int = 32
    segment_person_boxes: bool = True
    segment_ppe_boxes: bool = True


@dataclass(slots=True)
class DepthConfig:
    enabled: bool = False
    model_id: str = "Intel/dpt-hybrid-midas"
    local_files_only: bool = False
    max_frame_side: int = 384
    process_every_n_frames: int = 2


@dataclass(slots=True)
class TrackerConfig:
    max_age: int = 30
    n_init: int = 1
    max_iou_distance: float = 0.7
    max_cosine_distance: float = 0.25
    nn_budget: int | None = 100
    embedder: str = "mobilenet"
    half: bool = True
    bgr: bool = True
    embedder_gpu: bool = True
    polygon: bool = False
    include_tentative: bool = False


@dataclass(slots=True)
class ComplianceConfig:
    required_items: tuple[str, ...] = ("helmet", "vest", "gloves", "mask")
    history_size: int = 180
    stale_track_frames: int = 120
    missing_alert_frames: int = 15
    head_region_y: tuple[float, float] = (0.0, 0.28)
    face_region_y: tuple[float, float] = (0.08, 0.36)
    torso_region_y: tuple[float, float] = (0.28, 0.78)
    gloves_region_y: tuple[float, float] = (0.35, 0.95)
    side_region_width_ratio: float = 0.35
    center_margin_ratio: float = 0.15
    min_region_overlap: float = 0.05
    min_mask_region_overlap: float = 0.03


@dataclass(slots=True)
class RuntimeConfig:
    display: bool = False
    display_window_name: str = "PPE Compliance Monitor"
    output_video_path: str | None = None
    output_jsonl_path: str | None = None
    max_frames: int | None = None
    save_annotated: bool = True
    show_fps_overlay: bool = True
    process_every_n_frames: int = 1


@dataclass(slots=True)
class SystemConfig:
    detector: DetectorConfig = field(default_factory=DetectorConfig)
    sam: SamConfig = field(default_factory=SamConfig)
    depth: DepthConfig = field(default_factory=DepthConfig)
    tracker: TrackerConfig = field(default_factory=TrackerConfig)
    compliance: ComplianceConfig = field(default_factory=ComplianceConfig)
    runtime: RuntimeConfig = field(default_factory=RuntimeConfig)
