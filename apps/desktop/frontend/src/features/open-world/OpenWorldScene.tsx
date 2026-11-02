import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { Grid, Html, Line, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { terrainHeight } from "./worldMath";
import type { FlightState } from "./openWorldApi";

export type EnvironmentMode = "technical" | "realistic";
export type WorldPoint = { x: number; z: number };
export type SceneSettings = {
  terrainVisible: boolean;
  terrainGrid: boolean;
  coordinateGrid: boolean;
  roadsVisible: boolean;
  buildingsVisible: boolean;
  forestVisible: boolean;
  lighting: "day" | "night";
  visibilityMeters: number;
};
export type CameraCommand = {
  view: "overview" | "top-down";
  revision: number;
};

const WORLD_SIZE_METERS = 12_000;
const TERRAIN_SEGMENTS = 112;

function createTerrainGeometry(seed: number): THREE.PlaneGeometry {
  const geometry = new THREE.PlaneGeometry(
    WORLD_SIZE_METERS,
    WORLD_SIZE_METERS,
    TERRAIN_SEGMENTS,
    TERRAIN_SEGMENTS,
  );
  const positions = geometry.attributes.position;
  const colors: number[] = [];
  const color = new THREE.Color();

  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index);
    const z = -positions.getY(index);
    const elevation = terrainHeight(x, z, seed);
    positions.setZ(index, elevation);

    if (elevation < 75) color.set("#18323b");
    else if (elevation < 160) color.set("#315044");
    else if (elevation < 270) color.set("#52634b");
    else color.set("#777766");

    const variation = 0.88 + ((index * 17 + seed) % 13) / 100;
    colors.push(color.r * variation, color.g * variation, color.b * variation);
  }

  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

function seededPositions(seed: number, count: number, spread: number) {
  let value = (seed >>> 0) || 1;
  const next = () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x1_0000_0000;
  };

  return Array.from({ length: count }, () => ({
    x: (next() - 0.5) * spread,
    z: (next() - 0.5) * spread,
    scale: 0.65 + next() * 1.2,
  }));
}

type XYZ = [number, number, number];

function appendSegment(lines: number[], from: XYZ, to: XYZ) {
  lines.push(...from, ...to);
}

function makeLineGeometry(lines: number[]) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(lines, 3));
  return geometry;
}

function localPoint(cx: number, cz: number, rotation: number, x: number, z: number): [number, number] {
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  return [cx + x * cosine + z * sine, cz - x * sine + z * cosine];
}

function appendLocalSegment(
  lines: number[], cx: number, cz: number, rotation: number,
  from: XYZ, to: XYZ,
) {
  const a = localPoint(cx, cz, rotation, from[0], from[2]);
  const b = localPoint(cx, cz, rotation, to[0], to[2]);
  appendSegment(lines, [a[0], from[1], a[1]], [b[0], to[1], b[1]]);
}

