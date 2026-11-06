// Raycast vs AABB set (slab method). Returns nearest hit with distance & normal.
import type { AABB } from './movement.js';

export interface RayHit {
  t: number;                       // distance along ray
  point: [number, number, number];
  normal: [number, number, number];
}

const EPS = 1e-6;

/** Nearest hit of ray (origin, dir normalized) against boxes within maxT. Null if none. */
export function raycastBoxes(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  boxes: AABB[],
  maxT = Infinity,
): RayHit | null {
  let best: RayHit | null = null;
  let bestT = maxT;
  for (const b of boxes) {
    let tmin = -Infinity, tmax = Infinity;
    let nAxis = -1, nSign = 0;
    // x
    if (Math.abs(dx) < EPS) { if (ox < b.minX || ox > b.maxX) continue; }
    else {
      let t1 = (b.minX - ox) / dx, t2 = (b.maxX - ox) / dx;
      let s = -1; if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = 1; }
      if (t1 > tmin) { tmin = t1; nAxis = 0; nSign = s; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) continue;
    }
    // y
    if (Math.abs(dy) < EPS) { if (oy < b.minY || oy > b.maxY) continue; }
    else {
      let t1 = (b.minY - oy) / dy, t2 = (b.maxY - oy) / dy;
      let s = -1; if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = 1; }
      if (t1 > tmin) { tmin = t1; nAxis = 1; nSign = s; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) continue;
    }
    // z
    if (Math.abs(dz) < EPS) { if (oz < b.minZ || oz > b.maxZ) continue; }
    else {
      let t1 = (b.minZ - oz) / dz, t2 = (b.maxZ - oz) / dz;
      let s = -1; if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = 1; }
      if (t1 > tmin) { tmin = t1; nAxis = 2; nSign = s; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) continue;
    }
    if (tmin < 0 || tmin >= bestT) continue;
    bestT = tmin;
    const n: [number, number, number] = [0, 0, 0];
    if (nAxis >= 0) n[nAxis] = nSign;
    best = { t: tmin, point: [ox + dx * tmin, oy + dy * tmin, oz + dz * tmin], normal: n };
  }
  return best;
}
