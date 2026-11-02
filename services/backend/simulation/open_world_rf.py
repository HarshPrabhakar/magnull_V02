"""Deterministic, simulation-only RF and hopping analysis for an Open World flight."""

from __future__ import annotations

import hashlib
import math
from collections import deque
from dataclasses import dataclass

from simulation.spectrum import generate_spectrum


@dataclass(frozen=True)
class RFProfile:
    label: str
    center_mhz: float
    bandwidth_mhz: float
    channels: int
    dwell_seconds: float
    reference_power_dbm: float


RF_PROFILES = {
    "generic_fhss": RFProfile("Generic FHSS · synthetic", 2_440.0, 20.0, 12, 0.018, -34.0),
    "elrs_like": RFProfile("ELRS-like · illustrative", 2_440.0, 20.0, 20, 0.025, -31.0),
    "ocusync_like": RFProfile("OcuSync-like · illustrative", 2_440.0, 40.0, 8, 0.040, -28.0),
    "afhds_like": RFProfile("AFHDS-like · illustrative", 2_440.0, 20.0, 16, 0.022, -33.0),
    "analog_fpv_like": RFProfile("Analog FPV-like · illustrative", 5_800.0, 20.0, 1, 0.250, -30.0),
    "unknown_hopping": RFProfile("Unknown synthetic hopping", 2_440.0, 16.0, 10, 0.030, -36.0),
}

MAX_RF_HISTORY = 2_000
SPECTRUM_BINS = 512
RF_SIM_VERSION = "0.2.0"


