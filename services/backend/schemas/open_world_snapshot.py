from pydantic import BaseModel, ConfigDict

from schemas.open_world import FlightState
from schemas.open_world_rf import OpenWorldRFState


class OpenWorldSimulationSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid")

    flight: FlightState
    rf: OpenWorldRFState
