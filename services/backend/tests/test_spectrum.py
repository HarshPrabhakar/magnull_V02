
import pytest

from simulation.spectrum import generate_spectrum


def test_default_spectrum_has_expected_structure():
    result = generate_spectrum()

    assert result["mode"] == "simulation"
    assert result["scenario"] == "idle"
    assert result["synthetic"] is True
    assert result["bin_count"] == 512
    assert len(result["frequency_bins"]) == 512
    assert len(result["power"]) == 512
    assert result["noise_floor"] == -80.0
    assert result["seed"] == 42


def test_same_inputs_produce_identical_spectrum():
    first = generate_spectrum(
        scenario="fpv",
        bins=512,
        seed=123,
        frame_id=7,
    )
    second = generate_spectrum(
        scenario="fpv",
        bins=512,
        seed=123,
        frame_id=7,
    )

    assert first == second


def test_different_frames_can_produce_different_power():
    first = generate_spectrum(seed=42, frame_id=0)
    second = generate_spectrum(seed=42, frame_id=1)

    assert first["power"] != second["power"]


@pytest.mark.parametrize("scenario", ["idle", "hobby", "fpv", "multi"])
def test_supported_scenarios_return_valid_spectra(scenario):
    result = generate_spectrum(scenario=scenario)

    assert result["scenario"] == scenario
    assert result["bin_count"] == len(result["power"])
    assert result["synthetic"] is True


@pytest.mark.parametrize("bins", [31, 4097])
def test_invalid_bin_counts_are_rejected(bins):
    with pytest.raises(ValueError, match="bins must be between"):
        generate_spectrum(bins=bins)


@pytest.mark.parametrize("seed", [-1, 2147483648])
def test_invalid_seeds_are_rejected(seed):
    with pytest.raises(ValueError, match="seed must be between"):
        generate_spectrum(seed=seed)


def test_negative_frame_id_is_rejected():
    with pytest.raises(ValueError, match="frame_id must be non-negative"):
        generate_spectrum(frame_id=-1)


def test_unknown_scenario_is_rejected():
    with pytest.raises(ValueError, match="scenario must be one of"):
        generate_spectrum(scenario="unknown")
