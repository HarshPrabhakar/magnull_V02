
import numpy as np


def generate_spectrum(
    scenario: str = "idle",
    bins: int = 512,
    seed: int = 42,
    frame_id: int = 0,
) -> dict:
    """Generate reproducible synthetic spectrum data with stable signal positions."""

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

    noise_floor = -80.0
    power = noise_floor + frame_rng.normal(0.0, 2.0, bins)

    peak_counts = {
        "idle": 0,
        "hobby": 2,
        "fpv": 3,
        "multi": 6,
    }

    for _ in range(peak_counts[scenario]):
        center = int(
            signal_rng.integers(bins // 10, bins - bins // 10)
        )
        width = int(signal_rng.integers(2, 8))
        base_amplitude = float(signal_rng.uniform(12.0, 28.0))

        # Small controlled variation instead of relocating the peak.
        amplitude_variation = float(frame_rng.normal(0.0, 0.6))
        amplitude = max(1.0, base_amplitude + amplitude_variation)

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
