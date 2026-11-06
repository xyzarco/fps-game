// Single source of truth for simulation constants (client & server).
export const TICK_RATE = 60;
export const TICK_MS = 1000 / TICK_RATE;
export const SNAPSHOT_RATE = 20;
export const INTERP_DELAY_MS = 100;
export const MAX_REWIND_MS = 250;
export const GRAVITY = 25; // units/s^2
export const PLAYER_HEIGHT = 1.8;
export const PLAYER_CROUCH_HEIGHT = 1.2;
export const PLAYER_RADIUS = 0.4;
export const MOVE_SPEED = 7; // units/s
export const CROUCH_SPEED = 3.5;
export const WALK_SPEED = 3;
export const JUMP_SPEED = 8.5;
export const ACCEL_GROUND = 60;
export const FRICTION_GROUND = 10;
export const ACCEL_AIR = 20;
export const RESPAWN_DELAY_MS = 3000;
export const SPAWN_PROTECT_MS = 2000;
export const MAX_HP = 100;
export const MAX_PLAYERS = 16;
// Fase 4 — match flow
export const WARMUP_MS = 10_000;
export const MATCH_TIME_MS = 600_000; // 10 menit
export const KILL_LIMIT = 25;
export const SCOREBOARD_PAUSE_MS = 8_000;
