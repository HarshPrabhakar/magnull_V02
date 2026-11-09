import { useEffect, useMemo } from "react";
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
const TERRAIN_SEGMENTS = 192;

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

function seededFacilitySites(seed: number) {
  const angle = ((((seed * 0.61803398875) % 1) + 1) % 1) * Math.PI * 2;
  const distance = 4_500 + (seed % 7) * 35;
  const direction = new THREE.Vector2(Math.cos(angle), Math.sin(angle));
  return {
    angle,
    direction,
    distance,
    first: { x: -direction.x * distance, z: -direction.y * distance },
    second: { x: direction.x * distance, z: direction.y * distance },
  };
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
  kind: "industrial" | "administrative" | "utility" | "house",
  roofStyle = 0,
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

  if (kind === "industrial" || (kind === "house" && roofStyle % 3 !== 2)) {
    const ridgeHeight = base + height + Math.min(55, depth * 0.12);
    const ridgeX = roofStyle % 3 === 1 ? halfW * 0.18 : 0;
    for (const endZ of [-halfD, halfD]) {
      appendLocalSegment(lines, cx, cz, rotation,
        [-halfW, base + height, endZ], [ridgeX, ridgeHeight, endZ]);
      appendLocalSegment(lines, cx, cz, rotation,
        [ridgeX, ridgeHeight, endZ], [halfW, base + height, endZ]);
    }
    appendLocalSegment(lines, cx, cz, rotation,
      [ridgeX, ridgeHeight, -halfD], [ridgeX, ridgeHeight, halfD]);
    for (let x = -halfW + (kind === "house" ? 35 : 55); x < halfW - 25; x += kind === "house" ? 70 : 85) {
      appendLocalSegment(lines, cx, cz, rotation,
        [x, base + height + 12, -halfD + 8], [x, base + height + 12, halfD - 8]);
    }
    // Eaves, roof rafters and a short ridge make the residential silhouette
    // legible from oblique and top-down views.
    if (kind === "house") {
      for (const side of [-1, 1]) {
        const eaveX = side * halfW;
        for (let z = -halfD; z <= halfD; z += Math.max(40, depth / 3)) {
          appendLocalSegment(lines, cx, cz, rotation,
            [eaveX, base + height, z], [ridgeX, ridgeHeight, z]);
        }
      }
      if (roofStyle % 3 === 1) {
        const extension = width * 0.08;
        appendLocalSegment(lines, cx, cz, rotation,
          [-halfW - extension, base + height - 5, -halfD - 10],
          [halfW + extension, base + height - 5, -halfD - 10]);
      }
    }
  }

  if (kind === "house" && roofStyle % 3 === 2) {
    // Flat-roof, stepped residential variant from the wireframe reference.
    const upperW = halfW * 0.64;
    const upperD = halfD * 0.62;
    const upperY = base + height * 0.72;
    const upper = [[-upperW, -upperD], [upperW, -upperD], [upperW, upperD], [-upperW, upperD]] as const;
    upper.forEach((corner, index) => {
      const next = upper[(index + 1) % upper.length];
      appendLocalSegment(lines, cx, cz, rotation,
        [corner[0], upperY, corner[1]], [next[0], upperY, next[1]]);
      appendLocalSegment(lines, cx, cz, rotation,
        [corner[0], upperY, corner[1]], [corner[0], base + height, corner[1]]);
    });
    upper.forEach((corner, index) => appendLocalSegment(lines, cx, cz, rotation,
      [corner[0], base + height, corner[1]], [upper[(index + 1) % upper.length][0], base + height, upper[(index + 1) % upper.length][1]]));
  }

  const floors = kind === "administrative" ? 3 : kind === "utility" ? 1 : kind === "house" ? (roofStyle % 3 === 1 ? 2 : 1) : 2;
  if (kind === "house") {
    // Framed windows and a clear entrance on all four facades.
    const windowW = Math.max(18, Math.min(34, width * 0.13));
    const windowH = Math.max(22, Math.min(32, height * 0.3));
    const facadeZ = [-halfD - 1, halfD + 1];
    const facadeX = [-halfW - 1, halfW + 1];
    const windowColumns = width > 150 ? [-0.28, 0.28] : [0];
    const addWindow = (wx: number, wy: number, wz: number, axis: "x" | "z") => {
      const corners: XYZ[] = axis === "z"
        ? [[wx - windowW / 2, wy - windowH / 2, wz], [wx + windowW / 2, wy - windowH / 2, wz], [wx + windowW / 2, wy + windowH / 2, wz], [wx - windowW / 2, wy + windowH / 2, wz]]
        : [[wx, wy - windowH / 2, wz - windowW / 2], [wx, wy - windowH / 2, wz + windowW / 2], [wx, wy + windowH / 2, wz + windowW / 2], [wx, wy + windowH / 2, wz - windowW / 2]];
      corners.forEach((point, index) => appendLocalSegment(lines, cx, cz, rotation, point, corners[(index + 1) % corners.length]));
      appendLocalSegment(lines, cx, cz, rotation, corners[0], corners[2]);
      appendLocalSegment(lines, cx, cz, rotation, corners[1], corners[3]);
    };
    for (const z of facadeZ) {
      windowColumns.forEach((ratio) => addWindow(ratio * width, base + height * 0.58, z, "z"));
      // Offset the door from the facade center so it does not overlap a window.
      const doorX = halfW * 0.48;
      appendLocalSegment(lines, cx, cz, rotation, [doorX - 16, base, z], [doorX - 16, base + height * 0.62, z]);
      appendLocalSegment(lines, cx, cz, rotation, [doorX + 16, base, z], [doorX + 16, base + height * 0.62, z]);
      appendLocalSegment(lines, cx, cz, rotation, [doorX - 16, base + height * 0.62, z], [doorX + 16, base + height * 0.62, z]);
    }
    for (const x of facadeX) windowColumns.forEach((ratio) => addWindow(x, base + height * 0.58, ratio * depth, "x"));
    if (roofStyle % 3 === 0) {
      const chimneyX = -halfW * 0.55;
      const chimneyZ = halfD * 0.3;
      const chimneyW = Math.max(16, width * 0.09);
      const chimneyBase = base + height + Math.min(55, depth * 0.12) * 0.45;
      const chimneyTop = chimneyBase + height * 0.34;
      const chimneyCorners: XYZ[] = [[chimneyX - chimneyW / 2, chimneyBase, chimneyZ - chimneyW / 2], [chimneyX + chimneyW / 2, chimneyBase, chimneyZ - chimneyW / 2], [chimneyX + chimneyW / 2, chimneyBase, chimneyZ + chimneyW / 2], [chimneyX - chimneyW / 2, chimneyBase, chimneyZ + chimneyW / 2]];
      chimneyCorners.forEach((point, index) => {
        const next = chimneyCorners[(index + 1) % chimneyCorners.length];
        appendLocalSegment(lines, cx, cz, rotation, point, next);
        appendLocalSegment(lines, cx, cz, rotation, point, [point[0], chimneyTop, point[2]]);
        appendLocalSegment(lines, cx, cz, rotation, [point[0], chimneyTop, point[2]], [next[0], chimneyTop, next[2]]);
      });
    }
    return;
  }

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

function Buildings({ seed }: { seed: number }) {
  const geometry = useMemo(() => {
    const lines: number[] = [];
    const { angle, first, second } = seededFacilitySites(seed);
    const rotation = -angle;

    const appendCompound = (
      cx: number, cz: number, halfWidth: number, halfDepth: number,
      gateSide: "positive-x" | "negative-x",
    ) => {
      const corners: Array<[number, number]> = [
        [-halfWidth, -halfDepth], [halfWidth, -halfDepth],
        [halfWidth, halfDepth], [-halfWidth, halfDepth],
      ];
      corners.forEach((corner, index) => {
        const next = corners[(index + 1) % corners.length];
        const gateEdge = gateSide === "positive-x" ? index === 1 : index === 3;
        const edgeParts: Array<[[number, number], [number, number]]> = gateEdge
          ? gateSide === "positive-x"
            ? [[[halfWidth, -halfDepth], [halfWidth, -175]], [[halfWidth, 175], [halfWidth, halfDepth]]]
            : [[[-halfWidth, -halfDepth], [-halfWidth, -175]], [[-halfWidth, 175], [-halfWidth, halfDepth]]]
          : [[corner, next]];
        edgeParts.forEach(([fromLocal, toLocal]) => {
          const from = localPoint(cx, cz, rotation, fromLocal[0], fromLocal[1]);
          const to = localPoint(cx, cz, rotation, toLocal[0], toLocal[1]);
          appendSegment(lines,
            [from[0], terrainHeight(from[0], from[1], seed) + 14, from[1]],
            [to[0], terrainHeight(to[0], to[1], seed) + 14, to[1]]);
        });
      });
      for (const x of [-halfWidth, halfWidth]) {
        for (let z = -halfDepth; z <= halfDepth; z += 150) {
          const onGateSide = gateSide === "positive-x" ? x === halfWidth : x === -halfWidth;
          if (onGateSide && Math.abs(z) < 175) continue;
          const point = localPoint(cx, cz, rotation, x, z);
          const ground = terrainHeight(point[0], point[1], seed) + 14;
          const top = localPoint(cx, cz, rotation, x, z);
          appendSegment(lines, [point[0], ground, point[1]], [top[0], ground + 54, top[1]]);
        }
      }
      for (const z of [-halfDepth, halfDepth]) {
        for (let x = -halfWidth; x <= halfWidth; x += 150) {
          const point = localPoint(cx, cz, rotation, x, z);
          const ground = terrainHeight(point[0], point[1], seed) + 14;
          appendSegment(lines, [point[0], ground, point[1]], [point[0], ground + 54, point[1]]);
        }
      }
    };

    // Facility A: the primary command and monitoring installation with an
    // attached side wing, enclosed by its own compound.
    appendCompound(first.x, first.z, 760, 620, "positive-x");
    appendBuildingWireframe(lines, seed, first.x, first.z, 570, 410, 235, rotation, "administrative");
    const wingA = localPoint(first.x, first.z, rotation, -365, 0);
    appendBuildingWireframe(lines, seed, wingA[0], wingA[1], 270, 285, 155, rotation, "administrative");

    // Facility B sits at the opposite seeded map edge, roughly 9 km away.
    appendCompound(second.x, second.z, 720, 565, "negative-x");
    appendBuildingWireframe(lines, seed, second.x, second.z, 630, 390, 195, rotation + 0.12, "industrial");
    const wingB = localPoint(second.x, second.z, rotation, 385, 0);
    appendBuildingWireframe(lines, seed, wingB[0], wingB[1], 290, 240, 132, rotation, "utility");

    return makeLineGeometry(lines);
  }, [seed]);

  return <lineSegments geometry={geometry} frustumCulled><lineBasicMaterial color="#65b9bd" transparent opacity={0.86} /></lineSegments>;
}

function Forest({ seed, center }: { seed: number; center: WorldPoint }) {
  const geometry = useMemo(() => {
    const lines: number[] = [];
    const trees = seededPositions(seed + 307, 190, 9_000);
    trees.forEach((tree, index) => {
      const x = THREE.MathUtils.clamp(center.x + tree.x, -5_700, 5_700);
      const z = THREE.MathUtils.clamp(center.z + tree.z, -5_700, 5_700);
      const scale = tree.scale;
      const base = terrainHeight(x, z, seed);
      const conifer = index % 5 === 0;
      const height = (conifer ? 145 : 115) * scale;
      const top: XYZ = [x, base + height, z];
      appendSegment(lines, [x, base, z], top);

      if (conifer) {
        // Layered, open branch whorls create a cypress or evergreen silhouette.
        for (let tier = 0; tier < 8; tier += 1) {
          const t = tier / 8;
          const y = base + height * (0.18 + t * 0.7);
          const radius = height * (0.31 * (1 - t) + 0.035) * scale;
          const rotation = index * 0.17 + tier * 0.13;
          const ring: XYZ[] = [];
          for (let point = 0; point < 9; point += 1) {
            const angle = rotation + (point / 8) * Math.PI * 2;
            ring.push([x + Math.cos(angle) * radius, y, z + Math.sin(angle) * radius]);
          }
          for (let point = 1; point < ring.length; point += 1) appendSegment(lines, ring[point - 1], ring[point]);
          for (let point = 0; point < 8; point += 1) {
            const angle = rotation + (point / 8) * Math.PI * 2;
            const branchTip: XYZ = [x + Math.cos(angle) * radius, y + height * 0.14, z + Math.sin(angle) * radius];
            appendSegment(lines, [x, y - height * 0.045, z], branchTip);
          }
        }
      } else {
        // Branching deciduous frame with several open, faceted canopy lobes.
        const canopyCenterY = base + height * 0.72;
        const branchLevels = [0.35, 0.49, 0.62];
        const lobeCenters: XYZ[] = [];
        branchLevels.forEach((level, levelIndex) => {
          const branchStart: XYZ = [x, base + height * level, z];
          const count = levelIndex === 2 ? 5 : 4;
          for (let branch = 0; branch < count; branch += 1) {
            const angle = index * 0.29 + branch * Math.PI * 2 / count + levelIndex * 0.41;
            const reach = height * (0.28 + levelIndex * 0.035) * scale;
            const end: XYZ = [x + Math.cos(angle) * reach, base + height * (level + 0.17), z + Math.sin(angle) * reach];
            const fork: XYZ = [x + Math.cos(angle) * reach * 0.55, end[1] + height * 0.07, z + Math.sin(angle) * reach * 0.55];
            appendSegment(lines, branchStart, fork);
            appendSegment(lines, fork, end);
            for (const split of [-1, 1]) {
              const sideAngle = angle + split * 0.72;
              const twig: XYZ = [end[0] + Math.cos(sideAngle) * reach * 0.34, end[1] + height * 0.08, end[2] + Math.sin(sideAngle) * reach * 0.34];
              appendSegment(lines, end, twig);
              lobeCenters.push([twig[0], canopyCenterY + (branch % 2 ? 8 : -7) * scale, twig[2]]);
            }
          }
        });

        // A light 3D mesh around the branching skeleton gives the canopy its
        // fine netted outline without using solid or photographic foliage.
        const lobeRadius = 23 * scale;
        lobeCenters.forEach(([lx, ly, lz], lobeIndex) => {
          const ringCount = 3;
          const segments = 9;
          const rings: XYZ[][] = [];
          for (let ring = 0; ring < ringCount; ring += 1) {
            const latitude = -0.58 + ring * 0.58;
            let previous: XYZ | undefined;
            const vertices: XYZ[] = [];
            for (let point = 0; point <= segments; point += 1) {
              const angle = point / segments * Math.PI * 2;
              const jitter = 0.88 + 0.12 * Math.sin(angle * 3 + lobeIndex * 1.7 + index);
              const vertex: XYZ = [
                lx + Math.cos(angle) * Math.cos(latitude) * lobeRadius * jitter,
                ly + Math.sin(latitude) * lobeRadius * 0.82 * jitter,
                lz + Math.sin(angle) * Math.cos(latitude) * lobeRadius * jitter,
              ];
              if (previous) appendSegment(lines, previous, vertex);
              previous = vertex;
              vertices.push(vertex);
            }
            rings.push(vertices);
          }
          for (let ring = 1; ring < rings.length; ring += 1) {
            for (let point = 0; point <= segments; point += 1) {
              appendSegment(lines, rings[ring - 1][point], rings[ring][point]);
            }
          }
          for (let spoke = 0; spoke < 5; spoke += 1) {
            const angle = spoke * Math.PI * 2 / 5 + index * 0.13;
            appendSegment(lines,
              [lx, ly - lobeRadius * 0.82, lz],
              [lx + Math.cos(angle) * lobeRadius, ly, lz + Math.sin(angle) * lobeRadius]);
          }
        });
      }
    });
    return makeLineGeometry(lines);
  }, [center.x, center.z, seed]);

  return <lineSegments geometry={geometry} frustumCulled><lineBasicMaterial color="#55bfb5" transparent opacity={0.86} /></lineSegments>;
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

function WorldRoad({ seed }: { seed: number }) {
  const roads = useMemo(() => {
    const main: number[] = [];
    const markings: number[] = [];
    const { direction, distance, first } = seededFacilitySites(seed);
    const lateral = new THREE.Vector2(-direction.y, direction.x);
    const roadPoint = (point: THREE.Vector2, lift = 16) => new THREE.Vector3(
      point.x,
      terrainHeight(point.x, point.y, seed) + lift,
      point.y,
    );
    const roadStart = 790;
    const roadEnd = distance * 2 - 745;
    const roadLength = roadEnd - roadStart;
    const routeControls = [
      { fraction: 0, across: 0 },
      { fraction: 0.1, across: 0 },
      { fraction: 0.22, across: 760 },
      { fraction: 0.36, across: 1_150 },
      { fraction: 0.5, across: 850 },
      { fraction: 0.64, across: -850 },
      { fraction: 0.78, across: -1_100 },
      { fraction: 0.9, across: 0 },
      { fraction: 1, across: 0 },
    ];
    const routePoints = routeControls.map(({ fraction, across }) => roadPoint(new THREE.Vector2(
      first.x + direction.x * (roadStart + roadLength * fraction) + lateral.x * across,
      first.z + direction.y * (roadStart + roadLength * fraction) + lateral.y * across,
    )));
    // A seeded multi-bend spline leaves Facility A through its gate, winds
    // across the terrain, and reaches Facility B through the opposite gate.
    const curve = new THREE.CatmullRomCurve3(routePoints, false, "centripetal");
    const samples = curve.getPoints(360);

    // A three-lane corridor: two shoulders, two lane dividers, and the road
    // boundaries follow the same spline and sample the terrain at every point.
    const offsets = [-142, -112, -37, 37, 112, 142];
    const paths = offsets.map(() => [] as XYZ[]);
    samples.forEach((point, index) => {
      const before = samples[Math.max(0, index - 1)];
      const after = samples[Math.min(samples.length - 1, index + 1)];
      const dx = after.x - before.x;
      const dz = after.z - before.z;
      const length = Math.max(0.001, Math.hypot(dx, dz));
      const normalX = -dz / length;
      const normalZ = dx / length;
      offsets.forEach((offset, pathIndex) => {
        const x = point.x + normalX * offset;
        const z = point.z + normalZ * offset;
        paths[pathIndex].push([x, terrainHeight(x, z, seed) + (pathIndex === 0 || pathIndex === 5 ? 18 : 20), z]);
      });
    });
    paths.forEach((path, pathIndex) => {
      const target = pathIndex === 1 || pathIndex === 4 ? markings : main;
      const dashed = pathIndex === 1 || pathIndex === 4;
      for (let index = 1; index < path.length; index += 1) {
        if (dashed && Math.floor(index / 7) % 2 === 1) continue;
        appendSegment(target, path[index - 1], path[index]);
      }
    });

    return { main: makeLineGeometry(main), markings: makeLineGeometry(markings) };
  }, [seed]);

  return (
    <group>
      <lineSegments geometry={roads.main} frustumCulled><lineBasicMaterial color="#69d6d0" transparent opacity={0.9} /></lineSegments>
      <lineSegments geometry={roads.markings} frustumCulled><lineBasicMaterial color="#8de3d7" transparent opacity={0.88} /></lineSegments>
    </group>
  );
}

function MonitoringOutpost({ seed, center }: { seed: number; center: WorldPoint }) {
  const geometry = useMemo(() => {
    const lines: number[] = [];
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

function CameraRig({ command, seed }: { command: CameraCommand; seed: number }) {
  const { camera, controls } = useThree();

  useEffect(() => {
    if (command.revision === 0) return;
    const target = new THREE.Vector3(0, terrainHeight(0, 0, seed) + 180, 0);
    if (command.view === "top-down") {
      camera.position.set(target.x, target.y + 12_000, target.z + 0.1);
      camera.up.set(0, 0, -1);
    } else {
      camera.position.set(target.x + 6_500, target.y + 6_500, target.z + 6_500);
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
  }, [camera, command, controls, seed]);

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
  const cameraTarget: [number, number, number] = [0, terrainHeight(0, 0, seed) + 180, 0];
  return (
    <Canvas
      camera={{ position: [cameraTarget[0] + 6_500, cameraTarget[1] + 6_500, cameraTarget[2] + 6_500], fov: 42, near: 10, far: 30_000 }}
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
      {settings.roadsVisible && <WorldRoad seed={seed} />}
      {settings.buildingsVisible && (
        <>
          <Buildings seed={seed} />
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
        maxDistance={15_000}
        maxPolarAngle={Math.PI * 0.49}
        target={cameraTarget}
      />
      <CameraRig command={cameraCommand} seed={seed} />
    </Canvas>
  );
}