class OpenWorldRFSource:
    """Produces reproducible hopping events and spectrum measurements on sim time."""

    def __init__(self, scenario_id: str, seed: int, profile_id: str, interference_db: float = 0.0, config_hash: str = ""):
        if profile_id not in RF_PROFILES:
            raise ValueError("Unsupported synthetic RF profile")
        if not 0 <= interference_db <= 30:
            raise ValueError("interference_db must be between 0 and 30")
        self.scenario_id = scenario_id
        self.seed = seed
        self.profile_id = profile_id
        self.profile = RF_PROFILES[profile_id]
        self.interference_db = interference_db
        self.config_hash = config_hash or hashlib.sha256(f"{scenario_id}:{seed}:{profile_id}:{interference_db}".encode()).hexdigest()
        self.source_id = f"SRC-{hashlib.sha256(f'{scenario_id}:{profile_id}'.encode()).hexdigest()[:6].upper()}"
        self.generated_events: deque[dict] = deque(maxlen=MAX_RF_HISTORY)
        self.observed_events: deque[dict] = deque(maxlen=MAX_RF_HISTORY)
        self.last_event_index = -1
        self.observed_total = 0
        self.channel_changes_total = 0
        self.expected_total = 0
        self.last_observed_channel: int | None = None
        self.last_distance = 0.0
        self.last_received_power = self.profile.reference_power_dbm
        self.last_noise_floor = -90.0 + interference_db
        self.last_snr = self.last_received_power - self.last_noise_floor
        self.last_sim_time = 0.0
        self.last_status = "active"

    def _channel_for(self, event_index: int) -> int:
        digest = hashlib.sha256(f"{self.seed}:{self.profile_id}:{event_index}".encode()).digest()
        channel = int.from_bytes(digest[:4], "big") % self.profile.channels
        if event_index and self.generated_events:
            previous = self.generated_events[-1]["channel_index"]
            if channel == previous and self.profile.channels > 1:
                channel = (channel + 1 + digest[4] % (self.profile.channels - 1)) % self.profile.channels
        return channel

    def _frequency(self, channel_index: int) -> float:
        if self.profile.channels == 1:
            return self.profile.center_mhz
        low = self.profile.center_mhz - self.profile.bandwidth_mhz / 2
        return low + channel_index * self.profile.bandwidth_mhz / (self.profile.channels - 1)

    def _measure_power(self, sim_time: float, distance: float) -> tuple[float, float, float]:
        noise_floor = -90.0 + self.interference_db
        path_loss = 20 * math.log10(1 + distance / 100.0)
        phase = (self.seed % 997) * 0.013 + sim_time * 0.73 + distance * 0.001
        fading = 1.5 * math.sin(phase)
        received = self.profile.reference_power_dbm - path_loss + fading
        return received, noise_floor, received - noise_floor

    def _generate_through(self, sim_time: float, received_power: float, snr: float) -> None:
        current_index = max(0, math.floor(sim_time / self.profile.dwell_seconds))
        self.expected_total = current_index + 1
        dropout_probability = min(0.45, max(0.0, (18.0 - snr) / 40.0))

        for event_index in range(self.last_event_index + 1, current_index + 1):
            channel = self._channel_for(event_index)
            event_time = event_index * self.profile.dwell_seconds
            digest = hashlib.sha256(f"obs:{self.seed}:{self.profile_id}:{event_index}".encode()).digest()
            duration_factor = 0.72 + (int.from_bytes(digest[:2], "big") / 65535) * 0.5
            event = {
                "event_index": event_index,
                "sim_time": round(event_time, 4),
                "channel_index": channel,
                "frequency_mhz": round(self._frequency(channel), 4),
                "duration_ms": round(self.profile.dwell_seconds * duration_factor * 1_000, 2),
                "received_power_dbm": round(received_power, 2),
                "visible": snr >= 3.0 and int.from_bytes(digest[2:4], "big") / 65535 >= dropout_probability,
            }
            self.generated_events.append(event)
            if event["visible"]:
                if self.last_observed_channel is not None and channel != self.last_observed_channel:
                    self.channel_changes_total += 1
                self.last_observed_channel = channel
                self.observed_total += 1
                self.observed_events.append(event)
            self.last_event_index = event_index

    def _periodicity(self, channels: list[int]) -> int | None:
        count = len(channels)
        for period in range(1, count // 2 + 1):
            if all(channels[index] == channels[index % period] for index in range(period, count)):
                return period
        return None

    def snapshot(self, sim_time: float, position: dict[str, float], status: str) -> dict:
        self.last_sim_time = sim_time
        self.last_status = status
        distance = math.hypot(position["x"], position["z"])
        received, noise_floor, snr = self._measure_power(sim_time, distance)
        self.last_distance = distance
        self.last_received_power = received
        self.last_noise_floor = noise_floor
        self.last_snr = snr
        self._generate_through(sim_time, received, snr)

        observed = list(self.observed_events)
        generated = list(self.generated_events)
        recent = observed[-120:]
        channels = [event["channel_index"] for event in recent]
        channel_counts = {index: 0 for index in range(self.profile.channels)}
        for event in observed:
            channel_counts[event["channel_index"]] += 1
        observed_count = len(observed)
        occupancy = [
            {
                "channel_index": index,
                "frequency_mhz": round(self._frequency(index), 4),
                "event_count": count,
                "occupancy_percent": round(count / max(1, observed_count) * 100, 2),
            }
            for index, count in channel_counts.items()
        ]

        per_event_dwell = [
            (right["sim_time"] - left["sim_time"]) * 1_000 / max(1, right["event_index"] - left["event_index"])
            for left, right in zip(recent, recent[1:])
        ]
        estimated_dwell = sum(per_event_dwell) / len(per_event_dwell) if per_event_dwell else None
        intervals = [(right["sim_time"] - left["sim_time"]) * 1_000 for left, right in zip(recent, recent[1:])]
        durations = [event["duration_ms"] for event in recent]
        occupied = sorted({event["frequency_mhz"] for event in observed})
        latest = generated[-1] if generated else None
        channel = latest["channel_index"] if latest else 0
        center_bin = round((self._frequency(channel) - (self.profile.center_mhz - self.profile.bandwidth_mhz / 2)) / self.profile.bandwidth_mhz * (SPECTRUM_BINS - 1))
        peak_specs = [(center_bin, max(2, min(7, round(SPECTRUM_BINS / max(self.profile.channels, 1) / 5))), max(0.0, snr))] if latest and snr >= 3.0 else []
        spectrum = generate_spectrum(
            scenario="multi",
            bins=SPECTRUM_BINS,
            seed=self.seed,
            frame_id=max(0, round(sim_time * 5)),
            peak_specs=peak_specs,
            noise_floor_db=noise_floor,
        )
        low_frequency = self.profile.center_mhz - self.profile.bandwidth_mhz / 2
        frequencies = [round(low_frequency + index * self.profile.bandwidth_mhz / (SPECTRUM_BINS - 1), 4) for index in range(SPECTRUM_BINS)]
        profile_is_hopping = self.profile.channels > 1
        periodicity = self._periodicity(channels) if len(channels) >= 4 else None
        confidence = min(0.98, max(0.25, 0.45 + max(0.0, snr) / 100))
        if snr < 3.0:
            classification = "NO OBSERVABLE SYNTHETIC SIGNAL"
            confidence = 0.0
        elif self.profile_id == "unknown_hopping":
            classification = "UNKNOWN SYNTHETIC HOPPING · UNCONFIRMED"
            confidence = min(confidence, 0.62)
        elif profile_is_hopping:
            classification = f"APPROXIMATE SYNTHETIC {self.profile.label.upper()}"
        else:
            classification = "APPROXIMATE SYNTHETIC FIXED-CHANNEL SOURCE"

        return {
            "scenario_id": self.scenario_id,
            "seed": self.seed,
            "sim_version": RF_SIM_VERSION,
            "config_hash": self.config_hash,
            "sim_time": round(sim_time, 3),
            "status": status,
            "source_id": self.source_id,
            "profile": self.profile_id,
            "profile_label": self.profile.label,
            "classification": classification,
            "classification_confidence": round(confidence, 3),
            "center_frequency_mhz": self.profile.center_mhz,
            "bandwidth_mhz": self.profile.bandwidth_mhz,
            "current_frequency_mhz": latest["frequency_mhz"] if latest else self.profile.center_mhz,
            "distance_m": round(distance, 2),
            "received_power_dbm": round(received, 2),
            "noise_floor_dbm": round(noise_floor, 2),
            "snr_db": round(snr, 2),
            "expected_event_count": self.expected_total,
            "observed_event_count": self.observed_total,
            "missing_event_count": max(0, self.expected_total - self.observed_total),
            "observed_channel_changes": self.channel_changes_total,
            "estimated_dwell_ms": round(estimated_dwell, 2) if estimated_dwell is not None else None,
            "estimated_hop_rate_hz": round(1_000 / estimated_dwell, 2) if estimated_dwell and profile_is_hopping else None,
            "observed_channel_count": len(set(event["channel_index"] for event in observed)),
            "occupied_frequency_range_mhz": [occupied[0], occupied[-1]] if occupied else None,
            "sequence_periodicity": periodicity,
            "channel_occupancy": occupancy,
            "burst_duration_distribution_ms": durations[-60:],
            "inter_burst_intervals_ms": intervals[-60:],
            "generated_events": generated[-80:],
            "observed_events": observed[-80:],
            "spectrum_frequency_mhz": frequencies,
            "spectrum_power_db": spectrum["power"],
            "source": "simulated",
            "synthetic": True,
        }


def idle_rf_state() -> dict:
    return {
        "scenario_id": None,
        "seed": 0,
        "sim_version": RF_SIM_VERSION,
        "config_hash": "",
        "sim_time": 0.0,
        "status": "idle",
        "source_id": None,
        "profile": None,
        "profile_label": None,
        "classification": None,
        "classification_confidence": None,
        "center_frequency_mhz": None,
        "bandwidth_mhz": None,
        "current_frequency_mhz": None,
        "distance_m": None,
        "received_power_dbm": None,
        "noise_floor_dbm": None,
        "snr_db": None,
        "expected_event_count": 0,
        "observed_event_count": 0,
        "missing_event_count": 0,
        "observed_channel_changes": 0,
        "estimated_dwell_ms": None,
        "estimated_hop_rate_hz": None,
        "observed_channel_count": 0,
        "occupied_frequency_range_mhz": None,
        "sequence_periodicity": None,
        "channel_occupancy": [],
        "burst_duration_distribution_ms": [],
        "inter_burst_intervals_ms": [],
        "generated_events": [],
        "observed_events": [],
        "spectrum_frequency_mhz": [],
        "spectrum_power_db": [],
        "source": "simulated",
        "synthetic": True,
    }
