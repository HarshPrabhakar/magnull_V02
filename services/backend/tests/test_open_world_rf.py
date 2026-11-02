import pytest

from schemas.open_world import FlightStartRequest
from schemas.open_world_rf import OpenWorldRFState
from schemas.open_world_snapshot import OpenWorldSimulationSnapshot
from simulation.open_world import FlightConfig, OpenWorldSimulation
from simulation.open_world_rf import OpenWorldRFSource


def test_rf_engine_is_idle_until_flight_start_and_freezes_on_pause(monkeypatch):
    now = [100.0]
    monkeypatch.setattr("simulation.open_world.monotonic", lambda: now[0])
    simulation = OpenWorldSimulation()

    idle = simulation.rf_snapshot()
    assert idle["status"] == "idle"
    assert idle["expected_event_count"] == 0
    assert idle["spectrum_power_db"] == []

    simulation.start(FlightConfig(spawn_distance_m=1_000, rf_profile="generic_fhss"))
    now[0] += 0.2
    flight = simulation.snapshot()
    active = simulation.rf_snapshot()
    OpenWorldRFState.model_validate(active)
    assert active["status"] == "active"
    assert active["scenario_id"] == flight["scenario_id"]
    assert active["expected_event_count"] > 1
    assert active["observed_event_count"] + active["missing_event_count"] == active["expected_event_count"]
    assert active["estimated_dwell_ms"] == pytest.approx(18.0, abs=0.1)
    assert len(active["spectrum_power_db"]) == 512

    paused = simulation.pause()
    now[0] += 10
    frozen = simulation.rf_snapshot()
    assert frozen["status"] == "paused"
    assert frozen["sim_time"] == paused["sim_time"]
    assert frozen["expected_event_count"] == active["expected_event_count"]
    assert frozen["observed_events"] == active["observed_events"]


def test_rf_sequence_and_measurements_are_reproducible():
    arguments = ("OW-00000042-test", 42, "elrs_like")
    position = {"x": 800.0, "y": 150.0, "z": -200.0}
    first = OpenWorldRFSource(*arguments).snapshot(0.5, position, "active")
    second = OpenWorldRFSource(*arguments).snapshot(0.5, position, "active")

    assert first == second
    assert first["generated_events"]
    assert first["observed_events"]
    assert first["channel_occupancy"]
    assert first["source_id"] is not None
    assert first["estimated_dwell_ms"] == pytest.approx(25.0, abs=0.1)
    assert sum(channel["occupancy_percent"] for channel in first["channel_occupancy"]) == pytest.approx(100.0, abs=0.1)
    assert first["burst_duration_distribution_ms"]
    assert first["inter_burst_intervals_ms"]


def test_rf_configuration_changes_scenario_identity():
    generic = OpenWorldSimulation().start(FlightConfig(seed=42, rf_profile="generic_fhss"))
    elrs_like = OpenWorldSimulation().start(FlightConfig(seed=42, rf_profile="elrs_like"))

    assert generic["scenario_id"] != elrs_like["scenario_id"]
    assert generic["config_hash"] != elrs_like["config_hash"]


def test_hopping_periodicity_is_reported_only_for_repeated_observations():
    source = OpenWorldRFSource("OW-period", 23, "generic_fhss")

    assert source._periodicity([2, 5, 2, 5, 2, 5]) == 2
    assert source._periodicity([1, 4, 2, 7, 3, 8]) is None


def test_rf_power_and_spectrum_respond_to_source_distance():
    near_source = OpenWorldRFSource("OW-near", 9, "generic_fhss")
    far_source = OpenWorldRFSource("OW-far", 9, "generic_fhss")
    near = near_source.snapshot(0.0, {"x": 100.0, "y": 100.0, "z": 0.0}, "active")
    far = far_source.snapshot(0.0, {"x": 9_000.0, "y": 100.0, "z": 0.0}, "active")

    assert near["received_power_dbm"] > far["received_power_dbm"]
    assert near["snr_db"] > far["snr_db"]
    assert max(near["spectrum_power_db"]) > max(far["spectrum_power_db"])


def test_interference_can_hide_expected_rf_events():
    source = OpenWorldRFSource("OW-interference", 12, "unknown_hopping", interference_db=30)
    state = source.snapshot(1.0, {"x": 10_000.0, "y": 100.0, "z": 0.0}, "active")

    assert state["expected_event_count"] > 0
    assert state["missing_event_count"] > 0
    assert state["observed_event_count"] < state["expected_event_count"]
    assert state["classification"] == "NO OBSERVABLE SYNTHETIC SIGNAL"


def test_rf_api_uses_the_active_open_world_scenario(monkeypatch):
    from api import main as backend_main

    now = [700.0]
    monkeypatch.setattr("simulation.open_world.monotonic", lambda: now[0])
    monkeypatch.setattr(backend_main, "open_world_simulation", OpenWorldSimulation())
    request = FlightStartRequest(
        seed=42,
        spawn_distance_m=1_000,
        initial_altitude_m=120,
        max_speed_mps=18,
        wind_speed_mps=0,
        destination_x_m=3_100,
        destination_z_m=850,
        rf_profile="ocusync_like",
        interference_db=6,
    )

    idle = backend_main.open_world_rf_state()
    assert idle["status"] == "idle"
    started = backend_main.start_open_world(request)
    now[0] += 0.1
    flight = backend_main.open_world_state()
    rf = backend_main.open_world_rf_state()
    snapshot = backend_main.open_world_snapshot()
    OpenWorldRFState.model_validate(rf)
    OpenWorldSimulationSnapshot.model_validate(snapshot)

    assert rf["scenario_id"] == started["scenario_id"]
    assert rf["scenario_id"] == flight["scenario_id"]
    assert rf["config_hash"] == flight["config_hash"]
    assert rf["seed"] == flight["seed"]
    assert rf["profile"] == "ocusync_like"
    assert rf["sim_time"] == flight["sim_time"]
    assert rf["status"] == "active"
    assert snapshot["flight"]["scenario_id"] == snapshot["rf"]["scenario_id"]
    assert snapshot["flight"]["sim_time"] == snapshot["rf"]["sim_time"]