function appendBuildingWireframe(
  lines: number[], seed: number, cx: number, cz: number,
  width: number, depth: number, height: number, rotation: number,
  kind: "industrial" | "administrative" | "utility",
) {
  const base = terrainHeight(cx, cz, seed) + 4;
  const halfW = width / 2;
  const halfD = depth / 2;
  const corners: Array<[number, number]> = [
    [-halfW, -halfD], [halfW, -halfD], [halfW, halfD], [-halfW, halfD],
  ];
  const levels = [0, height];
  for (const level of levels) {
    corners.forEach((corner, index) => {
      const next = corners[(index + 1) % corners.length];
      appendLocalSegment(lines, cx, cz, rotation,
        [corner[0], base + level, corner[1]], [next[0], base + level, next[1]]);
    });
  }
  corners.forEach(([x, z]) => appendLocalSegment(lines, cx, cz, rotation,
    [x, base, z], [x, base + height, z]));

  if (kind === "industrial") {
    const ridgeHeight = base + height + Math.min(55, depth * 0.12);
    for (const endZ of [-halfD, halfD]) {
      appendLocalSegment(lines, cx, cz, rotation,
        [-halfW, base + height, endZ], [0, ridgeHeight, endZ]);
      appendLocalSegment(lines, cx, cz, rotation,
        [0, ridgeHeight, endZ], [halfW, base + height, endZ]);
    }
    appendLocalSegment(lines, cx, cz, rotation,
      [0, ridgeHeight, -halfD], [0, ridgeHeight, halfD]);
    for (let x = -halfW + 55; x < halfW - 25; x += 85) {
      appendLocalSegment(lines, cx, cz, rotation,
        [x, base + height + 12, -halfD + 8], [x, base + height + 12, halfD - 8]);
    }
  }

  const floors = kind === "administrative" ? 3 : kind === "utility" ? 1 : 2;
  for (let floor = 0; floor < floors; floor += 1) {
    const y = base + (floor + 0.55) * height / floors;
    const windowCount = kind === "industrial" ? 3 : Math.max(3, Math.floor(width / 55));
    for (let window = 1; window < windowCount; window += 1) {
      const x = -halfW + (width * window) / windowCount;
      appendLocalSegment(lines, cx, cz, rotation,
        [x, y - 15, -halfD], [x, y + 15, -halfD]);
      appendLocalSegment(lines, cx, cz, rotation,
        [x, y - 15, halfD], [x, y + 15, halfD]);
    }
    for (let z = -halfD + 50; z < halfD; z += 90) {
      appendLocalSegment(lines, cx, cz, rotation,
        [-halfW, y, z], [halfW, y, z]);
    }
  }
}

function Terrain({
  seed,
  mode,
  settings,
  onTerrainClick,
}: {
  seed: number;
  mode: EnvironmentMode;
  settings: SceneSettings;
  onTerrainClick: (point: WorldPoint) => void;
}) {
  const geometry = useMemo(() => createTerrainGeometry(seed), [seed]);
  const technical = mode === "technical";

  return (
    <mesh
      geometry={geometry}
      rotation={[-Math.PI / 2, 0, 0]}
      receiveShadow={false}
      visible={settings.terrainVisible}
      onClick={(event) => {
        event.stopPropagation();
        onTerrainClick({ x: event.point.x, z: event.point.z });
      }}
    >
      <meshStandardMaterial
        color={technical ? "#1b9c91" : "#ffffff"}
        vertexColors={!technical}
        wireframe={settings.terrainGrid}
        transparent={technical}
        opacity={technical ? 0.58 : 0.82}
        roughness={0.94}
        metalness={technical ? 0.22 : 0}
      />
    </mesh>
  );
}

function Buildings({ seed, center }: { seed: number; center: WorldPoint }) {
  const geometry = useMemo(() => {
    const lines: number[] = [];
    const sites = seededPositions(seed + 91, 150, 7_200);
    sites.forEach((site, index) => {
      const x = THREE.MathUtils.clamp(center.x + site.x, -5_650, 5_650);
      const z = THREE.MathUtils.clamp(center.z + site.z, -5_650, 5_650);
      if (Math.hypot(x - center.x, z - center.z) < 620) return;
      const industrial = index % 5 < 2;
      const administrative = index % 5 === 2;
      const kind = industrial ? "industrial" : administrative ? "administrative" : "utility";
      const width = (industrial ? 250 : administrative ? 145 : 85) * site.scale;
      const depth = (industrial ? 190 : administrative ? 125 : 75) * site.scale;
      const height = (industrial ? 105 : administrative ? 75 : 40) * site.scale;
      appendBuildingWireframe(lines, seed, x, z, width, depth, height, (index % 8) * Math.PI / 8, kind);
    });
    return makeLineGeometry(lines);
  }, [center.x, center.z, seed]);

  return <lineSegments geometry={geometry} frustumCulled><lineBasicMaterial color="#65b9bd" transparent opacity={0.86} /></lineSegments>;
}

