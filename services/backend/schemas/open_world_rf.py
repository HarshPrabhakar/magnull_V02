from typing import Literal

from pydantic import BaseModel, ConfigDict

RFProfileId = Literal[
    "generic_fhss",
    "elrs_like",
    "ocusync_like",
    "afhds_like",
    "analog_fpv_like",
    "unknown_hopping",
]


class RFEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_index: int
    sim_time: float
    channel_index: int
    frequency_mhz: float
    duration_ms: float
    received_power_dbm: float
    visible: bool


class ChannelOccupancy(BaseModel):
    model_config = ConfigDict(extra="forbid")

    channel_index: int
    frequency_mhz: float
    event_count: int
    occupancy_percent: float


class OpenWorldRFState(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scenario_id: str | None
    seed: int
    sim_version: str
    config_hash: str
    sim_time: float
    status: Literal["idle", "active", "paused", "stopped", "complete"]
    source_id: str | None
    profile: RFProfileId | None
    profile_label: str | None
    classification: str | None
    classification_confidence: float | None
    center_frequency_mhz: float | None
    bandwidth_mhz: float | None
    current_frequency_mhz: float | None
    distance_m: float | None
    received_power_dbm: float | None
    noise_floor_dbm: float | None
    snr_db: float | None
    expected_event_count: int
    observed_event_count: int
    missing_event_count: int
    observed_channel_changes: int
    estimated_dwell_ms: float | None
    estimated_hop_rate_hz: float | None
    observed_channel_count: int
    occupied_frequency_range_mhz: list[float] | None
    sequence_periodicity: int | None
    channel_occupancy: list[ChannelOccupancy]
    burst_duration_distribution_ms: list[float]
    inter_burst_intervals_ms: list[float]
    generated_events: list[RFEvent]
    observed_events: list[RFEvent]
    spectrum_frequency_mhz: list[float]
    spectrum_power_db: list[float]
    source: Literal["simulated"]
    synthetic: Literal[True]


