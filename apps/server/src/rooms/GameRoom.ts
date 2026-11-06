// Authoritative GameRoom (Colyseus 0.18): fixed-timestep sim via shared sim, state sync via schema.
import { Room, Client } from 'colyseus';
import { GameStateClass, GameState, PlayerClass, Player } from './GameState.js';
import {
  TICK_RATE, TICK_MS, SNAPSHOT_RATE, MAX_PLAYERS, MAX_HP, RESPAWN_DELAY_MS, SPAWN_PROTECT_MS,
  stepMovement, newPlayerSimState, GREYBOX, WEAPONS,
  type InputCmd, type AABB, type WeaponId,
} from '@fps/shared';

interface PlayerEntity {
  player: Player;
  sim: ReturnType<typeof newPlayerSimState>;
  cmds: InputCmd[];
  hp: number;
  deadUntil: number;
  spawnProtectUntil: number;
  reloadUntil: number;
  ammo: number;
  reserve: number;
  weapon: WeaponId;
}

const world: AABB[] = GREYBOX.boxes;

export class GameRoom extends Room<any> {
  declare state: GameState;
  override maxClients = MAX_PLAYERS;
  entities = new Map<string, PlayerEntity>();

  override onCreate() {
    this.setState(new GameStateClass() as unknown as GameState);
    this.setPatchRate(1000 / SNAPSHOT_RATE);
    this.setSimulationInterval(() => this.step(), TICK_RATE);
    this.onMessage('input', (client: Client, data: { cmd: InputCmd }) => {
      const e = this.entities.get(client.sessionId);
      if (!e || typeof data?.cmd?.seq !== 'number') return;
      if (data.cmd.seq <= e.player.lastProcessedSeq) return; // duplicate/replay guard
      e.cmds.push(data.cmd);
      if (e.cmds.length > 120) e.cmds.splice(0, e.cmds.length - 120);
    });
    console.log('[GameRoom] created');
  }

  override onJoin(client: Client, options: { nickname?: string } = {}) {
    const nick = String(options?.nickname ?? 'Player').slice(0, 16).replace(/[<>]/g, '');
    const spawn = GREYBOX.spawns[this.entities.size % GREYBOX.spawns.length] as [number, number, number];
    const p = new PlayerClass() as Player;
    p.nickname = nick;
    p.x = spawn[0]; p.y = spawn[1]; p.z = spawn[2];
    this.state.players.set(client.sessionId, p);
    this.entities.set(client.sessionId, {
      player: p,
      sim: newPlayerSimState(spawn[0], spawn[1], spawn[2]),
      cmds: [], hp: MAX_HP, deadUntil: 0, spawnProtectUntil: Date.now() + SPAWN_PROTECT_MS,
      reloadUntil: 0, ammo: WEAPONS.pistol.magSize, reserve: -1, weapon: 'pistol',
    });
    client.send('welcome', { sessionId: client.sessionId });
    console.log(`[GameRoom] ${client.sessionId} (${nick}) joined`);
  }

  override onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
    this.entities.delete(client.sessionId);
    console.log(`[GameRoom] ${client.sessionId} left`);
  }

  private step() {
    const dt = TICK_MS / 1000;
    const now = Date.now();
    this.state.serverTick++;
    this.state.serverTimeMs = now;

    for (const e of this.entities.values()) {
      if (e.deadUntil > 0) {
        if (now >= e.deadUntil) this.respawn(e);
        else continue;
      }
      const cmd = e.cmds.shift();
      if (!cmd) continue;
      // authoritative sim (shared code with client prediction)
      stepMovement(e.sim, cmd, world, dt);
      e.player.lastProcessedSeq = cmd.seq;
      e.player.x = e.sim.x; e.player.y = e.sim.y; e.player.z = e.sim.z;
      e.player.yaw = Math.round(e.sim.yaw * 100);
      e.player.pitch = Math.round(e.sim.pitch * 100);
      e.player.crouch = e.sim.crouch;

      // weapon bookkeeping (authoritative timing)
      e.player.weapon = e.weapon;
      e.player.ammo = e.ammo;
      if (cmd.reload && e.ammo < WEAPONS[e.weapon].magSize && now >= e.reloadUntil) {
        e.reloadUntil = now + WEAPONS[e.weapon].reloadMs;
      }
      if (e.reloadUntil !== 0 && now >= e.reloadUntil && e.ammo < WEAPONS[e.weapon].magSize) {
        const need = WEAPONS[e.weapon].magSize - e.ammo;
        const take = e.reserve === -1 ? need : Math.min(need, e.reserve);
        e.ammo += take;
        if (e.reserve !== -1) e.reserve -= take;
        e.reloadUntil = 0;
      }
      // TODO (Fase 3): authoritative hitscan + lag compensation
    }
  }

  private respawn(e: PlayerEntity) {
    const spawn = GREYBOX.spawns[Math.floor(Math.random() * GREYBOX.spawns.length)] as [number, number, number];
    const s = newPlayerSimState(spawn[0], spawn[1], spawn[2]);
    e.sim = s;
    e.hp = MAX_HP;
    e.deadUntil = 0;
    e.spawnProtectUntil = Date.now() + SPAWN_PROTECT_MS;
    e.ammo = WEAPONS[e.weapon].magSize;
    e.player.hp = MAX_HP;
    e.player.dead = false;
    e.player.x = s.x; e.player.y = s.y; e.player.z = s.z;
  }
}