function Forest({ seed, center }: { seed: number; center: WorldPoint }) {
  const trunksRef = useRef<THREE.InstancedMesh>(null);
  const coneCrownsRef = useRef<THREE.InstancedMesh>(null);
  const icoCrownsRef = useRef<THREE.InstancedMesh>(null);
  const trees = useMemo(() => seededPositions(seed + 307, 240, 9_000), [seed]);
  const branches = useMemo(() => {
    const lines: number[] = [];
    trees.forEach((tree, index) => {
      const x = THREE.MathUtils.clamp(center.x + tree.x, -5_700, 5_700);
      const z = THREE.MathUtils.clamp(center.z + tree.z, -5_700, 5_700);
      const scale = tree.scale;
      const base = terrainHeight(x, z, seed);
      const height = (index % 4 === 0 ? 62 : 105) * scale;
      const branchCount = index % 4 === 0 ? 5 : 7;
      for (let branch = 0; branch < branchCount; branch += 1) {
        const angle = branch * Math.PI * (3 - Math.sqrt(5)) + index * 0.31;
        const startY = base + height * (0.28 + (branch % 3) * 0.09);
        const reach = (27 + (branch % 2) * 12) * scale;
        const middle: XYZ = [x + Math.cos(angle) * reach * 0.45, startY + reach * 0.55, z + Math.sin(angle) * reach * 0.45];
        const tip: XYZ = [x + Math.cos(angle) * reach, startY + reach, z + Math.sin(angle) * reach];
        appendSegment(lines, [x, startY - 12 * scale, z], middle);
        appendSegment(lines, middle, tip);
      }
    });
    return makeLineGeometry(lines);
  }, [center.x, center.z, seed, trees]);

  useLayoutEffect(() => {
    const trunks = trunksRef.current;
    const cones = coneCrownsRef.current;
    const icos = icoCrownsRef.current;
    if (!trunks || !cones || !icos) return;
    const transform = new THREE.Object3D();
    let coneIndex = 0;
    let icoIndex = 0;

    trees.forEach((tree, index) => {
      const x = THREE.MathUtils.clamp(center.x + tree.x, -5_700, 5_700);
      const z = THREE.MathUtils.clamp(center.z + tree.z, -5_700, 5_700);
      const ground = terrainHeight(x, z, seed);
      const tall = index % 4 !== 0;
      transform.position.set(x, ground + (tall ? 28 : 19) * tree.scale, z);
      transform.scale.set(tree.scale * 0.72, tree.scale * (tall ? 1.1 : 0.7), tree.scale * 0.72);
      transform.updateMatrix();
      trunks.setMatrixAt(index, transform.matrix);

      transform.position.y = ground + (tall ? 70 : 44) * tree.scale;
      transform.scale.setScalar(tree.scale);
      transform.rotation.set(0, index * 0.7, 0);
      transform.updateMatrix();
      if (tall) cones.setMatrixAt(coneIndex++, transform.matrix);
      else icos.setMatrixAt(icoIndex++, transform.matrix);
    });

    trunks.instanceMatrix.needsUpdate = true;
    cones.instanceMatrix.needsUpdate = true;
    icos.instanceMatrix.needsUpdate = true;
    cones.count = coneIndex;
    icos.count = icoIndex;
  }, [center.x, center.z, seed, trees]);

  return (
    <>
      <lineSegments geometry={branches} frustumCulled><lineBasicMaterial color="#55bfb5" transparent opacity={0.85} /></lineSegments>
      <instancedMesh ref={trunksRef} args={[undefined, undefined, trees.length]}>
        <cylinderGeometry args={[5, 8, 34, 5]} />
        <meshBasicMaterial color="#4eb8ad" wireframe />
      </instancedMesh>
      <instancedMesh ref={coneCrownsRef} args={[undefined, undefined, trees.length]}>
        <coneGeometry args={[38, 92, 7, 2]} />
        <meshBasicMaterial color="#51c9bb" wireframe />
      </instancedMesh>
      <instancedMesh ref={icoCrownsRef} args={[undefined, undefined, trees.length]}>
        <icosahedronGeometry args={[43, 1]} />
        <meshBasicMaterial color="#64bcb3" wireframe />
      </instancedMesh>
    </>
  );
}

