
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class SpectrumFrame(BaseModel):
    """Validated data contract for one Mag-Null spectrum frame."""

    model_config = ConfigDict(
        extra="forbid",
        validate_assignment=True,
    )

    mode: Literal["simulation"] = "simulation"
    source: Literal["simulated"] = "simulated"
    synthetic: Literal[True] = True

    sim_version: str = Field(min_length=1)
    scenario: str = Field(min_length=1)
    seed: int = Field(ge=0, le=2_147_483_647)
    config_hash: str = Field(min_length=1)

    frame_id: int = Field(ge=0)
    timestamp: str = Field(min_length=1)

    frequency_bins: list[float] = Field(min_length=32, max_length=4096)
    power: list[float] = Field(min_length=32, max_length=4096)
    units: Literal["relative_dB"] = "relative_dB"

    @model_validator(mode="after")
    def validate_matching_arrays(self):
        if len(self.frequency_bins) != len(self.power):
            raise ValueError(
                "frequency_bins and power must have equal lengths"
            )
        return self
