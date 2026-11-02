"""Small deterministic, simulation-only drone motion model."""

from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass
from typing import Literal
from time import monotonic

SIM_VERSION = "0.1.0"
MAX_WORLD_METERS = 6_000


def terrain_height(x: float, z: float, seed: int) -> float:
    phase = (seed % 4096) * 0.0017
    ridge = math.sin(x * 0.00058 + phase) * math.cos(z * 0.00047 - phase)
    hills = math.sin((x + z) * 0.00024 + phase * 1.7) * 0.58
    valley = math.sin((x - z) * 0.00019 - phase * 0.8) * 0.34
    peak_x = math.sin(phase * 1.3) * 2_500
    peak_z = math.cos(phase * 0.9) * 2_700
    peak = max(0.0, 1 - math.hypot(x - peak_x, z - peak_z) / 3_600) ** 2 * 780
    far_peak = max(0.0, 1 - math.hypot(x + 3_100, z - 2_100) / 2_700) ** 2 * 520
    return 90 + ridge * 330 + hills * 230 + valley * 125 + peak + far_peak


@dataclass
class FlightConfig:
    seed: int = 42
    spawn_distance_m: float = 5_000
    initial_altitude_m: float = 120
    max_speed_mps: float = 18
    wind_speed_mps: float = 0
    destination_x_m: float = 3_100
    destination_z_m: float = 850