function WorldMarkers({
  seed,
  destinationPoint,
  flight,
}: {
  seed: number;
  destinationPoint: WorldPoint;
  flight: FlightState | null;
}) {
  const spawn = flight
    ? new THREE.Vector3(flight.spawn.x, terrainHeight(flight.spawn.x, flight.spawn.z, seed), flight.spawn.z)
    : new THREE.Vector3(-3_200, terrainHeight(-3_200, -700, seed), -700);
  const destination = new THREE.Vector3(
    destinationPoint.x,
    terrainHeight(destinationPoint.x, destinationPoint.z, seed),
    destinationPoint.z,
  );

  return (
    <>
      <mesh position={[spawn.x, spawn.y + 45, spawn.z]}>
        <sphereGeometry args={[55, 16, 12]} />
        <meshBasicMaterial color="#ff5873" wireframe />
      </mesh>
      <Html position={[spawn.x, spawn.y + 150, spawn.z]} center distanceFactor={7_000}>
        <span className="world-marker-label spawn-label">{flight ? "DRONE SPAWN" : "SPAWN AREA"}</span>
      </Html>
      <mesh position={[destination.x, destination.y + 10, destination.z]}>
        <torusGeometry args={[115, 9, 8, 48]} />
        <meshBasicMaterial color="#ffc45b" wireframe />
      </mesh>
      <mesh position={[destination.x, destination.y + 70, destination.z]}>
        <octahedronGeometry args={[42, 0]} />
        <meshBasicMaterial color="#ffc45b" wireframe />
      </mesh>
      <Html
        position={[destination.x, destination.y + 180, destination.z]}
        center
        distanceFactor={7_000}
      >
        <span className="world-marker-label destination-label">
          SAFE ZONE-01
        </span>
      </Html>
      {flight?.drone_id && (
        <>
          <Line
            points={[spawn, new THREE.Vector3(flight.position.x, flight.position.y, flight.position.z)]}
            color="#4be5d0"
            lineWidth={2}
          />
          <Line
            points={[new THREE.Vector3(flight.position.x, flight.position.y, flight.position.z), destination]}
            color="#ffc45b"
            lineWidth={1.4}
            dashed
            dashSize={75}
            gapSize={45}
          />
          <DroneModel flight={flight} />
        </>
      )}
    </>
  );
}

function DroneModel({ flight }: { flight: FlightState }) {
  const { x, y, z } = flight.position;
  return (
    <group position={[x, y, z]} rotation={[0, -flight.heading_deg * Math.PI / 180, 0]}>
      <mesh>
        <boxGeometry args={[34, 14, 44]} />
        <meshBasicMaterial color="#d4e5e2" wireframe />
      </mesh>
      <mesh position={[0, 2, -27]}>
        <coneGeometry args={[8, 20, 4]} />
        <meshBasicMaterial color="#ffc45b" wireframe />
      </mesh>
      {([-1, 1] as const).flatMap((side) => ([-1, 1] as const).map((front) => (
        <group key={`${side}-${front}`} position={[side * 45, 0, front * 43]}>
          <mesh rotation={[0, 0, Math.atan2(side, front)]}>
            <boxGeometry args={[8, 5, 78]} />
            <meshBasicMaterial color="#8daaa7" wireframe />
          </mesh>
          <mesh position={[0, 8, 0]}>
            <cylinderGeometry args={[25, 25, 3, 20]} />
            <meshBasicMaterial color="#49dcca" transparent opacity={0.85} wireframe />
          </mesh>
          <mesh position={[0, -8, 0]}>
            <sphereGeometry args={[8, 10, 8]} />
            <meshBasicMaterial color={side === front ? "#ff5873" : "#ffc45b"} />
          </mesh>
        </group>
      ))) }
      <Html position={[0, 70, 0]} center distanceFactor={6_000}>
        <span className="world-marker-label drone-label">{flight.drone_id} · {flight.status === "complete" ? "LANDED" : flight.status.toUpperCase()}</span>
      </Html>
      <mesh position={[0, -flight.altitude_m + 5, 0]}>
        <ringGeometry args={[23, 29, 24]} />
        <meshBasicMaterial color="#49dcca" side={THREE.DoubleSide} wireframe />
      </mesh>
    </group>
  );
}

