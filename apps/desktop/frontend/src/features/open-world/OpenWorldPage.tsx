import { useCallback, useEffect, useRef, useState } from "react";
import {
  OpenWorldScene,
  type CameraCommand,
  type EnvironmentMode,
  type SceneSettings,
  type WorldPoint,
} from "./OpenWorldScene";
import { terrainHeight } from "./worldMath";
import { estimateProximity, formatProximityEta, OUTSIDE_PROXIMITY, type ProximityZone } from "./openWorldProximity";
import { controlFlight, fetchOpenWorldSnapshot, startFlight, type FlightState, type FlightTelemetry, type OpenWorldRFState, type RFEvent, type RFProfileId } from "./openWorldApi";

const INITIAL_SEED = 42;
const TELEMETRY_HISTORY_LIMIT = 300;
const RF_PROFILES: { id: RFProfileId; label: string }[] = [
  { id: "generic_fhss", label: "Generic FHSS" },
  { id: "elrs_like", label: "ELRS-like (synthetic)" },
  { id: "ocusync_like", label: "OcuSync-like (synthetic)" },
  { id: "afhds_like", label: "AFHDS-like (synthetic)" },
  { id: "analog_fpv_like", label: "Analog FPV-like" },
  { id: "unknown_hopping", label: "Unknown synthetic hopping" },
];

type TelemetryMetric = "speed_mps" | "altitude_m" | "vertical_speed_mps" | "distance_remaining_m" | "heading_deg" | "trajectory_deviation_m";
type TelemetrySample = { scenario_id: string; sim_time: number; ground_truth: FlightTelemetry; estimated: FlightTelemetry };

