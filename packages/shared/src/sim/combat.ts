// Shared weapon fire logic (used by client prediction & server authority).
import { WEAPONS, type WeaponId } from '../config/weapons.js';
import { raycastBoxes } from './raycast.js';
import type { AABB } from './movement.js';

export interface CapsuleLike { x: number; y: number; z: number; height: number } // feet pos

/** Ray vs vertical AABB approximating a player hitbox. Returns damage zone + hit t. */
export function raycastPlayer(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  p: CapsuleLike, radius = 0.4,
  maxT = Infinity,
): { t: number; part: 'head' | 'body' | 'legs' } | null {
  const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
  const b = {
    minX: p.x - radius, maxX: p.x + radius,
    minY: p.y, maxY: p.y + p.height,
    minZ: p.z - radius, maxZ: p.z + radius,
  } as AABB;
  const hit = raycastBoxes(ox, oy, oz, dx, dy, dz, [b], maxT);
  if (!hit) return null;
  const relY = hit.point[1] - p.y;
  const headTop = p.height;
  const bodyStart = p.height * 0.55;
  const part = relY > bodyStart ? (relY > headTop - 0.2 ? 'head' : 'body') : 'legs';
  return { t: hit.t, part };
}

export interface FireResult {
  hitPoint: [number, number, number] | null;
  impactPoint: [number, number, number] | null;
  hitPlayer: { part: 'head' | 'body' | 'legs' } | null;
  damage: number;
}

export function fireWeapon(
  origin: [number, number, number],
  dir: [number, number, number], // normalized
  weapon: WeaponId,
  world: AABB[],
  players: CapsuleLike[], // all other alive players
  distToPlayer: (p: CapsuleLike) => number, // for falloff
): FireResult {
  const w = WEAPONS[weapon];
  let closest: FireResult | null = null;
  let playerHitT = Infinity;
  // world hit
  const wHit = raycastBoxes(origin[0], origin[1], origin[2], dir[0], dir[1], dir[2], world, w.range);
  const wallT = wHit ? wHit.t : Infinity;

  // player hits (nearest)
  for (const p of players) {
    const ph = raycastPlayer(origin[0], origin[1], origin[2], dir[0], dir[1], dir[2], p, 0.4, Math.min(wallT, w.range));
    if (ph && ph.t < playerHitT) {
      playerHitT = ph.t;
      const d = distToPlayer(p);
      let dmg = w.damage * (ph.part === 'head' ? w.headMultiplier : 1);
      if (d > w.falloffEnd) dmg *= w.falloffMinDamage / w.damage;
      else if (d > w.falloffStart) {
        const k = (d - w.falloffStart) / (w.falloffEnd - w.falloffStart);
        dmg *= 1 - k * (1 - w.falloffMinDamage / w.damage);
      }
      closest = {
        hitPoint: [origin[0] + dir[0] * ph.t, origin[1] + dir[1] * ph.t, origin[2] + dir[2] * ph.t],
        impactPoint: null,
        hitPlayer: { part: ph.part },
        damage: Math.round(dmg),
      };
    }
  }
  if (closest) return closest;
  // wall impact
  if (wHit) {
    return {
      hitPoint: null,
      impactPoint: wHit.point,
      hitPlayer: null,
      damage: 0,
    };
  }
  // range miss — tracer end
  const endT = w.range;
  return { hitPoint: null, impactPoint: [origin[0] + dir[0] * endT, origin[1] + dir[1] * endT, origin[2] + dir[2] * endT], hitPlayer: null, damage: 0 };
}