function WorldRoad({ seed, center }: { seed: number; center: WorldPoint }) {
  const roads = useMemo(() => {
    const main: number[] = [];
    const secondary: number[] = [];
    const markings: number[] = [];
    const roadY = (x: number, z: number) => terrainHeight(x, z, seed) + 8;
    const verticals = [-5_000, -3_200, -1_400, 400, 2_200, 4_000, 5_700];
    const horizontals = [-5_400, -3_600, -1_800, 0, 1_800, 3_600, 5_400];

    const addRoad = (axis: "x" | "z", fixed: number, width: number, target: number[]) => {
      const half = width / 2;
      for (const edge of [-half, half]) {
        const points: XYZ[] = [];
        for (let step = 0; step <= 50; step += 1) {
          const along = -5_900 + (11_800 * step) / 50;
          const x = axis === "x" ? along : fixed + edge;
          const z = axis === "z" ? along : fixed + edge;
          points.push([x, roadY(x, z), z]);
        }
        for (let index = 1; index < points.length; index += 1) {
          appendSegment(target, points[index - 1], points[index]);
        }
      }
    };

    verticals.forEach((x, index) => addRoad("z", x + (seed % 71) - 35, index === 3 ? 155 : 95, index === 3 ? main : secondary));
    horizontals.forEach((z, index) => addRoad("x", z + (seed % 53) - 26, index === 3 ? 155 : 95, index === 3 ? main : secondary));

    // Two curved access spurs connect the nearest road junctions to SAFE ZONE-01.
    for (const direction of [-1, 1]) {
      const startX = THREE.MathUtils.clamp(center.x + direction * 1_500, -5_800, 5_800);
      const startZ = THREE.MathUtils.clamp(center.z - 1_250, -5_800, 5_800);
      const controlX = center.x + direction * 700;
      const samples = new THREE.CatmullRomCurve3([
        new THREE.Vector3(startX, roadY(startX, startZ) + 4, startZ),
        new THREE.Vector3(controlX, roadY(controlX, startZ - 100) + 4, startZ - 100),
        new THREE.Vector3(center.x, roadY(center.x, center.z) + 4, center.z),
      ]).getPoints(36);
      for (const side of [-1, 1]) {
        for (let index = 1; index < samples.length; index += 1) {
          const from = samples[index - 1].clone();
          const to = samples[index].clone();
          from.x += side * 42; to.x += side * 42;
          appendSegment(main, [from.x, from.y, from.z], [to.x, to.y, to.z]);
        }
      }
    }

    for (let x = -5_700; x < 5_700; x += 240) {
      if (Math.abs(x - center.x) < 850) continue;
      const z = THREE.MathUtils.clamp((seed % 53) - 26, -5_700, 5_700);
      appendSegment(markings, [x, roadY(x, z) + 12, z - 4], [x + 115, roadY(x + 115, z) + 12, z - 4]);
    }

    return { main: makeLineGeometry(main), secondary: makeLineGeometry(secondary), markings: makeLineGeometry(markings) };
  }, [center.x, center.z, seed]);

  return (
    <group>
      <lineSegments geometry={roads.secondary} frustumCulled><lineBasicMaterial color="#2a7778" transparent opacity={0.58} /></lineSegments>
      <lineSegments geometry={roads.main} frustumCulled><lineBasicMaterial color="#69d6d0" transparent opacity={0.9} /></lineSegments>
      <lineSegments geometry={roads.markings} frustumCulled><lineBasicMaterial color="#8de3d7" transparent opacity={0.72} /></lineSegments>
    </group>
  );
}

