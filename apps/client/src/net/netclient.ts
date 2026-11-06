// Colyseus client: connect, send inputs, track acks, snapshot buffer for interpolation.
import { Client, Room, getStateCallbacks } from '@colyseus/sdk';
import type { GameState, Player } from '@fps/shared';
import type { InputCmd } from '@fps/shared';

export interface RemoteSnapshot {
  serverTimeMs: number;
  serverTick: number;
  players: Map<string, { x: number; y: number; z: number; yaw: number; pitch: number; hp: number; nickname: string; dead: boolean; crouch: boolean }>;
}

export class NetClient {
  client: Client;
  room: Room<GameState> | null = null;
  sessionId: string | null = null;
  latest: RemoteSnapshot | null = null;
  /** History of remote snapshots (time-tagged) for entity interpolation. */
  history: RemoteSnapshot[] = [];
  onJoinWorld: () => void = () => {};
  lastError: string | null = null;

  constructor(url = 'ws://localhost:2567') {
    this.client = new Client(url);
  }

  async join(nickname: string): Promise<void> {
    this.room = await this.client.joinOrCreate('game', { nickname });
    const $ = getStateCallbacks(this.room);
    this.room.onMessage('welcome', (data: { sessionId: string }) => {
      this.sessionId = data.sessionId;
      this.onJoinWorld();
    });
    this.room.onError((code, msg) => { this.lastError = `${code}: ${msg}`; });
    // rebuild snapshot on any state change
    const rebuild = () => {
      const state = this.room!.state;
      const players = new Map();
      state.players.forEach((p: Player, id: string) => {
        players.set(id, {
          x: p.x, y: p.y, z: p.z,
          yaw: p.yaw / 100, pitch: p.pitch / 100,
          hp: p.hp, nickname: p.nickname, dead: p.dead, crouch: p.crouch,
        });
      });
      const snap: RemoteSnapshot = {
        serverTimeMs: Number(state.serverTimeMs),
        serverTick: state.serverTick,
        players,
      };
      this.latest = snap;
      this.history.push(snap);
      if (this.history.length > 20) this.history.shift();
    };
    $(this.room.state).players.onAdd(() => rebuild());
    $(this.room.state).players.onRemove(() => rebuild());
    $(this.room.state).players.onChange(() => rebuild());
    $(this.room.state).listen('serverTimeMs', () => rebuild());
  }

  sendInput(cmd: InputCmd) {
    this.room?.send('input', { cmd });
  }

  /** Ack for local prediction reconciliation. */
  get lastProcessedSeq(): number {
    const me = this.sessionId && this.latest?.players.get(this.sessionId);
    return me ? Number((this.room!.state.players.get(this.sessionId!) as Player | undefined)?.lastProcessedSeq ?? 0) : 0;
  }

  /** Interpolate remote players at renderTime using buffered snapshots. */
  interpolate(renderTime: number): RemoteSnapshot | null {
    const h = this.history;
    if (h.length === 0) return this.latest;
    // find two snapshots bracketing renderTime
    for (let i = h.length - 1; i > 0; i--) {
      const b = h[i]!, a = h[i - 1]!;
      if (a.serverTimeMs <= renderTime && renderTime <= b.serverTimeMs) {
        const t = (renderTime - a.serverTimeMs) / Math.max(1, b.serverTimeMs - a.serverTimeMs);
        const players = new Map();
        for (const [id, pb] of b.players) {
          const pa = a.players.get(id);
          if (!pa) { players.set(id, pb); continue; }
          players.set(id, {
            ...pb,
            x: pa.x + (pb.x - pa.x) * t,
            y: pa.y + (pb.y - pa.y) * t,
            z: pa.z + (pb.z - pa.z) * t,
            yaw: pa.yaw + (pb.yaw - pa.yaw) * t,
            pitch: pa.pitch + (pb.pitch - pa.pitch) * t,
          });
        }
        return { serverTimeMs: renderTime, serverTick: b.serverTick, players };
      }
    }
    // not bracketed yet → newest
    return h[h.length - 1] ?? this.latest;
  }
}
