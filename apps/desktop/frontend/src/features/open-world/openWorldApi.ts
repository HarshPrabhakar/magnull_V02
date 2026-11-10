const API_BASE_URL = "http://127.0.0.1:8765";

export type FlightState = {
  scenario_id: string | null;
  drone_id: string | null;
  seed: number;
  sim_version: string;
  config_hash: string;
  status: "standby" | "active" | "paused" | "stopped" | "complete";
  sim_time: number;
  position: { x: number; y: number; z: number };
  spawn: { x: number; y: number; z: number };
  destination: { x: number; y: number; z: number; radius_m: number };
  rf_profile: RFProfileId;
  interference_db: number;
  speed_mps: number;
  heading_deg: number;
  distance_remaining_m: number;
  distance_travelled_m: number;
  eta_seconds: number | null;
  altitude_m: number;
  vertical_speed_mps: number;
  acceleration_mps2: number;
  trajectory_deviation_m: number;
  ground_truth: FlightTelemetry;
  estimated_telemetry: FlightTelemetry;
  estimation_error_m: number;
  source: "simulated";
};

export type RFProfileId = "generic_fhss" | "elrs_like" | "ocusync_like" | "afhds_like" | "analog_fpv_like" | "unknown_hopping";

export type RFEvent = {
  event_index: number;
  sim_time: number;
  channel_index: number;
  frequency_mhz: number;
  duration_ms: number;
  received_power_dbm: number;
  visible: boolean;
};

export type ChannelOccupancy = {
  channel_index: number;
  frequency_mhz: number;
  event_count: number;
  occupancy_percent: number;
};

export type OpenWorldRFState = {
  scenario_id: string | null;
  seed: number;
  sim_version: string;
  config_hash: string;
  sim_time: number;
  status: "idle" | "active" | "paused" | "stopped" | "complete";
  source_id: string | null;
  profile: RFProfileId | null;
  profile_label: string | null;
  classification: string | null;
  classification_confidence: number | null;
  center_frequency_mhz: number | null;
  bandwidth_mhz: number | null;
  current_frequency_mhz: number | null;
  distance_m: number | null;
  received_power_dbm: number | null;
  noise_floor_dbm: number | null;
  snr_db: number | null;
  expected_event_count: number;
  observed_event_count: number;
  missing_event_count: number;
  observed_channel_changes: number;
  estimated_dwell_ms: number | null;
  estimated_hop_rate_hz: number | null;
  observed_channel_count: number;
  occupied_frequency_range_mhz: number[] | null;
  sequence_periodicity: number | null;
  channel_occupancy: ChannelOccupancy[];
  burst_duration_distribution_ms: number[];
  inter_burst_intervals_ms: number[];
  generated_events: RFEvent[];
  observed_events: RFEvent[];
  spectrum_frequency_mhz: number[];
  spectrum_power_db: number[];
  source: "simulated";
  synthetic: true;
};

export type OpenWorldSimulationSnapshot = { flight: FlightState; rf: OpenWorldRFState };

export type FlightTelemetry = {
  position: { x: number; y: number; z: number };
  altitude_m: number;
  speed_mps: number;
  vertical_speed_mps: number;
  heading_deg: number;
  acceleration_mps2: number;
  distance_remaining_m: number;
  eta_seconds: number | null;
  trajectory_deviation_m: number;
};