function MonitoringOutpost({ seed, center }: { seed: number; center: WorldPoint }) {
  const geometry = useMemo(() => {
    const lines: number[] = [];
    const perimeter = 520;
    const corners: Array<[number, number]> = [
      [center.x - perimeter, center.z - perimeter], [center.x + perimeter, center.z - perimeter],
      [center.x + perimeter, center.z + perimeter], [center.x - perimeter, center.z + perimeter],
    ];
    corners.forEach((corner, index) => {
      const next = corners[(index + 1) % corners.length];
      appendSegment(lines, [corner[0], terrainHeight(corner[0], corner[1], seed) + 12, corner[1]],
        [next[0], terrainHeight(next[0], next[1], seed) + 12, next[1]]);
    });

    appendBuildingWireframe(lines, seed, center.x, center.z, 270, 220, 145, 0, "administrative");
    appendBuildingWireframe(lines, seed, center.x - 300, center.z - 250, 125, 100, 58, 0.18, "utility");
    appendBuildingWireframe(lines, seed, center.x + 300, center.z + 235, 140, 110, 70, -0.2, "utility");
    appendBuildingWireframe(lines, seed, center.x + 320, center.z - 270, 105, 95, 46, 0.35, "utility");

    const sensors = Array.from({ length: 6 }, (_, index) => {
      const angle = index * Math.PI / 3 + (seed % 17) * 0.025;
      return { x: center.x + Math.cos(angle) * 650, z: center.z + Math.sin(angle) * 650, angle };
    });
    sensors.forEach(({ x, z, angle }, index) => {
      const base = terrainHeight(x, z, seed) + 8;
      const height = index % 2 === 0 ? 210 : 155;
      const half = 26;
      for (const [dx, dz] of [[-half, -half], [half, -half], [half, half], [-half, half]] as Array<[number, number]>) {
        appendSegment(lines, [x + dx, base, z + dz], [x + dx * 0.45, base + height, z + dz * 0.45]);
      }
      for (const y of [0.25, 0.5, 0.75, 1]) {
        const w = half * (1 - y * 0.5);
        const points: XYZ[] = [[x - w, base + height * y, z - w], [x + w, base + height * y, z - w],
          [x + w, base + height * y, z + w], [x - w, base + height * y, z + w]];
        points.forEach((point, pointIndex) => appendSegment(lines, point, points[(pointIndex + 1) % points.length]));
      }

      const dishCenter: XYZ = [x, base + height + 5, z];
      const radius = 72;
      const facingX = Math.cos(angle + Math.PI);
      const facingZ = Math.sin(angle + Math.PI);
      const rightX = -facingZ;
      const rightZ = facingX;
      for (let ring = 1; ring <= 4; ring += 1) {
        const ringRadius = (radius * ring) / 4;
        const dishRing: XYZ[] = [];
        for (let step = 0; step <= 32; step += 1) {
          const theta = (step / 32) * Math.PI * 2;
          const curve = (ringRadius * ringRadius) / (radius * 1.5);
          dishRing.push([
            dishCenter[0] + rightX * Math.cos(theta) * ringRadius + facingX * curve,
            dishCenter[1] + Math.sin(theta) * ringRadius,
            dishCenter[2] + rightZ * Math.cos(theta) * ringRadius + facingZ * curve,
          ]);
        }
        for (let step = 1; step < dishRing.length; step += 1) appendSegment(lines, dishRing[step - 1], dishRing[step]);
      }
      for (let spoke = 0; spoke < 12; spoke += 1) {
        const theta = (spoke / 12) * Math.PI * 2;
        appendSegment(lines, dishCenter, [
          dishCenter[0] + rightX * Math.cos(theta) * radius + facingX * (radius / 1.5),
          dishCenter[1] + Math.sin(theta) * radius,
          dishCenter[2] + rightZ * Math.cos(theta) * radius + facingZ * (radius / 1.5),
        ]);
      }

      for (let step = 0; step < 48; step += 1) {
        const a = (step / 48) * Math.PI * 2;
        const b = ((step + 1) / 48) * Math.PI * 2;
        appendSegment(lines,
          [x + Math.cos(a) * 245, base + 5, z + Math.sin(a) * 245],
          [x + Math.cos(b) * 245, base + 5, z + Math.sin(b) * 245]);
      }
    });

    return makeLineGeometry(lines);
  }, [center.x, center.z, seed]);

  return <lineSegments geometry={geometry} frustumCulled><lineBasicMaterial color="#5fd8cd" transparent opacity={0.9} /></lineSegments>;
}

