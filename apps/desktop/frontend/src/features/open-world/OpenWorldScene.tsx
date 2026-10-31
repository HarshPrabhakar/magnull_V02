import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { Grid, Html, Line, OrbitControls, Sky } from "@react-three/drei";
import * as THREE from "three";

export type EnvironmentMode = "technical" | "realistic";
export type CameraCommand = {
  view: "overview" | "top-down";
  revision: number;
};

const WORLD_SIZE_METERS = 12_000;
const TERRAIN_SEGMENTS = 64;

function terrainHeight(x: number, z: number, seed: number): number {
  const phase = (seed % 4096) * 0.0017;
  const ridge = Math.sin(x * 0.00058 + phase) * Math.cos(z * 0.00047 - phase);
  const hills = Math.sin((x + z) * 0.00024 + phase * 1.7) * 0.58;
  const valley = Math.sin((x - z) * 0.00019 - phase * 0.8) * 0.34;
  const peakX = Math.sin(phase * 1.3) * 2_500;
  const peakZ = Math.cos(phase * 0.9) * 2_700;
  const peakDistance = Math.hypot(x - peakX, z - peakZ);
  const peak = Math.max(0, 1 - peakDistance / 3_600) ** 2 * 780;
  const farPeak = Math.max(0, 1 - Math.hypot(x + 3_100, z - 2_100) / 2_700) ** 2 * 520;
  return 90 + ridge * 330 + hills * 230 + valley * 125 + peak + farPeak;
}

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

function Terrain({ seed, mode }: { seed: number; mode: EnvironmentMode }) {
  const geometry = useMemo(() => createTerrainGeometry(seed), [seed]);
  const technical = mode === "technical";

  return (
    <mesh
      geometry={geometry}
      rotation={[-Math.PI / 2, 0, 0]}
      receiveShadow={false}
    >
      <meshStandardMaterial
        color={technical ? "#1b9c91" : "#ffffff"}
        vertexColors={!technical}
        wireframe={technical}
        transparent={technical}
        opacity={technical ? 0.82 : 1}
        roughness={0.94}
        metalness={technical ? 0.22 : 0}
      />
    </mesh>
  );
}

function Buildings({ seed, mode }: { seed: number; mode: EnvironmentMode }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const buildings = useMemo(() => seededPositions(seed + 91, 36, 4_800), [seed]);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const transform = new THREE.Object3D();

    buildings.forEach((building, index) => {
      const height = 35 + ((index * 29 + seed) % 95);
      transform.position.set(
        building.x,
        terrainHeight(building.x, building.z, seed) + height / 2,
        building.z,
      );
      transform.scale.set(building.scale * 82, height * 1.6, building.scale * 96);
      transform.updateMatrix();
      mesh.setMatrixAt(index, transform.matrix);
    });

    mesh.instanceMatrix.needsUpdate = true;
  }, [buildings, seed]);

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, buildings.length]}
      frustumCulled
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial
        color={mode === "technical" ? "#397b78" : "#777a75"}
        wireframe={mode === "technical"}
        roughness={0.9}
      />
    </instancedMesh>
  );
}

function Forest({ seed }: { seed: number }) {
  const trunksRef = useRef<THREE.InstancedMesh>(null);
  const crownsRef = useRef<THREE.InstancedMesh>(null);
  const trees = useMemo(() => seededPositions(seed + 307, 180, 8_000), [seed]);

  useLayoutEffect(() => {
    const trunks = trunksRef.current;
    const crowns = crownsRef.current;
    if (!trunks || !crowns) return;
    const transform = new THREE.Object3D();

    trees.forEach((tree, index) => {
      const ground = terrainHeight(tree.x, tree.z, seed);
      transform.position.set(tree.x, ground + 16 * tree.scale, tree.z);
      transform.scale.setScalar(tree.scale);
      transform.updateMatrix();
      trunks.setMatrixAt(index, transform.matrix);

      transform.position.y = ground + 43 * tree.scale;
      transform.updateMatrix();
      crowns.setMatrixAt(index, transform.matrix);
    });

    trunks.instanceMatrix.needsUpdate = true;
    crowns.instanceMatrix.needsUpdate = true;
  }, [seed, trees]);

  return (
    <>
      <instancedMesh ref={trunksRef} args={[undefined, undefined, trees.length]}>
        <cylinderGeometry args={[5, 8, 34, 5]} />
        <meshStandardMaterial color="#604d3a" roughness={1} />
      </instancedMesh>
      <instancedMesh ref={crownsRef} args={[undefined, undefined, trees.length]}>
        <coneGeometry args={[29, 70, 6]} />
        <meshStandardMaterial color="#315a43" roughness={1} />
      </instancedMesh>
    </>
  );
}