function numberOr(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function pointOr(value: unknown, fallback: FlightTelemetry["position"]) {
  const point = value && typeof value === "object" ? value as Partial<FlightTelemetry["position"]> : {};
  return {
    x: numberOr(point.x, fallback.x),
    y: numberOr(point.y, fallback.y),
    z: numberOr(point.z, fallback.z),
  };
}

function normalizeTelemetry(value: unknown, fallback: FlightTelemetry): FlightTelemetry {
  const telemetry = value && typeof value === "object" ? value as Partial<FlightTelemetry> : {};
  return {
    position: pointOr(telemetry.position, fallback.position),
    altitude_m: numberOr(telemetry.altitude_m, fallback.altitude_m),
    speed_mps: numberOr(telemetry.speed_mps, fallback.speed_mps),
    vertical_speed_mps: numberOr(telemetry.vertical_speed_mps, fallback.vertical_speed_mps),
    heading_deg: numberOr(telemetry.heading_deg, fallback.heading_deg),
    acceleration_mps2: numberOr(telemetry.acceleration_mps2, fallback.acceleration_mps2),
    distance_remaining_m: numberOr(telemetry.distance_remaining_m, fallback.distance_remaining_m),
    eta_seconds: typeof telemetry.eta_seconds === "number" ? telemetry.eta_seconds : telemetry.eta_seconds === null ? null : fallback.eta_seconds,
    trajectory_deviation_m: numberOr(telemetry.trajectory_deviation_m, fallback.trajectory_deviation_m),
  };
}

function normalizeFlightState(value: unknown): FlightState {
  const state = value && typeof value === "object" ? value as Partial<FlightState> : {};
  const position = pointOr(state.position, { x: 0, y: 0, z: 0 });
  const groundTruthFallback: FlightTelemetry = {
    position,
    altitude_m: numberOr(state.altitude_m),
    speed_mps: numberOr(state.speed_mps),
    vertical_speed_mps: numberOr(state.vertical_speed_mps),
    heading_deg: numberOr(state.heading_deg),
    acceleration_mps2: numberOr(state.acceleration_mps2),
    distance_remaining_m: numberOr(state.distance_remaining_m),
    eta_seconds: typeof state.eta_seconds === "number" ? state.eta_seconds : null,
    trajectory_deviation_m: numberOr(state.trajectory_deviation_m),
  };
  const groundTruth = normalizeTelemetry(state.ground_truth, groundTruthFallback);
  const status = ["standby", "active", "paused", "stopped", "complete"].includes(state.status ?? "")
    ? state.status as FlightState["status"]
    : "standby";

  return {
    scenario_id: typeof state.scenario_id === "string" ? state.scenario_id : null,
    drone_id: typeof state.drone_id === "string" ? state.drone_id : null,
    seed: numberOr(state.seed, 42),
    sim_version: typeof state.sim_version === "string" ? state.sim_version : "unknown",
    config_hash: typeof state.config_hash === "string" ? state.config_hash : "",
    status,
    sim_time: numberOr(state.sim_time),
    position,
    spawn: pointOr(state.spawn, { x: 0, y: 0, z: 0 }),
    destination: {
      ...pointOr(state.destination, { x: 0, y: 0, z: 0 }),
      radius_m: numberOr(state.destination?.radius_m, 150),
    },
    rf_profile: state.rf_profile ?? "generic_fhss",
    interference_db: numberOr(state.interference_db),
    speed_mps: groundTruth.speed_mps,
    heading_deg: groundTruth.heading_deg,
    distance_remaining_m: groundTruth.distance_remaining_m,
    distance_travelled_m: numberOr(state.distance_travelled_m),
    eta_seconds: groundTruth.eta_seconds,
    altitude_m: groundTruth.altitude_m,
    vertical_speed_mps: groundTruth.vertical_speed_mps,
    acceleration_mps2: groundTruth.acceleration_mps2,
    trajectory_deviation_m: groundTruth.trajectory_deviation_m,
    ground_truth: groundTruth,
    estimated_telemetry: normalizeTelemetry(state.estimated_telemetry, groundTruth),
    estimation_error_m: numberOr(state.estimation_error_m),
    source: "simulated",
  };
}

async function request(path: string, method = "GET", body?: unknown): Promise<FlightState> {
  const response = await fetch(`${API_BASE_URL}/api/v1/open-world/${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { detail?: string } | null;
    throw new Error(payload?.detail ?? `Simulation service returned HTTP ${response.status}`);
  }
  return normalizeFlightState(await response.json());
}

export const fetchFlightState = () => request("state");
export const startFlight = (config: {
  seed: number;
  spawn_seed: number;
  spawn_distance_m: number;
  initial_altitude_m: number;
  max_speed_mps: number;
  wind_speed_mps: number;
  destination_x_m: number;
  destination_z_m: number;
    rf_profile: RFProfileId;
    interference_db: number;
}) => request("start", "POST", config);
export const controlFlight = (action: "pause" | "resume" | "stop" | "reset") => request(action, "POST");
export async function fetchOpenWorldRFState(): Promise<OpenWorldRFState> {
  const response = await fetch(`${API_BASE_URL}/api/v1/open-world/rf/state`);
  if (!response.ok) throw new Error(`RF simulation request failed: HTTP ${response.status}`);
  return await response.json() as OpenWorldRFState;
}

export async function fetchOpenWorldSnapshot(): Promise<OpenWorldSimulationSnapshot> {
  const response = await fetch(`${API_BASE_URL}/api/v1/open-world/snapshot`);
  if (!response.ok) throw new Error(`Open World snapshot failed: HTTP ${response.status}`);
  const payload = await response.json() as { flight: unknown; rf: OpenWorldRFState };
  return { flight: normalizeFlightState(payload.flight), rf: payload.rf };
}
