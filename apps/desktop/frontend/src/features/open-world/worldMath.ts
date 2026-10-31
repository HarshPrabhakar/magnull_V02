export function terrainHeight(x: number, z: number, seed: number): number {
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