function TelemetryChart({
  title,
  unit,
  metric,
  samples,
  min,
  max,
}: {
  title: string;
  unit: string;
  metric: TelemetryMetric;
  samples: TelemetrySample[];
  min: number;
  max: number;
}) {
  const plot = (key: "ground_truth" | "estimated") => samples.map((sample, index) => {
    const x = samples.length < 2 ? 500 : index / (samples.length - 1) * 1_000;
    const value = sample[key][metric];
    const normalized = Math.max(0, Math.min(1, (value - min) / (max - min)));
    const y = 90 - normalized * 75;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const latest = samples.at(-1);

  return (
    <article className="open-world-telemetry-chart">
      <div className="open-world-chart-heading">
        <span>{title}</span>
        <strong>{latest ? `${latest.ground_truth[metric].toFixed(1)} ${unit}` : `— ${unit}`}</strong>
      </div>
      {latest ? (
        <svg viewBox="0 0 1000 100" preserveAspectRatio="none" role="img" aria-label={`${title} ground truth and estimated telemetry over simulation time`}>
          <line x1="0" y1="15" x2="1000" y2="15" />
          <line x1="0" y1="52.5" x2="1000" y2="52.5" />
          <line x1="0" y1="90" x2="1000" y2="90" />
          <polyline className="truth-line" points={plot("ground_truth")} />
          <polyline className="estimate-line" points={plot("estimated")} />
        </svg>
      ) : <span className="open-world-chart-empty">Waiting for START</span>}
      <div className="open-world-chart-legend"><span>GROUND TRUTH</span><span>ESTIMATE</span></div>
    </article>
  );
}

function HoppingPlot({ rf }: { rf: OpenWorldRFState }) {
  const generated = rf.generated_events;
  const observed = rf.observed_events;
  const low = rf.center_frequency_mhz != null && rf.bandwidth_mhz != null
    ? rf.center_frequency_mhz - rf.bandwidth_mhz / 2
    : 0;
  const span = rf.bandwidth_mhz || 1;
  const firstTime = generated[0]?.sim_time ?? 0;
  const timeSpan = Math.max(0.001, (generated.at(-1)?.sim_time ?? 0) - firstTime);
  const plot = (events: RFEvent[]) => {
    if (!events.length) return "";
    return events.map((event) => {
      const x = generated.length === 1 ? 500 : ((event.sim_time - firstTime) / timeSpan) * 1_000;
      const y = 92 - Math.max(0, Math.min(1, (event.frequency_mhz - low) / span)) * 78;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
  };

  return (
    <svg className="open-world-hopping-plot" viewBox="0 0 1000 100" preserveAspectRatio="none" role="img" aria-label="Generated and observed synthetic channel frequency over simulation time">
      <line x1="0" y1="14" x2="1000" y2="14" />
      <line x1="0" y1="53" x2="1000" y2="53" />
      <line x1="0" y1="92" x2="1000" y2="92" />
      {generated.length > 1 && <polyline className="generated-hop-line" points={plot(generated)} />}
      {observed.length > 1 && <polyline className="observed-hop-line" points={plot(observed)} />}
      {observed.length === 1 && <circle cx="500" cy={92 - Math.max(0, Math.min(1, (observed[0].frequency_mhz - low) / span)) * 78} r="5" />}
    </svg>
  );
}

function DistributionBars({ values, label }: { values: number[]; label: string }) {
  const shown = values.slice(-24);
  const max = Math.max(1, ...shown);
  return (
    <div className="open-world-distribution" role="img" aria-label={label}>
      {shown.length ? shown.map((value, index) => <i key={`${index}-${value}`} style={{ height: `${Math.max(8, value / max * 100)}%` }} />) : <span>NO EVENTS</span>}
    </div>
  );
}

function SpectrumPlot({ rf }: { rf: OpenWorldRFState }) {
  const points = rf.spectrum_power_db.map((power, index) => {
    const x = rf.spectrum_power_db.length < 2 ? 0 : index / (rf.spectrum_power_db.length - 1) * 1_000;
    const y = 92 - Math.max(0, Math.min(1, (power + 100) / 80)) * 78;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <svg className="open-world-spectrum-plot" viewBox="0 0 1000 100" preserveAspectRatio="none" role="img" aria-label="Synthetic spectrum generated from current hopping channel and path-loss measurement">
      <line x1="0" y1="14" x2="1000" y2="14" />
      <line x1="0" y1="53" x2="1000" y2="53" />
      <line x1="0" y1="92" x2="1000" y2="92" />
      {points && <polyline points={points} />}
    </svg>
  );
}

function OccupancyBars({ rf }: { rf: OpenWorldRFState }) {
  const max = Math.max(1, ...rf.channel_occupancy.map((channel) => channel.occupancy_percent));
  return (
    <div className="open-world-occupancy-list" aria-label="Observed channel occupancy">
      {rf.channel_occupancy.map((channel) => (
        <div className="open-world-occupancy-row" key={channel.channel_index} title={`${channel.frequency_mhz.toFixed(3)} MHz · ${channel.event_count} events`}>
          <span>{String(channel.channel_index + 1).padStart(2, "0")}</span>
          <i><b style={{ width: `${channel.occupancy_percent / max * 100}%` }} /></i>
          <small>{channel.occupancy_percent.toFixed(0)}%</small>
        </div>
      ))}
    </div>
  );
}

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
  const [rfProfile, setRFProfile] = useState<RFProfileId>("generic_fhss");
  const [interferenceDb, setInterferenceDb] = useState(0);
  const [spawnDistance, setSpawnDistance] = useState(5_000);
  const [initialAltitude, setInitialAltitude] = useState(120);
  const [maxSpeed, setMaxSpeed] = useState(18);
  const [flight, setFlight] = useState<FlightState | null>(null);
  const [rfState, setRFState] = useState<OpenWorldRFState | null>(null);
  const [telemetryHistory, setTelemetryHistory] = useState<TelemetrySample[]>([]);
  const [simulationError, setSimulationError] = useState("");
  const [serviceAvailable, setServiceAvailable] = useState(false);
  const [destination, setDestination] = useState<WorldPoint>({ x: 3_100, z: 850 });
  const [destinationPicking, setDestinationPicking] = useState(false);
  const [inspectedPoint, setInspectedPoint] = useState<WorldPoint | null>(null);
  const [worldEvents, setWorldEvents] = useState([
    `World generated from seed ${INITIAL_SEED}`,
    "Idle: no flight or RF events have been generated",
  ]);
  const [proximity, setProximity] = useState(OUTSIDE_PROXIMITY);
  const lastProximity = useRef<{ scenarioId: string; zone: ProximityZone } | null>(null);
  const [criticalWarning, setCriticalWarning] = useState<{ scenarioId: string; droneId: string } | null>(null);
  const [criticalAcknowledged, setCriticalAcknowledged] = useState(false);
  const [zoneNotice, setZoneNotice] = useState<{ zone: ProximityZone; label: string; id: number } | null>(null);
  const [alarmAudioEnabled, setAlarmAudioEnabled] = useState(false);
  const audioContext = useRef<AudioContext | null>(null);
  const zoneNoticeId = useRef(0);

  const acceptFlightState = useCallback((state: FlightState, resetHistory = false) => {
    setFlight(state);
    if (resetHistory || (state.status === "standby" && !state.scenario_id)) {
      setTelemetryHistory([]);
    }
    if (!state.scenario_id) return;
    const sample: TelemetrySample = {
      scenario_id: state.scenario_id,
      sim_time: state.sim_time,
      ground_truth: state.ground_truth,
      estimated: state.estimated_telemetry,
    };
    setTelemetryHistory((previous) => {
      const latest = previous.at(-1);
      if (resetHistory || !latest || latest.scenario_id !== sample.scenario_id) return [sample];
      if (sample.sim_time <= latest.sim_time) return previous;
      return [...previous, sample].slice(-TELEMETRY_HISTORY_LIMIT);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    let timerInterval: number | undefined;
    const stopPolling = () => {
      if (timer !== undefined) window.clearInterval(timer);
      timer = undefined;
      timerInterval = undefined;
    };
    const pollAt = (interval: number, refresh: () => void) => {
      if (timer !== undefined && timerInterval === interval) return;
      stopPolling();
      timer = window.setInterval(refresh, interval);
      timerInterval = interval;
    };
    const refresh = async () => {
      try {
        const snapshot = await fetchOpenWorldSnapshot();
        if (cancelled) return;
        const state = snapshot.flight;
        acceptFlightState(state);
        setRFState(snapshot.rf);
        setServiceAvailable(true);
        if (state.status === "active" && timer === undefined) {
          pollAt(200, () => void refresh());
        } else if (state.status === "active" && timerInterval !== 200) {
          pollAt(200, () => void refresh());
        } else if (state.status !== "active" && timer !== undefined) {
          stopPolling();
        }
      } catch (error) {
        if (!cancelled) {
          setServiceAvailable(false);
          setSimulationError(error instanceof Error ? error.message : "Simulation service unavailable");
          pollAt(2_000, () => void refresh());
        }
      }
    };
    void refresh();
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [flight?.status, acceptFlightState]);

  const runFlightAction = async (action: "start" | "pause" | "resume" | "stop" | "reset") => {
    setSimulationError("");
    try {
      const next = action === "start"
        ? await startFlight({ seed, spawn_distance_m: spawnDistance, initial_altitude_m: initialAltitude, max_speed_mps: maxSpeed, wind_speed_mps: windSpeed, destination_x_m: destination.x, destination_z_m: destination.z, rf_profile: rfProfile, interference_db: interferenceDb })
        : await controlFlight(action);
      const snapshot = await fetchOpenWorldSnapshot();
      acceptFlightState(snapshot.flight, action === "reset" || action === "start");
      setRFState(snapshot.rf);
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
  const visibleTelemetryHistory = flight?.scenario_id ? telemetryHistory : [];
  const activeRF = rfState && rfState.scenario_id && rfState.scenario_id === flight?.scenario_id ? rfState : null;

  const recordWorldEvent = useCallback((message: string) => {
    setWorldEvents((previous) => [message, ...previous].slice(0, 12));
  }, []);

  useEffect(() => {
    if (!flight?.scenario_id || !flight.drone_id) {
      lastProximity.current = null;
      setProximity(OUTSIDE_PROXIMITY);
      setCriticalWarning(null);
      setCriticalAcknowledged(false);
      setZoneNotice(null);
      return;
    }

    const sameScenario = lastProximity.current?.scenarioId === flight.scenario_id;
    const previousZone = sameScenario ? lastProximity.current!.zone : "outside";
    const next = estimateProximity(flight, destination, previousZone);
    setProximity(next);
    if (sameScenario && next.zone !== previousZone) {
      if (next.zone === "critical") {
        setCriticalWarning({ scenarioId: flight.scenario_id, droneId: flight.drone_id });
        setCriticalAcknowledged(false);
      } else if (previousZone === "critical") {
        setCriticalWarning(null);
        setCriticalAcknowledged(false);
      }
      if (next.zone !== "outside") {
        setZoneNotice({ zone: next.zone, label: next.label, id: ++zoneNoticeId.current });
      } else {
        setZoneNotice(null);
      }
      const level = next.zone === "critical" ? "CRITICAL" : next.zone === "warning" ? "WARNING" : "DETECTION";
      const event = next.zone === "outside"
        ? `${flight.drone_id} exited the monitoring zones`
        : `${flight.drone_id} entered ${next.label.toLowerCase()} zone`;
      recordWorldEvent(`${level} · ${event}`);
    } else if (!sameScenario && next.zone !== "outside") {
      setZoneNotice({ zone: next.zone, label: next.label, id: ++zoneNoticeId.current });
      if (next.zone === "critical") {
        setCriticalWarning({ scenarioId: flight.scenario_id, droneId: flight.drone_id });
        setCriticalAcknowledged(false);
      }
      const level = next.zone === "critical" ? "CRITICAL" : next.zone === "warning" ? "WARNING" : "DETECTION";
      recordWorldEvent(`${level} · ${flight.drone_id} spawned in ${next.label.toLowerCase()} zone`);
    } else if (!sameScenario) {
      setCriticalWarning(null);
      setCriticalAcknowledged(false);
      setZoneNotice(null);
    }
    lastProximity.current = { scenarioId: flight.scenario_id, zone: next.zone };
  }, [destination, flight, recordWorldEvent]);

  useEffect(() => {
    if (!zoneNotice || zoneNotice.zone === "critical") return;
    const timeout = window.setTimeout(() => setZoneNotice(null), 4_500);
    return () => window.clearTimeout(timeout);
  }, [zoneNotice]);

  useEffect(() => () => {
    void audioContext.current?.close();
    audioContext.current = null;
  }, []);

  useEffect(() => {
    const isCritical = Boolean(flight?.scenario_id && criticalWarning?.scenarioId === flight.scenario_id && proximity.zone === "critical");
    const context = audioContext.current;
    if (!isCritical || !alarmAudioEnabled || criticalAcknowledged || !context || context.state !== "running") return;

    const playAlarmPulse = () => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const now = context.currentTime;
      oscillator.type = "triangle";
      oscillator.frequency.setValueAtTime(880, now);
      oscillator.frequency.setValueAtTime(660, now + 0.16);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.12, now + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.36);
    };

    playAlarmPulse();
    const interval = window.setInterval(playAlarmPulse, 1_100);
    return () => window.clearInterval(interval);
  }, [alarmAudioEnabled, criticalAcknowledged, criticalWarning, flight?.scenario_id, proximity.zone]);

  const toggleAlarmAudio = async () => {
    if (alarmAudioEnabled) {
      setAlarmAudioEnabled(false);
      return;
    }
    try {
      const context = audioContext.current ?? new window.AudioContext();
      audioContext.current = context;
      await context.resume();
      setAlarmAudioEnabled(true);
    } catch {
      setAlarmAudioEnabled(false);
      recordWorldEvent("AUDIO · Local alarm unavailable; use the visual warning controls");
    }
  };

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

          <div className="open-world-section-divider">SYNTHETIC RF CONFIGURATION</div>
          <label className="open-world-field">
            <span>Illustrative RF profile</span>
            <select value={rfProfile} disabled={scenarioConfigured} onChange={(event) => setRFProfile(event.target.value as RFProfileId)}>
              {RF_PROFILES.map((profile) => <option key={profile.id} value={profile.id}>{profile.label}</option>)}
            </select>
            <small>Approximate synthetic model; not protocol identification.</small>
          </label>
          <label className="open-world-range-field">
            <span>Virtual interference <strong>{interferenceDb} dB</strong></span>
            <input type="range" min={0} max={30} step={1} value={interferenceDb} disabled={scenarioConfigured} onChange={(event) => setInterferenceDb(Number(event.target.value))} />
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
              proximity={proximity}
              onTerrainClick={handleTerrainClick}
            />
            {zoneNotice && zoneNotice.zone !== "critical" && (
              <div key={zoneNotice.id} className={`open-world-zone-notice zone-${zoneNotice.zone}`} role="status" aria-live="polite">
                <span>{zoneNotice.zone === "warning" ? "WARNING" : "DRONE DETECTED"}</span>
                <strong>{flight?.drone_id} · {zoneNotice.label}</strong>
                <small>Synthetic simulation event</small>
              </div>
            )}
            {criticalWarning && flight?.scenario_id === criticalWarning.scenarioId && proximity.zone === "critical" && (
              <section className="open-world-critical-warning" role="alert" aria-live="assertive">
                <div className="critical-warning-kicker">MAG-NULL · SYNTHETIC SIMULATION ALERT</div>
                <h3>CRITICAL PROXIMITY WARNING</h3>
                <div className="critical-warning-details">
                  <span>DRONE</span><strong>{criticalWarning.droneId}</strong>
                  <span>PROFILE</span><strong>{flight?.rf_profile.replaceAll("_", "-").toUpperCase()} (SIMULATED)</strong>
                  <span>STATUS</span><strong>INNER ZONE ENTERED · {proximity.distanceMeters?.toFixed(0)} M FROM CENTER</strong>
                  <span>EST. TO ZONE</span><strong>INSIDE CRITICAL ZONE</strong>
                </div>
                <p>IMMEDIATE ATTENTION REQUIRED · ESTIMATES ARE SIMULATION-DERIVED</p>
                <div className="critical-warning-actions">
                  <button type="button" onClick={() => void toggleAlarmAudio()}>{alarmAudioEnabled ? "MUTE ALARM AUDIO" : "ENABLE ALARM AUDIO"}</button>
                  <button type="button" onClick={() => setCriticalAcknowledged(true)} disabled={criticalAcknowledged}>
                    {criticalAcknowledged ? "ALARM ACKNOWLEDGED" : "ACKNOWLEDGE · SILENCE"}
                  </button>
                </div>
              </section>
            )}
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
            <MetricRow label="VERTICAL SPEED" value={flight?.drone_id ? `${flight.vertical_speed_mps.toFixed(2)} m/s` : "— m/s"} />
            <MetricRow label="ACCELERATION" value={flight?.drone_id ? `${flight.acceleration_mps2.toFixed(2)} m/s²` : "— m/s²"} />
            <MetricRow label="HEADING" value={flight?.drone_id ? `${flight.heading_deg.toFixed(0)}°` : "—°"} />
            <MetricRow label="PROXIMITY CLASS" value={flight?.drone_id ? `${proximity.label} · ${proximity.distanceMeters?.toFixed(0) ?? "—"} m` : "—"} />
            <MetricRow label="EST. TIME TO ZONE" value={!flight?.drone_id ? "—" : proximity.nextBoundary ? `${proximity.nextBoundary} · ${formatProximityEta(proximity.etaSeconds)} · current track` : "INSIDE CRITICAL ZONE"} />
            <MetricRow label="DISTANCE TRAVELLED" value={flight?.drone_id ? `${flight.distance_travelled_m.toFixed(0)} m` : "— m"} />
            <MetricRow label="DISTANCE REMAINING" value={flight?.drone_id ? `${flight.distance_remaining_m.toFixed(0)} m` : "— m"} />
            <MetricRow label="TRAJECTORY DEVIATION" value={flight?.drone_id ? `${flight.trajectory_deviation_m.toFixed(1)} m` : "— m"} />
            <MetricRow label="ESTIMATED ARRIVAL" value={flight?.status === "paused" ? "PAUSED" : flight?.estimated_telemetry.eta_seconds != null ? `${Math.ceil(flight.estimated_telemetry.eta_seconds)} s · estimate` : "—"} />
            <MetricRow label="MODEL REFERENCE ETA" value={flight?.eta_seconds != null ? `${Math.ceil(flight.eta_seconds)} s` : "—"} />
            <div className="open-world-compare-heading">GROUND TRUTH <span>VS</span> ESTIMATE</div>
            <MetricRow label="SPEED · TRUE / EST." value={flight?.drone_id ? `${flight.ground_truth.speed_mps.toFixed(1)} / ${flight.estimated_telemetry.speed_mps.toFixed(1)} m/s` : "—"} />
            <MetricRow label="ALTITUDE · TRUE / EST." value={flight?.drone_id ? `${flight.ground_truth.altitude_m.toFixed(1)} / ${flight.estimated_telemetry.altitude_m.toFixed(1)} m` : "—"} />
            <MetricRow label="HEADING · TRUE / EST." value={flight?.drone_id ? `${flight.ground_truth.heading_deg.toFixed(1)} / ${flight.estimated_telemetry.heading_deg.toFixed(1)}°` : "—"} />
            <MetricRow label="POSITION ESTIMATION ERROR" value={flight?.drone_id ? `${flight.estimation_error_m.toFixed(2)} m · simulated` : "—"} />
          </section>

          <section className="open-world-rf-section">
            <div className="open-world-panel-heading">SYNTHETIC RF & HOPPING <span>{activeRF?.status?.toUpperCase() ?? "IDLE"}</span></div>
            {activeRF ? (
              <>
                <MetricRow label="SOURCE · PROFILE" value={`${activeRF.source_id} · ${activeRF.profile_label}`} />
                <MetricRow label="FREQUENCY · BANDWIDTH" value={`${activeRF.current_frequency_mhz?.toFixed(3) ?? "—"} · ${activeRF.bandwidth_mhz?.toFixed(1) ?? "—"} MHz`} />
                <MetricRow label="RECEIVED · NOISE" value={`${activeRF.received_power_dbm?.toFixed(1) ?? "—"} · ${activeRF.noise_floor_dbm?.toFixed(1) ?? "—"} dBm`} />
                <MetricRow label="SIGNAL / NOISE" value={`${activeRF.snr_db?.toFixed(1) ?? "—"} dB · ${activeRF.distance_m?.toFixed(0) ?? "—"} m range`} />
                <MetricRow label="EVENTS · MISSING" value={`${activeRF.observed_event_count} / ${activeRF.missing_event_count} of ${activeRF.expected_event_count}`} />
                <MetricRow label="CHANNEL CHANGES · CHANNELS" value={`${activeRF.observed_channel_changes} · ${activeRF.observed_channel_count}`} />
                <MetricRow label="EST. DWELL · HOP RATE" value={`${activeRF.estimated_dwell_ms?.toFixed(2) ?? "—"} ms · ${activeRF.estimated_hop_rate_hz?.toFixed(1) ?? "—"} Hz`} />
                <MetricRow label="OCCUPIED RANGE" value={activeRF.occupied_frequency_range_mhz ? `${activeRF.occupied_frequency_range_mhz[0].toFixed(2)}–${activeRF.occupied_frequency_range_mhz[1].toFixed(2)} MHz` : "—"} />
                <MetricRow label="SEQUENCE PERIODICITY" value={activeRF.sequence_periodicity ? `${activeRF.sequence_periodicity} events · estimated` : "Not detected"} />
                <div className="open-world-rf-classification">{activeRF.classification} · {((activeRF.classification_confidence ?? 0) * 100).toFixed(0)}% confidence · synthetic</div>
                <div className="open-world-rf-subheading">LIVE SPECTRUM · {activeRF.center_frequency_mhz?.toFixed(1)} MHz CENTER</div>
                <SpectrumPlot rf={activeRF} />
                <div className="open-world-rf-axis"><span>{activeRF.center_frequency_mhz != null && activeRF.bandwidth_mhz != null ? (activeRF.center_frequency_mhz - activeRF.bandwidth_mhz / 2).toFixed(1) : "—"} MHz</span><span>SIMULATED POWER · dB</span><span>{activeRF.center_frequency_mhz != null && activeRF.bandwidth_mhz != null ? (activeRF.center_frequency_mhz + activeRF.bandwidth_mhz / 2).toFixed(1) : "—"} MHz</span></div>
                <div className="open-world-rf-subheading">FREQUENCY × TIME · GENERATED AND OBSERVED</div>
                <HoppingPlot rf={activeRF} />
                <div className="open-world-rf-legend"><span>GENERATED SEQUENCE</span><span>OBSERVED EVENTS</span></div>
                <div className="open-world-rf-subheading">CHANNEL OCCUPANCY</div>
                <OccupancyBars rf={activeRF} />
                <div className="open-world-rf-distributions">
                  <div><span>BURST DURATIONS · ms</span><DistributionBars values={activeRF.burst_duration_distribution_ms} label="Recent synthetic burst duration distribution" /></div>
                  <div><span>INTER-BURST · ms</span><DistributionBars values={activeRF.inter_burst_intervals_ms} label="Recent synthetic inter-burst interval distribution" /></div>
                </div>
                <div className="open-world-rf-subheading">HOPPING EVENT TIMELINE</div>
                {activeRF.observed_events.slice(-6).reverse().map((event) => (
                  <div className="open-world-rf-event" key={event.event_index}>
                    <time>{event.sim_time.toFixed(2)} s</time>
                    <span>CH {String(event.channel_index + 1).padStart(2, "0")} · {event.frequency_mhz.toFixed(3)} MHz</span>
                    <b>{event.duration_ms.toFixed(1)} ms</b>
                  </div>
                ))}
                <p className="open-world-hint">Illustrative synthetic RF only. Classification is approximate and unconfirmed.</p>
              </>
            ) : (
              <p className="open-world-hint">RF events, spectrum, and hopping analysis remain idle until a flight scenario starts.</p>
            )}
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

        <section className="open-world-bottom" aria-label="Live telemetry history">
          <TelemetryChart title="SPEED OVER TIME" unit="m/s" metric="speed_mps" samples={visibleTelemetryHistory} min={0} max={60} />
          <TelemetryChart title="ALTITUDE OVER TIME" unit="m AGL" metric="altitude_m" samples={visibleTelemetryHistory} min={0} max={500} />
          <TelemetryChart title="VERTICAL SPEED" unit="m/s" metric="vertical_speed_mps" samples={visibleTelemetryHistory} min={-10} max={10} />
          <TelemetryChart title="DISTANCE REMAINING" unit="m" metric="distance_remaining_m" samples={visibleTelemetryHistory} min={0} max={10_000} />
          <TelemetryChart title="HEADING OVER TIME" unit="°" metric="heading_deg" samples={visibleTelemetryHistory} min={0} max={360} />
          <TelemetryChart title="TRAJECTORY DEVIATION" unit="m" metric="trajectory_deviation_m" samples={visibleTelemetryHistory} min={0} max={1_000} />
        </section>
      </div>
    </main>
  );
}