function createMonitoringSphere(radius: number) {
  const positions: number[] = [];
  const latitudeCount = 14;
  const longitudeCount = 24;
  const segments = 72;
  for (let latitude = 1; latitude < latitudeCount; latitude += 1) {
    const phi = (latitude / latitudeCount) * Math.PI;
    let previous: XYZ | undefined;
    for (let step = 0; step <= segments; step += 1) {
      const theta = (step / segments) * Math.PI * 2;
      const point: XYZ = [
        radius * Math.sin(phi) * Math.cos(theta),
        radius * Math.cos(phi),
        radius * Math.sin(phi) * Math.sin(theta),
      ];
      if (previous) appendSegment(positions, previous, point);
      previous = point;
    }
  }
  for (let longitude = 0; longitude < longitudeCount; longitude += 1) {
    const theta = (longitude / longitudeCount) * Math.PI * 2;
    let previous: XYZ | undefined;
    for (let step = 0; step <= segments; step += 1) {
      const phi = (step / segments) * Math.PI;
      const point: XYZ = [
        radius * Math.sin(phi) * Math.cos(theta),
        radius * Math.cos(phi),
        radius * Math.sin(phi) * Math.sin(theta),
      ];
      if (previous) appendSegment(positions, previous, point);
      previous = point;
    }
  }
  return makeLineGeometry(positions);
}

function MonitoringZones({ seed, center }: { seed: number; center: WorldPoint }) {
  const sphereGeometries = useMemo(() => [2_450, 1_650, 850].map(createMonitoringSphere), []);
  const position: [number, number, number] = [center.x, terrainHeight(center.x, center.z, seed) + 220, center.z];
  return (
    <group position={position}>
      <lineSegments geometry={sphereGeometries[0]} frustumCulled={false} renderOrder={2}><lineBasicMaterial color="#35c9ef" transparent opacity={0.52} depthWrite={false} /></lineSegments>
      <lineSegments geometry={sphereGeometries[1]} frustumCulled={false} renderOrder={3}><lineBasicMaterial color="#ffbd4a" transparent opacity={0.68} depthWrite={false} /></lineSegments>
      <lineSegments geometry={sphereGeometries[2]} frustumCulled={false} renderOrder={4}><lineBasicMaterial color="#ff5367" transparent opacity={0.8} depthWrite={false} /></lineSegments>
    </group>
  );
}

