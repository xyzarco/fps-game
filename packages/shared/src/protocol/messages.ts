// Protocol message types. Client -> Server (inputs), Server -> Client (snapshots).
import type { WeaponId } from '../config/weapons.js';

export interface InputCmd {
  seq: number;
  tick: number;
  moveX: number; // -1..1
  moveZ: number; // -1..1
  yaw: number;
  pitch: number;
  jump: boolean;
  crouch: boolean;
  walk: boolean;
  fire: boolean;
  reload: boolean;
  weaponSlot: WeaponId | null;
}

export interface PlayerState {
  id: string;
  nickname: string;
  team: number;
  x: number; y: number; z: number;
  vy: number;
  yaw: number; pitch: number;
  crouch: boolean;
  hp: number;
  weapon: WeaponId;
  ammo: number;
  dead: boolean;
  spawnProtectUntil: number;
  lastProcessedSeq: number;
}

export interface Snapshot {
  serverTick: number;
  serverTimeMs: number;
  players: PlayerState[];
  events: GameEvent[]; // shot confirmations, kills, hits
}

export type GameEvent =
  | { type: 'hit'; by: string; target: string; part: 'head' | 'body' | 'legs'; damage: number; point: [number, number, number] }
  | { type: 'kill'; by: string; target: string; weapon: WeaponId; point: [number, number, number] }
  | { type: 'shot'; by: string; origin: [number, number, number]; dir: [number, number, number]; hit: boolean }
  | { type: 'respawn'; id: string };

export const InputCmdCountPerPacket = 8; // redundancy vs packet loss
