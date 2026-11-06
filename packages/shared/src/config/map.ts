// Greybox arena: AABB solids shared by client (render) & server (collision).
import type { AABB } from '../sim/movement.js';

export interface MapData { name: string; boxes: AABB[]; spawns: [number, number, number][] }

export const GREYBOX: MapData = {
  name: 'greybox',
  boxes: [
    // floor
    { minX: -40, minY: -1, minZ: -40, maxX: 40, maxY: 0, maxZ: 40 },
    // outer walls
    { minX: -40, minY: 0, minZ: -40, maxX: 40, maxY: 6, maxZ: -39 },
    { minX: -40, minY: 0, minZ: 39, maxX: 40, maxY: 6, maxZ: 40 },
    { minX: -40, minY: 0, minZ: -40, maxX: -39, maxY: 6, maxZ: 40 },
    { minX: 39, minY: 0, minZ: -40, maxX: 40, maxY: 6, maxZ: 40 },
    // central cover blocks & platforms
    { minX: -6, minY: 0, minZ: -6, maxX: 6, maxY: 2, maxZ: 6 },
    { minX: -14, minY: 0, minZ: 10, maxX: -10, maxY: 1.5, maxZ: 18 },
    { minX: 10, minY: 0, minZ: 10, maxX: 14, maxY: 1.5, maxZ: 18 },
    { minX: -14, minY: 0, minZ: -18, maxX: -10, maxY: 1.5, maxZ: -10 },
    { minX: 10, minY: 0, minZ: -18, maxX: 14, maxY: 1.5, maxZ: -10 },
    // raised platform + ramp-ish steps
    { minX: -20, minY: 0, minZ: -20, maxX: -12, maxY: 2, maxZ: -12 },
    { minX: -12, minY: 0, minZ: -20, maxX: -8, maxY: 1, maxZ: -14 },
    { minX: -8, minY: 0, minZ: -20, maxX: -4, maxY: 0.5, maxZ: -14 },
    // pillars
    { minX: -2, minY: 0, minZ: 20, maxX: 2, maxY: 4, maxZ: 22 },
    { minX: 18, minY: 0, minZ: -2, maxX: 20, maxY: 4, maxZ: 2 },
    { minX: -20, minY: 0, minZ: -2, maxX: -18, maxY: 4, maxZ: 2 },
  ],
  spawns: [
    [0, 0, -30], [0, 0, 30], [-30, 0, 0], [30, 0, 0],
    [-25, 0, -25], [25, 0, -25], [-25, 0, 25], [25, 0, 25],
  ],
};
