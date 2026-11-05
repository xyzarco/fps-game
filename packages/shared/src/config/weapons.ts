export type WeaponId = 'pistol' | 'rifle' | 'shotgun' | 'sniper';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  type: 'hitscan';
  damage: number;
  headMultiplier: number;
  pellets: number;
  fireIntervalMs: number;
  auto: boolean;
  magSize: number;
  reserveAmmo: number; // -1 = unlimited
  reloadMs: number;
  spread: number; // radians at max
  range: number;
  falloffStart: number;
  falloffEnd: number;
  falloffMinDamage: number;
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  pistol: {
    id: 'pistol', name: 'Pistol', type: 'hitscan',
    damage: 20, headMultiplier: 2, pellets: 1,
    fireIntervalMs: 250, auto: false,
    magSize: 12, reserveAmmo: -1, reloadMs: 1200,
    spread: 0.01, range: 100, falloffStart: 40, falloffEnd: 80, falloffMinDamage: 10,
  },
  rifle: {
    id: 'rifle', name: 'Assault Rifle', type: 'hitscan',
    damage: 14, headMultiplier: 1.8, pellets: 1,
    fireIntervalMs: 90, auto: true,
    magSize: 30, reserveAmmo: 120, reloadMs: 1800,
    spread: 0.025, range: 120, falloffStart: 35, falloffEnd: 90, falloffMinDamage: 6,
  },
  shotgun: {
    id: 'shotgun', name: 'Shotgun', type: 'hitscan',
    damage: 8, headMultiplier: 1.5, pellets: 10,
    fireIntervalMs: 1000, auto: false,
    magSize: 6, reserveAmmo: 32, reloadMs: 2400,
    spread: 0.06, range: 30, falloffStart: 8, falloffEnd: 25, falloffMinDamage: 2,
  },
  sniper: {
    id: 'sniper', name: 'Sniper', type: 'hitscan',
    damage: 90, headMultiplier: 1.5, pellets: 1,
    fireIntervalMs: 1500, auto: false,
    magSize: 5, reserveAmmo: 20, reloadMs: 2600,
    spread: 0.001, range: 200, falloffStart: 100, falloffEnd: 200, falloffMinDamage: 90,
  },
};
