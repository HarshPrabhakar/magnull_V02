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
  return await response.json() as FlightState;
}

export const fetchFlightState = () => request("state");
export const startFlight = (config: {
  seed: number;
  spawn_distance_m: number;
  initial_altitude_m: number;
  max_speed_mps: number;
  wind_speed_mps: number;
  destination_x_m: number;
  destination_z_m: number;
}) => request("start", "POST", config);
export const controlFlight = (action: "pause" | "resume" | "stop" | "reset") => request(action, "POST");
