// NavService (BOTS.md Bagian 3, Fase B2): bake navmesh dari GREYBOX + query path.
// Bake runtime karena cepat (~300ms) & satu sumber kebenaran dengan map (dicatat DECISIONS).
import { init, NavMeshQuery } from '@recast-navigation/core';
import { generateSoloNavMesh } from '@recast-navigation/generators';
import type { NavMesh } from '@recast-navigation/core';
import { GREYBOX } from '../config/map.js';
import type { AABB } from '../sim/movement.js';

export interface NavVec3 { x: number; y: number; z: number }

function aabbToWalkableGeometry(boxes: AABB[]) {
  const positions: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[]) =>
    positions.push(...a, ...b, ...c, ...a, ...c, ...d);
  for (const b of boxes) {
    quad([b.minX, b.maxY, b.minZ], [b.minX, b.maxY, b.maxZ], [b.maxX, b.maxY, b.maxZ], [b.maxX, b.maxY, b.minZ]);
  }
  const numVerts = positions.length / 3;
  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(Array.from({ length: numVerts }, (_, i) => i)),
  };
}

export class NavService {
  private query: NavMeshQuery | null = null;
  private navMesh: NavMesh | null = null;

  async init(): Promise<void> {
    if (this.query) return;
    await init();
    const { positions, indices } = aabbToWalkableGeometry(GREYBOX.boxes);
    const r = generateSoloNavMesh(positions, indices, {
      cs: 0.3, ch: 0.1, walkableSlopeAngle: 45, walkableHeight: 1.8,
      walkableClimb: 12, walkableRadius: 0.4, minRegionArea: 4, mergeRegionArea: 8,
    });
    if (!r.success) throw new Error(`navmesh bake gagal: ${r.error}`);
    this.navMesh = r.navMesh;
    this.query = new NavMeshQuery(r.navMesh);
  }

  private q(): NavMeshQuery {
    if (!this.query) throw new Error('NavService belum init()');
    return this.query;
  }

  /** Path antar dua titik (sudah disnap ke navmesh). Waypoint terdedup (min jarak). */
  findPath(from: NavVec3, to: NavVec3, minWaypointDist = 1.2): NavVec3[] {
    const res = this.q().computePath(from, to);
    if (!res.success || !res.path || res.path.length === 0) return [];
    const out: NavVec3[] = [];
    for (const p of res.path) {
      const last = out[out.length - 1];
      if (!last || Math.hypot(p.x - last.x, p.z - last.z) >= minWaypointDist) {
        out.push({ x: p.x, y: p.y, z: p.z });
      }
    }
    return out;
  }

  /** Titik acak di navmesh — ground-level saja (y rendah); platform sengaja tak untuk bot. */
  randomPoint(): NavVec3 | null {
    for (let i = 0; i < 8; i++) {
      const r = this.q().findRandomPoint();
      if (r.success && r.randomPoint && r.randomPoint.y < 0.5) return { ...r.randomPoint };
    }
    return null;
  }

  /** Titik acak dalam radius (untuk roam berbobot — B2 sederhana: seluruh navmesh). */
  randomPointAround(center: NavVec3, radius: number): NavVec3 | null {
    const r = this.q().findRandomPointAroundCircle(center, radius);
    return r.success && r.randomPoint ? { ...r.randomPoint } : null;
  }

  nearestPoint(pos: NavVec3): NavVec3 | null {
    const r = this.q().findNearestPoly(pos, { halfExtents: { x: 2, y: 4, z: 2 } });
    return r.success && r.nearestPoint ? { ...r.nearestPoint } : null;
  }
}
