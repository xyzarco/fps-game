
import { describe, it, expect } from 'vitest';
import { init, NavMeshQuery } from '@recast-navigation/core';
import { generateSoloNavMesh } from '@recast-navigation/generators';
import { GREYBOX } from '../src/config/map.js';

// B0: bake navmesh dari greybox harus sukses & query path dasar jalan (ground-level)
async function bake() {
  await init();
  const positions: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[]) =>
    positions.push(...a, ...b, ...c, ...a, ...c, ...d);
  for (const b of GREYBOX.boxes) {
    quad([b.minX, b.maxY, b.minZ], [b.minX, b.maxY, b.maxZ], [b.maxX, b.maxY, b.maxZ], [b.maxX, b.maxY, b.minZ]);
  }
  const numVerts = positions.length / 3;
  return generateSoloNavMesh(new Float32Array(positions), new Uint32Array(Array.from({ length: numVerts }, (_, i) => i)), {
    cs: 0.3, ch: 0.1, walkableSlopeAngle: 45, walkableHeight: 1.8, walkableClimb: 12, walkableRadius: 0.4,
    minRegionArea: 4, mergeRegionArea: 8,
  });
}

describe('navmesh bake (Fase B0)', () => {
  it('bake sukses & path antar spawn ditemukan', async () => {
    const r = await bake();
    expect(r.success).toBe(true);
    const q = new NavMeshQuery(r.navMesh!);
    const p = q.computePath({ x: -30, y: 0, z: 0 }, { x: 30, y: 0, z: 0 });
    expect(p.success).toBe(true);
    expect(p.path!.length).toBeGreaterThanOrEqual(2);
    const rp = q.findRandomPoint();
    expect(rp.success).toBe(true);
    const half = 40;
    expect(Math.abs(rp.randomPoint.x)).toBeLessThanOrEqual(half);
    expect(Math.abs(rp.randomPoint.z)).toBeLessThanOrEqual(half);
  }, 30000);
});
