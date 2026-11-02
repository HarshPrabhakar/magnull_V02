import { useCallback, useEffect, useState } from "react";
import {
  OpenWorldScene,
  type CameraCommand,
  type EnvironmentMode,
  type SceneSettings,
  type WorldPoint,
} from "./OpenWorldScene";
import { terrainHeight } from "./worldMath";
import { controlFlight, fetchFlightState, startFlight, type FlightState } from "./openWorldApi";

const INITIAL_SEED = 42;

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="open-world-metric-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export default function OpenWorldPage() {
  const [seed, setSeed] = useState(INITIAL_SEED);
  const [seedText, setSeedText] = useState(String(INITIAL_SEED));
  const [mode, setMode] = useState<EnvironmentMode>("technical");
  const [cameraCommand, setCameraCommand] = useState<CameraCommand>({
    view: "overview",
    revision: 0,
  });
  const [sceneSettings, setSceneSettings] = useState<SceneSettings>({
    terrainVisible: true,
    terrainGrid: true,
    coordinateGrid: true,
    roadsVisible: true,
    buildingsVisible: true,
    forestVisible: true,
    lighting: "day",
    visibilityMeters: 14_000,
  });
  const [windSpeed, setWindSpeed] = useState(0);
  const [spawnDistance, setSpawnDistance] = useState(5_000);
  const [initialAltitude, setInitialAltitude] = useState(120);
  const [maxSpeed, setMaxSpeed] = useState(18);
  const [flight, setFlight] = useState<FlightState | null>(null);
  const [simulationError, setSimulationError] = useState("");
  const [serviceAvailable, setServiceAvailable] = useState(false);
  const [destination, setDestination] = useState<WorldPoint>({ x: 3_100, z: 850 });
  const [destinationPicking, setDestinationPicking] = useState(false);
  const [inspectedPoint, setInspectedPoint] = useState<WorldPoint | null>(null);
  const [worldEvents, setWorldEvents] = useState([
    `World generated from seed ${INITIAL_SEED}`,
    "Idle: no flight or RF events have been generated",
  ]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const refresh = async () => {
      try {
        const state = await fetchFlightState();
        if (cancelled) return;
        setFlight(state);
        setServiceAvailable(true);
        if (state.status === "active" && timer === undefined) {
          timer = window.setInterval(() => {
            void fetchFlightState().then((next) => {
              if (!cancelled) setFlight(next);
            }).catch((error: unknown) => {
              if (!cancelled) setSimulationError(error instanceof Error ? error.message : "Simulation service disconnected");
            });
          }, 200);
        } else if (state.status !== "active" && timer !== undefined) {
          window.clearInterval(timer);
          timer = undefined;
        }
      } catch (error) {
        if (!cancelled) {
          setServiceAvailable(false);
          setSimulationError(error instanceof Error ? error.message : "Simulation service unavailable");
          if (timer === undefined) timer = window.setInterval(() => void refresh(), 2_000);
        }
      }
    };
    void refresh();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [flight?.status]);

  const runFlightAction = async (action: "start" | "pause" | "resume" | "stop" | "reset") => {
    setSimulationError("");
    try {
      const next = action === "start"
        ? await startFlight({ seed, spawn_distance_m: spawnDistance, initial_altitude_m: initialAltitude, max_speed_mps: maxSpeed, wind_speed_mps: windSpeed, destination_x_m: destination.x, destination_z_m: destination.z })
        : await controlFlight(action);
      setFlight(next);
      setServiceAvailable(true);
      recordWorldEvent(action === "start"
        ? `Scenario ${next.scenario_id} started · drone ${next.drone_id} spawned`
        : `Scenario ${action} · simulation ${next.status}`);
    } catch (error) {
      setSimulationError(error instanceof Error ? error.message : "Simulation request failed");
    }
  };

  const flightLocked = flight?.status === "active" || flight?.status === "paused";
  const scenarioConfigured = Boolean(flight?.drone_id);
  const simClock = flight ? new Date(flight.sim_time * 1000).toISOString().slice(11, 19) : "00:00:00";

  const recordWorldEvent = useCallback((message: string) => {
    setWorldEvents((previous) => [message, ...previous].slice(0, 12));
  }, []);

  const updateSeed = (text: string) => {
    setSeedText(text);
    const nextSeed = Number(text);
    if (
      Number.isInteger(nextSeed) &&
      nextSeed >= 0 &&
      nextSeed <= 2_147_483_647
    ) {
      setSeed(nextSeed);
    }
  };

  const generateEnvironment = () => {
    if (flightLocked) return;
    const randomSeed = new Uint32Array(1);
    window.crypto.getRandomValues(randomSeed);
    const nextSeed = randomSeed[0] % 2_147_483_648;
    setSeed(nextSeed);
    setSeedText(String(nextSeed));
    setInspectedPoint(null);
    recordWorldEvent(`New terrain generated from seed ${nextSeed}`);
  };

  const setCameraView = (view: CameraCommand["view"]) => {
    setCameraCommand((current) => ({ view, revision: current.revision + 1 }));
  };

  const handleTerrainClick = useCallback((point: WorldPoint) => {
    const roundedPoint = {
      x: Math.round(point.x / 10) * 10,
      z: Math.round(point.z / 10) * 10,
    };
    setInspectedPoint(roundedPoint);

    if (destinationPicking) {
      setDestination(roundedPoint);
      setDestinationPicking(false);
      recordWorldEvent(
        `SAFE ZONE-01 moved to X ${roundedPoint.x} m · Z ${roundedPoint.z} m`,
      );
    }
  }, [destinationPicking, recordWorldEvent]);

  const updateSceneSetting = <Key extends keyof SceneSettings>(
    key: Key,
    value: SceneSettings[Key],
  ) => {
    setSceneSettings((current) => ({ ...current, [key]: value }));
  };

  const destinationElevation = Math.round(
    terrainHeight(destination.x, destination.z, seed),
  );

  return (
    <main className="open-world-page">
      <header className="open-world-page-header">
        <div>
          <h2>OPEN WORLD ANALYSIS</h2>
          <p>Seeded terrain and camera workspace</p>
        </div>
        <div className="open-world-status-strip" aria-label="Simulation status">
          <span className={`open-world-status-item ${flight?.status === "active" ? "active" : ""}`}><i /> SIMULATION: {flight?.status?.toUpperCase() ?? "STANDBY"}</span>
          <span className="open-world-status-item"><i /> WORLD: READY</span>
          <span className={`open-world-status-item ${flight?.drone_id ? "active" : "muted"}`}><i /> DRONE: {flight?.drone_id ? flight.status === "complete" ? "LANDED" : flight.status === "stopped" ? "STOPPED" : "AIRBORNE" : "NOT SPAWNED"}</span>
          <span className="open-world-status-item muted"><i /> RF: IDLE · PHASE 5</span>
        </div>
      </header>

      <div className="open-world-layout">
        <aside className="open-world-sidebar open-world-config" aria-label="World configuration">
          <div className="open-world-panel-heading">WORLD CONFIGURATION</div>

          <label className="open-world-field">
            <span>Scenario seed</span>
            <input
              type="number"
              min={0}
              max={2_147_483_647}
              step={1}
              value={seedText}
              disabled={scenarioConfigured}
              aria-describedby="world-seed-help"
              onChange={(event) => updateSeed(event.target.value)}
            />
            <small id="world-seed-help">Same seed generates the same terrain.</small>
          </label>

          <label className="open-world-field">
            <span>Spawn distance <strong>{(spawnDistance / 1_000).toFixed(1)} km</strong></span>
            <input type="range" min={500} max={10_000} step={500} value={spawnDistance} disabled={scenarioConfigured} onChange={(event) => setSpawnDistance(Number(event.target.value))} />
          </label>
          <label className="open-world-field">
            <span>Initial altitude <strong>{initialAltitude} m AGL</strong></span>
            <input type="range" min={20} max={500} step={10} value={initialAltitude} disabled={scenarioConfigured} onChange={(event) => setInitialAltitude(Number(event.target.value))} />
          </label>
          <label className="open-world-field">
            <span>Maximum speed <strong>{maxSpeed} m/s</strong></span>
            <input type="range" min={5} max={40} step={1} value={maxSpeed} disabled={scenarioConfigured} onChange={(event) => setMaxSpeed(Number(event.target.value))} />
          </label>

          <div className="open-world-field">
            <span>Environment presentation</span>
            <div className="open-world-segmented" role="group" aria-label="Environment presentation">
              <button
                type="button"
                className={mode === "technical" ? "selected" : ""}
                aria-pressed={mode === "technical"}
                onClick={() => setMode("technical")}
              >
                TECHNICAL
              </button>
              <button
                type="button"
                className={mode === "realistic" ? "selected" : ""}
                aria-pressed={mode === "realistic"}
                onClick={() => setMode("realistic")}
              >
                TERRAIN
              </button>
            </div>
          </div>

          <div className="open-world-config-facts">
            <MetricRow label="WORLD EXTENT" value="12 × 12 km" />
            <MetricRow label="DISTANCE UNITS" value="Virtual metres" />
            <MetricRow label="WORLD SEED" value={String(seed)} />
          </div>

          <div className="open-world-section-divider">WORLD LAYERS</div>
          <div className="open-world-toggle-list">
            <label><input type="checkbox" checked={sceneSettings.terrainVisible} onChange={(event) => updateSceneSetting("terrainVisible", event.target.checked)} /> Terrain surface</label>
            <label><input type="checkbox" checked={sceneSettings.terrainGrid} onChange={(event) => updateSceneSetting("terrainGrid", event.target.checked)} /> Terrain wireframe</label>
            <label><input type="checkbox" checked={sceneSettings.coordinateGrid} onChange={(event) => updateSceneSetting("coordinateGrid", event.target.checked)} /> Coordinate grid</label>
            <label><input type="checkbox" checked={sceneSettings.roadsVisible} onChange={(event) => updateSceneSetting("roadsVisible", event.target.checked)} /> Roads</label>
            <label><input type="checkbox" checked={sceneSettings.buildingsVisible} onChange={(event) => updateSceneSetting("buildingsVisible", event.target.checked)} /> Buildings</label>
            <label><input type="checkbox" checked={sceneSettings.forestVisible} onChange={(event) => updateSceneSetting("forestVisible", event.target.checked)} /> Forests</label>
          </div>

          <div className="open-world-section-divider">ENVIRONMENT</div>
          <div className="open-world-field open-world-lighting">
            <span>Lighting</span>
            <div className="open-world-segmented" role="group" aria-label="Lighting">
              <button type="button" className={sceneSettings.lighting === "day" ? "selected" : ""} aria-pressed={sceneSettings.lighting === "day"} onClick={() => updateSceneSetting("lighting", "day")}>DAYLIGHT</button>
              <button type="button" className={sceneSettings.lighting === "night" ? "selected" : ""} aria-pressed={sceneSettings.lighting === "night"} onClick={() => updateSceneSetting("lighting", "night")}>NIGHT</button>
            </div>
          </div>
          <label className="open-world-range-field">
            <span>Visibility <strong>{(sceneSettings.visibilityMeters / 1_000).toFixed(0)} km</strong></span>
            <input type="range" min={3_000} max={20_000} step={500} value={sceneSettings.visibilityMeters} onChange={(event) => updateSceneSetting("visibilityMeters", Number(event.target.value))} />
          </label>
          <label className="open-world-range-field">
            <span>Virtual wind <strong>{windSpeed} m/s</strong></span>
            <input type="range" min={0} max={20} step={1} value={windSpeed} disabled={scenarioConfigured} onChange={(event) => setWindSpeed(Number(event.target.value))} />
            <small>{scenarioConfigured ? "Reset scenario to change wind." : "Applied as a deterministic virtual disturbance on start."}</small>
          </label>

          <div className="open-world-section-divider">DESTINATION · SAFE ZONE-01</div>
          <div className="open-world-config-facts">
            <MetricRow label="X / Z" value={`${destination.x} / ${destination.z} m`} />
            <MetricRow label="ELEVATION" value={`${destinationElevation} m`} />
            <MetricRow label="ZONE RADIUS" value="150 m" />
          </div>
          <button
            className={`open-world-secondary-action ${destinationPicking ? "selecting" : ""}`}
            type="button"
            disabled={scenarioConfigured}
            aria-pressed={destinationPicking}
            onClick={() => setDestinationPicking((current) => !current)}
          >
            {destinationPicking ? "CANCEL DESTINATION PICK" : "SELECT DESTINATION"}
          </button>
          <div className="open-world-coordinate-readout">
            {inspectedPoint
              ? `INSPECTED · X ${inspectedPoint.x} m · Z ${inspectedPoint.z} m`
              : "Click terrain to inspect virtual coordinates."}
          </div>

          <div className="open-world-section-divider">SCENARIO LIFECYCLE</div>
          <button className="open-world-primary-action" type="button" disabled={!serviceAvailable || flight?.status === "active" || flight?.status === "complete"} onClick={() => void runFlightAction(flight?.status === "paused" ? "resume" : "start")}>
            ▶ {flight?.status === "paused" ? "RESUME SIMULATION" : "START SIMULATION"}
          </button>
          <div className="open-world-action-grid">
            <button type="button" disabled={flight?.status !== "active"} onClick={() => void runFlightAction("pause")}>Ⅱ PAUSE</button>
            <button type="button" disabled={!flightLocked} onClick={() => void runFlightAction("stop")}>■ STOP</button>
            <button type="button" disabled={flight?.status === "active" || flight?.status === "paused"} onClick={() => void runFlightAction("reset")}>↺ RESET SCENARIO</button>
          </div>
          <p className="open-world-hint">{simulationError || (serviceAvailable ? "Flight motion is provided by the local simulation backend." : "Waiting for simulation backend at 127.0.0.1:8765.")}</p>

          <button className="open-world-secondary-action open-world-generate-action" type="button" disabled={scenarioConfigured} onClick={generateEnvironment}>
            GENERATE NEW ENVIRONMENT
          </button>
          <div className="open-world-provenance">SIMULATED DATA · UNCLASSIFIED · DEMONSTRATION SYSTEM</div>
        </aside>

        <section className="open-world-view" aria-label="Interactive virtual terrain">
          <div className="open-world-view-heading">
            <span>3D OPEN-WORLD ENVIRONMENT</span>
            <span>SEED {seed} · VIRTUAL METRES</span>
          </div>
          <div className={`open-world-canvas-wrap ${destinationPicking ? "pick-destination-mode" : ""}`}>
            <OpenWorldScene
              seed={seed}
              mode={mode}
              cameraCommand={cameraCommand}
              settings={sceneSettings}
              destinationPoint={destination}
              flight={flight}
              onTerrainClick={handleTerrainClick}
            />
            {destinationPicking && <div className="open-world-pick-hint">CLICK A TERRAIN POINT TO MOVE SAFE ZONE-01</div>}
            <div className="open-world-camera-tools" aria-label="Camera controls">
              <span className="camera-tool-hint">DRAG ORBIT · RIGHT-DRAG PAN · WHEEL ZOOM</span>
              <button type="button" onClick={() => setCameraView("overview")}>RESET VIEW</button>
              <button type="button" onClick={() => setCameraView("top-down")}>TOP-DOWN</button>
            </div>
            <div className="open-world-axis" aria-hidden="true">
              <span>N</span><i /><b>E</b>
            </div>
            <div className="open-world-scene-stamp">SIMULATION DATA — DEMONSTRATION SYSTEM</div>
          </div>
        </section>

        <aside className="open-world-sidebar open-world-analysis" aria-label="Live analysis">
          <section>
            <div className="open-world-panel-heading">LIVE TELEMETRY <span>{flight?.status?.toUpperCase() ?? "STANDBY"}</span></div>
            <MetricRow label="DRONE ID" value={flight?.drone_id ?? "—"} />
            <MetricRow label="SCENARIO · SIM TIME" value={`${flight?.scenario_id ?? "—"} · ${simClock}`} />
            <MetricRow label="POSITION · X / Y / Z" value={flight?.drone_id ? `${Math.round(flight.position.x)} / ${Math.round(flight.position.y)} / ${Math.round(flight.position.z)} m` : "— / — / — m"} />
            <MetricRow label="ALTITUDE · AGL" value={flight?.drone_id ? `${flight.altitude_m.toFixed(1)} m` : "— m"} />
            <MetricRow label="GROUND SPEED" value={flight?.drone_id ? `${flight.speed_mps.toFixed(1)} m/s` : "— m/s"} />
            <MetricRow label="HEADING" value={flight?.drone_id ? `${flight.heading_deg.toFixed(0)}°` : "—°"} />
            <MetricRow label="DISTANCE REMAINING" value={flight?.drone_id ? `${flight.distance_remaining_m.toFixed(0)} m` : "— m"} />
            <MetricRow label="ESTIMATED ARRIVAL" value={flight?.eta_seconds != null ? `${Math.ceil(flight.eta_seconds)} s · simulated` : "—"} />
          </section>

          <section>
            <div className="open-world-panel-heading">SYNTHETIC RF ANALYSIS</div>
            <MetricRow label="RF ENGINE" value="IDLE" />
            <MetricRow label="SOURCE" value="—" />
            <MetricRow label="PROFILE" value="—" />
            <MetricRow label="CHANNEL EVENTS" value="0" />
            <p className="open-world-hint">RF activity begins only with an explicitly started simulation.</p>
          </section>

          <section className="open-world-event-section">
            <div className="open-world-panel-heading">WORLD EVENT LOG</div>
            {worldEvents.map((message, index) => (
              <div className="open-world-event-row" key={`${index}-${message}`}>
                <time>{index === 0 ? "CONFIG" : "WORLD"}</time>
                <span>{message}</span>
              </div>
            ))}
          </section>
        </aside>

        <section className="open-world-bottom" aria-label="Scenario history panels">
          <article className="open-world-chart-placeholder">
            <div className="open-world-panel-heading">SPEED OVER TIME</div>
            <span>{flight?.drone_id ? `${flight.speed_mps.toFixed(1)} m/s · ${flight.distance_travelled_m.toFixed(0)} m travelled` : "Waiting for simulation start"}</span>
          </article>
          <article className="open-world-chart-placeholder">
            <div className="open-world-panel-heading">ALTITUDE OVER TIME</div>
            <span>{flight?.drone_id ? `${flight.altitude_m.toFixed(0)} m AGL · ${flight.status}` : "Waiting for simulation start"}</span>
          </article>
          <article className="open-world-chart-placeholder open-world-history-preview">
            <div className="open-world-panel-heading">HOPPING & WATERFALL PREVIEW</div>
            <span>RF engine idle</span>
          </article>
        </section>
      </div>
    </main>
  );
}
