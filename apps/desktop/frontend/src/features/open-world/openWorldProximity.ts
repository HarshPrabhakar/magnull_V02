import type { FlightState } from "./openWorldApi";

export type ProximityZone = "outside" | "inspection" | "warning" | "critical";

export type ProximityState = {
  zone: ProximityZone;
  label: string;
  distanceMeters: number | null;
  nextBoundary: string | null;
  etaSeconds: number | null;
};

const ZONES: { zone: ProximityZone; radius: number; label: string }[] = [
  { zone: "inspection", radius: 2_450, label: "INSPECTION REQUIRED" },
  { zone: "warning", radius: 1_650, label: "PROXIMITY WARNING" },
  { zone: "critical", radius: 850, label: "CRITICAL PROXIMITY" },
];
const HYSTERESIS_METERS = 80;

export const OUTSIDE_PROXIMITY: ProximityState = {
  zone: "outside",
  label: "MONITORING",
  distanceMeters: null,
  nextBoundary: "INSPECTION",
  etaSeconds: null,
};

export function estimateProximity(flight: FlightState, center: { x: number; z: number }, previousZone: ProximityZone = "outside"): ProximityState {
  const dx = flight.position.x - center.x;
  const dz = flight.position.z - center.z;
  const distance = Math.hypot(dx, dz);
  const previous = ZONES.find((zone) => zone.zone === previousZone);
  let zone = ZONES.filter((candidate) => distance <= candidate.radius).at(-1)?.zone ?? "outside";
  if (previous && distance <= previous.radius + HYSTERESIS_METERS) zone = previousZone;

  const active = ZONES.find((candidate) => candidate.zone === zone);
  const next = active ? ZONES[ZONES.indexOf(active) + 1] : ZONES[0];
  if (!next) return { zone, label: active?.label ?? "MONITORING", distanceMeters: distance, nextBoundary: null, etaSeconds: null };

  const speed = flight.speed_mps;
  const heading = flight.heading_deg * Math.PI / 180;
  const vx = speed * Math.sin(heading);
  const vz = -speed * Math.cos(heading);
  const radialVelocity = dx * vx + dz * vz;
  const speedSquared = vx * vx + vz * vz;
  const c = distance * distance - next.radius * next.radius;
  const discriminant = radialVelocity * radialVelocity - speedSquared * c;
  const eta = speedSquared > 0.25 && radialVelocity < 0 && discriminant >= 0
    ? (-radialVelocity - Math.sqrt(discriminant)) / speedSquared
    : null;

  return {
    zone,
    label: active?.label ?? "MONITORING",
    distanceMeters: distance,
    nextBoundary: next.zone.toUpperCase(),
    etaSeconds: eta != null && Number.isFinite(eta) && eta >= 0 ? eta : null,
  };
}

export function formatProximityEta(seconds: number | null): string {
  if (seconds == null) return "NO CLOSING ETA";
  const total = Math.ceil(seconds);
  return `${Math.floor(total / 60).toString().padStart(2, "0")}:${(total % 60).toString().padStart(2, "0")}`;
}

export function proximityColor(zone: ProximityZone): string {
  if (zone === "critical") return "#ff5367";
  if (zone === "warning") return "#ffbd4a";
  return "#49dcca";
}
