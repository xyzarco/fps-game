// Colyseus Schema definitions shared by client & server.
// NOTE: depends on @colyseus/schema — both apps have it installed.
import { Schema, MapSchema, schema, t } from '@colyseus/schema';
import type { WeaponId } from '../config/weapons.js';

export const PlayerClass = schema(
  {
    nickname: t.string().default('Player'),
    team: t.uint8().default(0),
    x: t.float32().default(0),   // feet
    y: t.float32().default(0),
    z: t.float32().default(0),
    yaw: t.int16().default(0),   // quantized: radians * 100
    pitch: t.int16().default(0),
    crouch: t.boolean().default(false),
    hp: t.uint8().default(100),
    weapon: t.string().default('pistol'),
    ammo: t.uint8().default(12),
    dead: t.boolean().default(false),
    lastProcessedSeq: t.uint32().default(0),
    kills: t.uint32().default(0),
    deaths: t.uint32().default(0),
  },
  'Player',
);
export type Player = Schema & {
  nickname: string; team: number; x: number; y: number; z: number;
  yaw: number; pitch: number; crouch: boolean; hp: number;
  weapon: WeaponId; ammo: number; dead: boolean;
  lastProcessedSeq: number; kills: number; deaths: number;
};

export const GameStateClass = schema(
  {
    players: t.map(PlayerClass),
    serverTick: t.uint32().default(0),
    serverTimeMs: t.uint64().default(0),
  },
  'GameState',
);
export type GameState = Schema & {
  players: MapSchema<Player>;
  serverTick: number;
  serverTimeMs: number;
};