function WorldMarkers({ seed }: { seed: number }) {
  const spawn = new THREE.Vector3(-3_200, terrainHeight(-3_200, -700, seed), -700);
  const destination = new THREE.Vector3(
    3_100,
    terrainHeight(3_100, 850, seed),
    850,
  );

  return (
    <>
      <mesh position={[spawn.x, spawn.y + 45, spawn.z]}>
        <sphereGeometry args={[55, 16, 12]} />
        <meshBasicMaterial color="#ff5873" />
      </mesh>
      <Html position={[spawn.x, spawn.y + 150, spawn.z]} center distanceFactor={7_200}>
        <span className="world-marker-label spawn-label">SPAWN AREA</span>
      </Html>
      <mesh position={[destination.x, destination.y + 10, destination.z]}>
        <torusGeometry args={[115, 9, 8, 48]} />
        <meshBasicMaterial color="#ffc45b" />
      </mesh>
      <mesh position={[destination.x, destination.y + 70, destination.z]}>
        <octahedronGeometry args={[42, 0]} />
        <meshBasicMaterial color="#ffc45b" />
      </mesh>
      <Html
        position={[destination.x, destination.y + 180, destination.z]}
        center
        distanceFactor={7_200}
      >
        <span className="world-marker-label destination-label">
          SAFE ZONE-01
        </span>
      </Html>
    </>
  );
}

function WorldRoad({ seed, mode }: { seed: number; mode: EnvironmentMode }) {
  const points = useMemo(() => {
    const samples = Array.from({ length: 28 }, (_, index) => {
      const t = index / 27;
      const x = -5_300 + t * 10_600;
      const z = Math.sin(t * Math.PI * 2.2 + (seed % 100) * 0.02) * 620 + 1_400;
      return new THREE.Vector3(x, terrainHeight(x, z, seed) + 5, z);
    });
    return new THREE.CatmullRomCurve3(samples).getPoints(160);
  }, [seed]);

  return (
    <Line
      points={points}
      color={mode === "technical" ? "#245d5c" : "#514d43"}
      lineWidth={mode === "technical" ? 1 : 5}
      transparent
      opacity={mode === "technical" ? 0.8 : 0.85}
    />
  );
}

function CameraRig({ command }: { command: CameraCommand }) {
  const { camera, controls } = useThree();

  useEffect(() => {
    if (command.revision === 0) return;
    const target = new THREE.Vector3(0, 0, 0);
    if (command.view === "top-down") {
      camera.position.set(0, 9_500, 0.1);
      camera.up.set(0, 0, -1);
    } else {
      camera.position.set(4_600, 5_000, 5_400);
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
  }, [camera, command, controls]);

  return null;
}

export function OpenWorldScene({
  seed,
  mode,
  cameraCommand,
}: {
  seed: number;
  mode: EnvironmentMode;
  cameraCommand: CameraCommand;
}) {
  return (
    <Canvas
      camera={{ position: [4_600, 5_000, 5_400], fov: 42, near: 10, far: 30_000 }}
      dpr={[1, 1.5]}
      frameloop="demand"
      gl={{ antialias: true, powerPreference: "low-power", alpha: false }}
      className="open-world-canvas"
    >
      <color attach="background" args={[mode === "technical" ? "#040b12" : "#17242a"]} />
      <fog attach="fog" args={[mode === "technical" ? "#07121a" : "#9aa9a0", 6_500, 17_500]} />
      <ambientLight intensity={mode === "technical" ? 0.6 : 1.1} />
      <directionalLight position={[-3_000, 7_000, 2_000]} intensity={mode === "technical" ? 1.1 : 2.2} />
      {mode === "realistic" && <Sky sunPosition={[4_000, 5_000, -2_000]} />}

      <Terrain seed={seed} mode={mode} />
      <Grid
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
      />
      <WorldRoad seed={seed} mode={mode} />
      <Buildings seed={seed} mode={mode} />
      {mode === "realistic" && <Forest seed={seed} />}
      <WorldMarkers seed={seed} />

      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        minDistance={1_200}
        maxDistance={13_000}
        maxPolarAngle={Math.PI * 0.49}
        target={[0, 0, 0]}
      />
      <CameraRig command={cameraCommand} />
    </Canvas>
  );
}