function CameraRig({ command, center, seed }: { command: CameraCommand; center: WorldPoint; seed: number }) {
  const { camera, controls } = useThree();

  useEffect(() => {
    if (command.revision === 0) return;
    const target = new THREE.Vector3(center.x, terrainHeight(center.x, center.z, seed) + 180, center.z);
    if (command.view === "top-down") {
      camera.position.set(target.x, target.y + 9_500, target.z + 0.1);
      camera.up.set(0, 0, -1);
    } else {
      camera.position.set(target.x + 3_900, target.y + 4_200, target.z + 4_500);
      camera.up.set(0, 1, 0);
    }
    camera.lookAt(target);
    camera.updateProjectionMatrix();

    const orbit = controls as unknown as
      | { target: THREE.Vector3; update: () => void }
      | null;
    if (orbit) {
      orbit.target.copy(target);
      orbit.update();
    }
  }, [camera, center.x, center.z, command, controls, seed]);

  return null;
}

export function OpenWorldScene({
  seed,
  mode,
  cameraCommand,
  settings,
  destinationPoint,
  flight,
  onTerrainClick,
}: {
  seed: number;
  mode: EnvironmentMode;
  cameraCommand: CameraCommand;
  settings: SceneSettings;
  destinationPoint: WorldPoint;
  flight: FlightState | null;
  onTerrainClick: (point: WorldPoint) => void;
}) {
  const night = settings.lighting === "night";
  const background = night
    ? "#02060c"
    : "#040b12";
  const cameraTarget: [number, number, number] = [
    destinationPoint.x,
    terrainHeight(destinationPoint.x, destinationPoint.z, seed) + 180,
    destinationPoint.z,
  ];
  return (
    <Canvas
      camera={{ position: [cameraTarget[0] + 3_900, cameraTarget[1] + 4_200, cameraTarget[2] + 4_500], fov: 42, near: 10, far: 30_000 }}
      dpr={[1, 1.5]}
      frameloop="demand"
      gl={{ antialias: true, powerPreference: "low-power", alpha: false }}
      className="open-world-canvas"
    >
      <color attach="background" args={[background]} />
      <fog
        attach="fog"
        args={[background, Math.min(4_500, settings.visibilityMeters * 0.45), settings.visibilityMeters]}
      />
      <ambientLight intensity={night ? 0.18 : mode === "technical" ? 0.6 : 1.1} />
      <directionalLight
        position={night ? [1_000, 5_000, -3_000] : [-3_000, 7_000, 2_000]}
        intensity={night ? 0.35 : mode === "technical" ? 1.1 : 2.2}
      />
      <Terrain seed={seed} mode={mode} settings={settings} onTerrainClick={onTerrainClick} />
      {settings.coordinateGrid && <Grid
        position={[0, -150, 0]}
        args={[WORLD_SIZE_METERS, WORLD_SIZE_METERS]}
        cellSize={500}
        sectionSize={2_000}
        cellColor={mode === "technical" ? "#155057" : "#52625b"}
        sectionColor={mode === "technical" ? "#28716c" : "#829083"}
        cellThickness={0.45}
        sectionThickness={0.8}
        fadeDistance={11_000}
        fadeStrength={1.5}
        infiniteGrid={false}
      />}
      {!settings.terrainVisible && (
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, -800, 0]}
          onClick={(event) => {
            event.stopPropagation();
            onTerrainClick({ x: event.point.x, z: event.point.z });
          }}
        >
          <planeGeometry args={[WORLD_SIZE_METERS, WORLD_SIZE_METERS]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      )}
      {settings.roadsVisible && <WorldRoad seed={seed} center={destinationPoint} />}
      {settings.buildingsVisible && (
        <>
          <Buildings seed={seed} center={destinationPoint} />
          <MonitoringOutpost seed={seed} center={destinationPoint} />
        </>
      )}
      {settings.forestVisible && <Forest seed={seed} center={destinationPoint} />}
      <MonitoringZones seed={seed} center={destinationPoint} />
      <WorldMarkers seed={seed} destinationPoint={destinationPoint} flight={flight} />

      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        minDistance={1_200}
        maxDistance={13_000}
        maxPolarAngle={Math.PI * 0.49}
        target={cameraTarget}
      />
      <CameraRig command={cameraCommand} center={destinationPoint} seed={seed} />
    </Canvas>
  );
}
