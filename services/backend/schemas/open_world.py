from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class FlightStartRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    seed: int = Field(ge=0, le=2_147_483_647)
    spawn_distance_m: float = Field(ge=100, le=10_000)
    initial_altitude_m: float = Field(ge=20, le=500)
    max_speed_mps: float = Field(ge=1, le=60)
    wind_speed_mps: float = Field(ge=0, le=20)
    destination_x_m: float = Field(ge=-6_000, le=6_000)
    destination_z_m: float = Field(ge=-6_000, le=6_000)


class FlightTelemetry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    position: dict[str, float]
    altitude_m: float
    speed_mps: float
    vertical_speed_mps: float
    heading_deg: float
    acceleration_mps2: float
    distance_remaining_m: float
    eta_seconds: float | None
    trajectory_deviation_m: float


class FlightState(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scenario_id: str | None
    drone_id: str | None
    seed: int
    sim_version: str
    config_hash: str
    status: Literal["standby", "active", "paused", "stopped", "complete"]
    sim_time: float
    position: dict[str, float]
    spawn: dict[str, float]
    destination: dict[str, float]
    speed_mps: float
    heading_deg: float
    distance_remaining_m: float
    distance_travelled_m: float
    eta_seconds: float | None
    altitude_m: float
    vertical_speed_mps: float
    acceleration_mps2: float
    trajectory_deviation_m: float
    ground_truth: FlightTelemetry
    estimated_telemetry: FlightTelemetry
    estimation_error_m: float
    source: Literal["simulated"]
