
import numpy as np


def generate_spectrum(
    scenario: str = "idle",
    bins: int = 512,
    seed: int = 42,
) -> dict:
    """Generate reproducible, synthetic spectrum data."""

    if bins < 32 or bins > 4096:
        raise ValueError("bins must be between 32 and 4096")

    supported_scenarios = {"idle", "hobby", "fpv", "multi"}

    if scenario not in supported_scenarios:
        raise ValueError(
            f"scenario must be one of: {', '.join(sorted(supported_scenarios))}"
        )

    rng = np.random.default_rng(seed)

    # Synthetic relative power values, not calibrated RF measurements.
    noise_floor = -80.0
    power = noise_floor + rng.normal(0.0, 2.0, bins)

    # Add fictional peaks to selected scenarios.
    peak_counts = {
        "idle": 0,
        "hobby": 2,
        "fpv": 3,
        "multi": 6,
    }

    for _ in range(peak_counts[scenario]):
        center = int(rng.integers(bins // 10, bins - bins // 10))
        width = int(rng.integers(2, 8))
        amplitude = float(rng.uniform(12.0, 28.0))

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