class OpenWorldSimulation:
    """Owns one flight and advances only when explicitly started and polled."""

    def __init__(self) -> None:
        self.config = FlightConfig()
        self.status: Literal["standby", "active", "paused", "stopped", "complete"] = "standby"
        self.scenario_id: str | None = None
        self.drone_id: str | None = None
        self.sim_time = 0.0
        self.position = (0.0, 0.0, 0.0)
        self.spawn = (0.0, 0.0, 0.0)
        self.distance_travelled = 0.0
        self.speed = 0.0
        self.heading = 0.0
        self._last_tick: float | None = None
        self._config_hash = ""

    def start(self, config: FlightConfig) -> dict:
        if self.status in {"active", "paused"}:
            raise ValueError("A scenario is already active; stop or reset it first")
        if not 100 <= config.spawn_distance_m <= 10_000:
            raise ValueError("spawn_distance_m must be between 100 and 10000")
        if not 20 <= config.initial_altitude_m <= 500:
            raise ValueError("initial_altitude_m must be between 20 and 500")
        if not 1 <= config.max_speed_mps <= 60:
            raise ValueError("max_speed_mps must be between 1 and 60")
        if not 0 <= config.wind_speed_mps <= 20:
            raise ValueError("wind_speed_mps must be between 0 and 20")
        for value in (config.destination_x_m, config.destination_z_m):
            if abs(value) > MAX_WORLD_METERS:
                raise ValueError("Destination must be inside the 12 km world")

        self.config = config
        canonical = (
            f"{config.seed}:{config.spawn_distance_m}:{config.initial_altitude_m}:"
            f"{config.max_speed_mps}:{config.wind_speed_mps}:"
            f"{config.destination_x_m}:{config.destination_z_m}"
        )
        self._config_hash = hashlib.sha256(canonical.encode()).hexdigest()
        # Separate deterministic spawn generation: same config yields same spawn.
        angle_seed = (config.seed ^ 0x5EED1234) & 0xFFFFFFFF
        angle_seed = (angle_seed * 1664525 + 1013904223) & 0xFFFFFFFF
        angle = angle_seed / 0x1_0000_0000 * math.tau
        sx = config.destination_x_m + math.cos(angle) * config.spawn_distance_m
        sz = config.destination_z_m + math.sin(angle) * config.spawn_distance_m
        sx = max(-MAX_WORLD_METERS, min(MAX_WORLD_METERS, sx))
        sz = max(-MAX_WORLD_METERS, min(MAX_WORLD_METERS, sz))
        sy = terrain_height(sx, sz, config.seed) + config.initial_altitude_m
        self.spawn = (sx, sy, sz)
        self.position = self.spawn
        self.distance_travelled = 0.0
        self.speed = 0.0
        self.heading = self._heading_to_destination(sx, sz)
        self.sim_time = 0.0
        self.scenario_id = f"OW-{config.seed:08d}-{self._config_hash[:8]}"
        self.drone_id = f"DRN-{self._config_hash[8:14].upper()}"
        self.status = "active"
        self._last_tick = monotonic()
        return self.snapshot()

    def pause(self) -> dict:
        self._advance()
        if self.status != "active":
            raise ValueError("Only an active scenario can be paused")
        self.status = "paused"
        self._last_tick = None
        return self.snapshot()

    def resume(self) -> dict:
        if self.status != "paused":
            raise ValueError("Only a paused scenario can be resumed")
        self.status = "active"
        self._last_tick = monotonic()
        return self.snapshot()

    def stop(self) -> dict:
        self._advance()
        if self.status not in {"active", "paused"}:
            raise ValueError("Only an active or paused scenario can be stopped")
        self.status = "stopped"
        self._last_tick = None
        return self.snapshot()

    def reset(self) -> dict:
        self.status = "standby"
        self.scenario_id = None
        self.drone_id = None
        self.sim_time = 0.0
        self.position = (0.0, 0.0, 0.0)
        self.spawn = (0.0, 0.0, 0.0)
        self.distance_travelled = 0.0
        self.speed = 0.0
        self.heading = 0.0
        self._last_tick = None
        return self.snapshot()

    def _destination(self) -> tuple[float, float]:
        return self.config.destination_x_m, self.config.destination_z_m

    def _heading_to_destination(self, x: float, z: float) -> float:
        dx = self.config.destination_x_m - x
        dz = self.config.destination_z_m - z
        return math.degrees(math.atan2(dx, -dz)) % 360

    def _advance(self) -> None:
        if self.status != "active" or self._last_tick is None:
            return
        now = monotonic()
        dt = min(max(now - self._last_tick, 0.0), 1.0)
        self._last_tick = now
        if dt <= 0:
            return
        self.sim_time += dt
        self.speed = min(self.config.max_speed_mps, self.speed + 3.0 * dt)
        x, y, z = self.position
        dx = self.config.destination_x_m - x
        dz = self.config.destination_z_m - z
        remaining = math.hypot(dx, dz)
        step = min(remaining, self.speed * dt)
        if remaining > 0:
            wind_angle = ((self.config.seed * 0.61803398875) % 1) * math.tau
            wind_drift = self.config.wind_speed_mps * 0.15
            vx = dx / remaining * self.speed + math.cos(wind_angle) * wind_drift
            vz = dz / remaining * self.speed + math.sin(wind_angle) * wind_drift
            ground_speed = math.hypot(vx, vz)
            step = min(remaining, ground_speed * dt)
            if ground_speed > 0:
                nx, nz = x + vx / ground_speed * step, z + vz / ground_speed * step
            else:
                nx, nz = x, z
            self.heading = math.degrees(math.atan2(vx, -vz)) % 360
            self.position = (nx, terrain_height(nx, nz, self.config.seed) + self.config.initial_altitude_m, nz)
            self.distance_travelled += step
            self.speed = ground_speed
        if remaining <= 150:
            self.position = (self.config.destination_x_m, terrain_height(*self._destination(), self.config.seed) + 2, self.config.destination_z_m)
            self.speed = 0.0
            self.status = "complete"
            self._last_tick = None

    def snapshot(self) -> dict:
        self._advance()
        x, y, z = self.position
        distance = math.hypot(self.config.destination_x_m - x, self.config.destination_z_m - z) if self.drone_id else 0.0
        return {
            "scenario_id": self.scenario_id,
            "drone_id": self.drone_id,
            "seed": self.config.seed,
            "sim_version": SIM_VERSION,
            "config_hash": self._config_hash,
            "status": self.status,
            "sim_time": round(self.sim_time, 3),
            "position": {"x": round(x, 2), "y": round(y, 2), "z": round(z, 2)},
            "spawn": {"x": round(self.spawn[0], 2), "y": round(self.spawn[1], 2), "z": round(self.spawn[2], 2)},
            "destination": {"x": self.config.destination_x_m, "y": terrain_height(self.config.destination_x_m, self.config.destination_z_m, self.config.seed), "z": self.config.destination_z_m, "radius_m": 150},
            "speed_mps": round(self.speed, 2),
            "heading_deg": round(self.heading, 1),
            "distance_remaining_m": round(distance, 2),
            "distance_travelled_m": round(self.distance_travelled, 2),
            "eta_seconds": round(distance / self.speed, 1) if self.speed > 0 else None,
            "altitude_m": round(y - terrain_height(x, z, self.config.seed), 2) if self.drone_id else 0.0,
            "source": "simulated",
        }
