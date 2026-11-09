export function terrainHeight(x: number, z: number, seed: number): number {
  const phase = (seed % 4096) * 0.0017;
  const ridge = Math.sin(x * 0.00058 + phase) * Math.cos(z * 0.00047 - phase);
  const hills = Math.sin((x + z) * 0.00024 + phase * 1.7) * 0.58;
  const valley = Math.sin((x - z) * 0.00019 - phase * 0.8) * 0.34;

  // Leave a broad low basin around the default installation and place seeded
  // mountain masses around it, so roads and structures remain visible while
  // the terrain has a clear mountainous silhouette from the default camera.
  const basinX = 3_100 + Math.sin(phase * 0.73) * 240;
  const basinZ = 850 + Math.cos(phase * 0.91) * 240;
  let mountains = 0;
  for (let peakIndex = 0; peakIndex < 6; peakIndex += 1) {
    const angle = phase * 0.22 + peakIndex * Math.PI / 3;
    const radius = 4_000 + 260 * Math.sin(phase + peakIndex * 1.91);
    const peakX = basinX + Math.cos(angle) * radius;
    const peakZ = basinZ + Math.sin(angle) * radius;
    const width = 980 + 180 * (0.5 + 0.5 * Math.sin(phase * 1.3 + peakIndex * 2.17));
    const height = 720 + 260 * (0.5 + 0.5 * Math.cos(phase * 0.8 + peakIndex * 1.61));
    const distance = Math.hypot(x - peakX, z - peakZ);
    mountains += height * Math.exp(-0.5 * (distance / width) ** 2);
  }

  return 150 + ridge * 200 + hills * 125 + valley * 70 + mountains;
}
