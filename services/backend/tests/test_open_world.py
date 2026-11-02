import pytest

from simulation.open_world import FlightConfig, OpenWorldSimulation


def test_new_world_is_standby_without_spawn_or_motion():
    simulation = OpenWorldSimulation()
    state = simulation.snapshot()
    assert state["status"] == "standby"
    assert state["drone_id"] is None
    assert state["sim_time"] == 0
    assert state["position"] == {"x": 0, "y": 0, "z": 0}


def test_same_seed_and_config_create_same_spawn_and_scenario():
    first = OpenWorldSimulation().start(FlightConfig(seed=123))
    second = OpenWorldSimulation().start(FlightConfig(seed=123))
    assert first["spawn"] == second["spawn"]
    assert first["scenario_id"] == second["scenario_id"]
    assert first["config_hash"] == second["config_hash"]


def test_pause_freezes_state_and_resume_continues(monkeypatch):
    now = [100.0]
    monkeypatch.setattr("simulation.open_world.monotonic", lambda: now[0])
    simulation = OpenWorldSimulation()
    initial = simulation.start(FlightConfig(spawn_distance_m=1_000))
    now[0] += 1
    moving = simulation.snapshot()
    assert moving["sim_time"] == pytest.approx(1.0)
    assert moving["position"] != initial["position"]

    paused = simulation.pause()
    now[0] += 5
    still_paused = simulation.snapshot()
    assert still_paused["sim_time"] == paused["sim_time"]
    assert still_paused["position"] == paused["position"]

    simulation.resume()
    now[0] += 1
    resumed = simulation.snapshot()
    assert resumed["sim_time"] == pytest.approx(paused["sim_time"] + 1)
    assert resumed["position"] != paused["position"]


def test_stop_preserves_partial_flight_and_reset_clears_it(monkeypatch):
    now = [200.0]
    monkeypatch.setattr("simulation.open_world.monotonic", lambda: now[0])
    simulation = OpenWorldSimulation()
    started = simulation.start(FlightConfig(spawn_distance_m=1_000))
    now[0] += 1
    stopped = simulation.stop()
    assert stopped["status"] == "stopped"
    assert stopped["drone_id"] == started["drone_id"]
    assert stopped["sim_time"] > 0
    assert stopped["position"] != started["position"]

    reset = simulation.reset()
    assert reset["status"] == "standby"
    assert reset["drone_id"] is None
    assert reset["sim_time"] == 0


@pytest.mark.parametrize("field,value", [
    ("spawn_distance_m", 99),
    ("initial_altitude_m", 501),
    ("max_speed_mps", 61),
    ("destination_x_m", 6_001),
])
def test_invalid_flight_configuration_is_rejected(field, value):
    values = FlightConfig().__dict__
    values[field] = value
    with pytest.raises(ValueError):
        OpenWorldSimulation().start(FlightConfig(**values))


