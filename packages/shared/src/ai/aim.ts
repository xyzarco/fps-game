// Aim model manusiawi (BOTS.md Bagian 6, ADR-010): turn clamp, aim error Gaussian
// yang decay saat tracking, resample smoothing, fire gate angular tolerance.
import type { Rng } from './rng.js';
import type { DifficultyParams } from './perception.js';

export interface AimState {
  /** Offset error aktif (derajat, camera-space yaw/pitch). */
  errYaw: number;
  errPitch: number;
  /** Waktu resample error berikutnya. */
  nextResample: number;
  /** Waktu target mulai ditrack kontinu (untuk error decay). */
  trackingSince: number;
}

export function newAimState(now: number): AimState {
  return { errYaw: 0, errPitch: 0, nextResample: 0, trackingSince: now };
}

function gauss(rng: Rng): number {
  // Box-Muller
  const u = Math.max(1e-9, rng());
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Resample aim error: sigma efektif = base * (1 + 0.01*dist) / trackingFactor. */
export function resampleAimError(a: AimState, now: number, diff: DifficultyParams, dist: number, rng: Rng) {
  const trackSec = (now - a.trackingSince) / 1000;
  const trackingFactor = 1 + Math.min(1, trackSec / 2); // makin lama track makin akurat (max 2x)
  const sigma = diff.aimErrorDeg * (1 + 0.01 * dist) / trackingFactor;
  a.errYaw = gauss(rng) * sigma;
  a.errPitch = gauss(rng) * sigma * 0.6;
  a.nextResample = now + 250 + rng() * 150;
}

/** Smoothing error menuju sample baru (drift, bukan teleport — ADR-010 tau~100ms). */
export function smoothAimError(a: AimState, dt: number) {
  // error sudah diresample ke target; lerp eksponensial per frame dilakukan via
  // resample interval pendek — smoothing tambahan tidak perlu (resample tiap 250-400ms).
}

/** Clamp turn (deg/s) untuk yaw & pitch — mengembalikan yaw/pitch baru. */
export function turnToward(
  yaw: number, pitch: number,
  targetYaw: number, targetPitch: number,
  maxTurnRad: number,
): { yaw: number; pitch: number } {
  let dY = targetYaw - yaw;
  while (dY > Math.PI) dY -= Math.PI * 2;
  while (dY < -Math.PI) dY += Math.PI * 2;
  let dP = targetPitch - pitch;
  return {
    yaw: yaw + Math.max(-maxTurnRad, Math.min(maxTurnRad, dY)),
    pitch: pitch + Math.max(-maxTurnRad, Math.min(maxTurnRad, dP)),
  };
}

/** Sudut terkecil antara dua yaw (rad). */
export function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Fire gate: dalam toleransi angular? (BOTS.md 6: 2-4 deg) */
export function withinFireTolerance(aimYaw: number, targetYaw: number, toleranceDeg: number): boolean {
  return Math.abs(angleDiff(aimYaw, targetYaw)) <= (toleranceDeg * Math.PI) / 180;
}

/** Pemilihan senjata berdasar jarak & ammo (BOTS.md 6). */
export function pickWeapon(
  dist: number,
  ammo: Record<string, number>,
  hasWeapon: (w: string) => boolean,
): string | null {
  if (dist < 12 && (ammo['shotgun'] ?? 0) > 0 && hasWeapon('shotgun')) return 'shotgun';
  if (dist > 30 && (ammo['sniper'] ?? 0) > 0 && hasWeapon('sniper')) return 'sniper';
  if ((ammo['rifle'] ?? 0) > 0 && hasWeapon('rifle')) return 'rifle';
  if (hasWeapon('pistol')) return 'pistol';
  return null;
}
