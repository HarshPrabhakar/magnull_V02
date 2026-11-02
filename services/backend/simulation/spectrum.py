
import numpy as np


def generate_spectrum(
    scenario: str = "idle",
    bins: int = 512,
    seed: int = 42,
    frame_id: int = 0,
    peak_specs: list[tuple[int, int, float]] | None = None,
    noise_floor_db: float = -80.0,
) -> dict:
    """Generate reproducible synthetic spectrum data, optionally using known event peaks."""

    if bins < 32 or bins > 4096:
        raise ValueError("bins must be between 32 and 4096")

    if seed < 0 or seed > 2147483647:
        raise ValueError("seed must be between 0 and 2147483647")

    if frame_id < 0:
        raise ValueError("frame_id must be non-negative")

    supported_scenarios = {"idle", "hobby", "fpv", "multi"}
    if scenario not in supported_scenarios:
        raise ValueError(
            f"scenario must be one of: {', '.join(sorted(supported_scenarios))}"
        )

    # Signal layout uses a fixed seed, so peak positions remain stable.
    signal_rng = np.random.default_rng(seed)

    # Noise and strength variation evolve deterministically per frame.
    frame_seed = (seed + frame_id * 104729) % (2**32)
    frame_rng = np.random.default_rng(frame_seed)

    if not np.isfinite(noise_floor_db):
        raise ValueError("noise_floor_db must be finite")
    noise_floor = float(noise_floor_db)
    power = noise_floor + frame_rng.normal(0.0, 2.0, bins)

    peak_counts = {
        "idle": 0,
        "hobby": 2,
        "fpv": 3,
        "multi": 6,
    }

    is_custom = peak_specs is not None
    if peak_specs is None:
        specs = [
            (
                int(signal_rng.integers(bins // 10, bins - bins // 10)),
                int(signal_rng.integers(2, 8)),
                float(signal_rng.uniform(12.0, 28.0)),
            )
            for _ in range(peak_counts[scenario])
        ]
    else:
        specs = peak_specs

    for center, width, base_amplitude in specs:
        if not 0 <= center < bins or not 1 <= width <= bins // 2 or not np.isfinite(base_amplitude):
            raise ValueError("peak_specs must contain valid finite spectrum peaks")
        # Keep event locations stable while deterministic frame noise changes their level slightly.
        amplitude_variation = float(frame_rng.normal(0.0, 0.3 if is_custom else 0.6))
        amplitude = max(0.0, float(base_amplitude) + amplitude_variation)

        start = max(0, center - width * 3)
        end = min(bins, center + width * 3 + 1)
        x = np.arange(start, end)

        power[start:end] += amplitude * np.exp(
            -0.5 * ((x - center) / width) ** 2
        )

    return {
        "mode": "simulation",
        "scenario": scenario,
        "synthetic": True,
        "units": "relative_dB",
        "bin_count": bins,
        "frequency_bins": list(range(bins)),
        "power": np.round(power, 2).tolist(),
        "noise_floor": noise_floor,
        "seed": seed,
    }
