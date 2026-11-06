// GameHost abstraction (BOTS.md 2.2): renderer/HUD tidak peduli online vs lokal.
// NetClient (multiplayer Colyseus) dan LocalGameHost (sim in-browser) keduanya
// mengimplementasikan antarmuka duck-typed ini — game.ts mengonsumsi via tipe HostLike.
import type { InputCmd } from '@fps/shared';
import type { RemoteSnapshot } from './netclient.js';

/** Pesan server→client yang dikonsumsi Game (sama untuk host lokal & jaringan). */
export type HostEvent =
  | 'hitConfirmed' | 'damaged' | 'killFeed' | 'chat'
  | 'matchStart' | 'matchEnd' | 'ping';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type HostMessageHandler = (data: any) => void

/** Antarmuka minimal room-state yang dibaca Game (scoreboard/HUD). */
export interface HostRoomState {
  players: Map<string, {
    nickname: string; kills: number; deaths: number; team: number;
  }>;
  phase: string;
  matchEndsAt: number;
  mode: string;
  teamScoreA: number;
  teamScoreB: number;
}

/** Room shim: onMessage registry + state read-only + send no-op (untuk lokal). */
export interface HostRoom {
  onMessage(type: HostEvent, cb: HostMessageHandler): void;
  send(_type: string, _data?: unknown): void;
  readonly state: HostRoomState;
}

export interface GameHost {
  sessionId: string | null;
  room: HostRoom | null;
  latest: RemoteSnapshot | null;
  onJoinWorld: () => void;
  lastError: string | null;
  join(nickname: string, opts?: { mode?: string; roomCode?: string }): Promise<void>;
  sendInput(cmd: InputCmd): void;
  /** Interpolasi remote pemain di renderTime (lokal: langsung latest). */
  interpolate(renderTime: number): RemoteSnapshot | null;
  readonly lastProcessedSeq: number;
}
