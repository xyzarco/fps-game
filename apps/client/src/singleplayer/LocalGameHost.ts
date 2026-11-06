// LocalGameHost (BOTS.md 2.2, Fase B1): logika room otoritatif di dalam browser,
// TANPA Colyseus/WebSocket. Memakai shared sim yang sama dengan server:
// stepMovement, fireWeapon, damage/respawn/score/match flow identik GameRoom.
// Bot input dihasilkan BotManager → PlayerInput yang sama dengan pemain manusia.
import {
  TICK_MS, MAX_HP, RESPAWN_DELAY_MS, SPAWN_PROTECT_MS,
  WARMUP_MS, MATCH_TIME_MS, KILL_LIMIT, SCOREBOARD_PAUSE_MS,
  stepMovement, newPlayerSimState, GREYBOX, WEAPONS, fireWeapon,
  type InputCmd, type AABB, type WeaponId,
} from '@fps/shared';
import type { GameHost, HostRoom, HostEvent, HostMessageHandler, HostRoomState } from '../net/host.js';
import type { RemoteSnapshot } from '../net/netclient.js';
import { BotManager } from './BotManager.js';
import { BotBrain } from '@fps/shared';

interface LocalEntity {
  id: string;
  nickname: string;
  team: number;
  isBot: boolean;
  sim: ReturnType<typeof newPlayerSimState>;
  cmds: InputCmd[];
  hp: number;
  deadUntil: number;
  spawnProtectUntil: number;
  reloadUntil: number;
  ammo: number;
  reserve: number;
  weapon: WeaponId;
  lastFireAt: number;
  kills: number;
  deaths: number;
  lastProcessedSeq: number;
}

/** Sederhana tapi sesuai semantik GameRoom; scoreboard/HUD membaca ini. */
class LocalRoomState implements HostRoomState {
  players = new Map<string, { nickname: string; kills: number; deaths: number; team: number }>();
  phase = 'warmup';
  phaseEndsAt = 0;
  matchEndsAt = 0;
  mode = 'ffa';
  teamScoreA = 0;
  teamScoreB = 0;
}

export class LocalRoom implements HostRoom {
  handlers = new Map<HostEvent, HostMessageHandler[]>();
  readonly state = new LocalRoomState();
  onMessage(type: HostEvent, cb: HostMessageHandler): void {
    const list = this.handlers.get(type) ?? [];
    list.push(cb);
    this.handlers.set(type, list);
  }
  send(_type: string, _data?: unknown): void { /* lokal: client→server pesan (chat) diabaikan di B1 */ }
  emit(type: HostEvent, data: unknown): void {
    for (const cb of this.handlers.get(type) ?? []) cb(data);
  }
}

const sanitize = (raw: string) => raw.trim().slice(0, 16).replace(/[<>&"']/g, '') || 'Player';

export class LocalGameHost implements GameHost {
  sessionId: string | null = null;
  room: LocalRoom | null = null;
  latest: RemoteSnapshot | null = null;
  onJoinWorld: () => void = () => {};
  lastError: string | null = null;

  private entities = new Map<string, LocalEntity>();
  private running = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private seq = 0;
  private warmupTimer: ReturnType<typeof setTimeout> | null = null;
  bots: BotManager | null = null;

  /** Mulai match lokal: pemain + bot dummy, warmup → live → ended (siklus). */
  async join(nickname: string, opts: { mode?: string; botCount?: number; botDifficulty?: string } = {}) {
    const room = new LocalRoom();
    this.room = room;
    room.state.mode = opts.mode === 'tdm' ? 'tdm' : 'ffa';
    this.sessionId = 'local_player';
    this.addEntity('local_player', sanitize(nickname), false, this.pickTeam(0));
    this.startWarmup();

    // bot dummy (B1): berdiri/berjalan acak, bisa ditembak, mati, respawn
    this.bots = new BotManager(this, room, opts.botCount ?? 7, (opts.mode === 'tdm' ? 'tdm' : 'ffa'), (opts.botDifficulty ?? 'normal') as 'easy' | 'normal' | 'hard' | 'insane');
    for (const _b of this.bots.bots.values()) {
      // bot ditambahkan sebagai entity + state
    }
    this.latest = this.snapshot();

    this.running = true;
    this.timer = setInterval(() => this.step(), TICK_MS);
    this.onJoinWorld();
  }

  dispose() {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    if (this.warmupTimer) clearTimeout(this.warmupTimer);
    this.bots?.dispose();
    this.entities.clear();
    this.room = null;
    this.latest = null;
  }

  sendInput(cmd: InputCmd) {
    const e = this.entities.get('local_player');
    if (!e || this.room!.state.phase === 'ended') return;
    if (typeof cmd.seq !== 'number' || cmd.seq <= e.lastProcessedSeq) return;
    e.cmds.push(cmd);
    if (e.cmds.length > 240) e.cmds.splice(0, e.cmds.length - 240);
  }

  get lastProcessedSeq(): number {
    return this.entities.get('local_player')?.lastProcessedSeq ?? 0;
  }

  /** Lokal: tidak ada latensi → snapshot terkini langsung (interpolasi opsional). */
  interpolate(_renderTime: number): RemoteSnapshot | null {
    this.latest = this.snapshot();
    return this.latest;
  }

  // ---------- entity & team ----------

  addEntity(id: string, nickname: string, isBot: boolean, team: number): LocalEntity {
    const spawn = GREYBOX.spawns[this.entities.size % GREYBOX.spawns.length] as [number, number, number];
    const p = newPlayerSimState(spawn[0], spawn[1], spawn[2]);
    const e: LocalEntity = {
      id, nickname, team, isBot,
      sim: p, cmds: [], hp: MAX_HP, deadUntil: 0,
      spawnProtectUntil: Date.now() + SPAWN_PROTECT_MS,
      reloadUntil: 0, ammo: WEAPONS.pistol.magSize, reserve: -1,
      weapon: 'pistol', lastFireAt: 0, kills: 0, deaths: 0, lastProcessedSeq: 0,
    };
    this.entities.set(id, e);
    this.room!.state.players.set(id, { nickname, kills: 0, deaths: 0, team });
    return e;
  }

  removeEntity(id: string) {
    this.entities.delete(id);
    this.room!.state.players.delete(id);
  }

  entity(id: string): LocalEntity | undefined { return this.entities.get(id); }
  entitiesAll(): Iterable<[string, LocalEntity]> { return this.entities.entries(); }

  private pickTeam(seedTeam: number): number {
    if (this.room!.state.mode !== 'tdm') return 0;
    let a = 0, b = 0;
    for (const p of this.room!.state.players.values()) p.team === 0 ? a++ : b++;
    if (seedTeam === 0) return a <= b ? 0 : 1;
    // bot: tim berlawanan/pendamping diatur BotManager
    return 1;
  }

  // ---------- match flow (identik GameRoom) ----------

  private startWarmup() {
    const s = this.room!.state;
    s.phase = 'warmup';
    s.phaseEndsAt = Date.now() + WARMUP_MS;
    this.warmupTimer = setTimeout(() => this.startMatch(), WARMUP_MS);
  }

  private startMatch() {
    const s = this.room!.state;
    if (s.phase === 'live') return;
    s.teamScoreA = 0; s.teamScoreB = 0;
    for (const p of s.players.values()) { p.kills = 0; p.deaths = 0; }
    for (const e of this.entities.values()) {
      e.hp = MAX_HP; e.deadUntil = 0;
      this.respawn(e);
    }
    s.phase = 'live';
    s.matchEndsAt = Date.now() + MATCH_TIME_MS;
    this.room!.emit('matchStart', { endsAt: s.matchEndsAt, mode: s.mode });
  }

  private endMatch() {
    const s = this.room!.state;
    if (s.phase !== 'live') return;
    s.phase = 'ended';
    s.phaseEndsAt = Date.now() + SCOREBOARD_PAUSE_MS;
    const scores = [...s.players.entries()]
      .map(([id, p]) => ({ id, name: p.nickname, kills: p.kills, deaths: p.deaths, team: p.team }))
      .sort((a, b) => b.kills - a.kills);
    const winner = s.mode === 'tdm'
      ? (s.teamScoreA >= s.teamScoreB ? 'Team A' : 'Team B')
      : (scores[0]?.name ?? '-');
    this.room!.emit('matchEnd', { winner, scores, teamA: s.teamScoreA, teamB: s.teamScoreB, t: Date.now() });
    setTimeout(() => { this.startWarmup(); this.startMatch(); }, SCOREBOARD_PAUSE_MS);
  }

  private checkMatchEnd() {
    const s = this.room!.state;
    if (s.phase !== 'live') return;
    const timeUp = Date.now() >= s.matchEndsAt;
    let limitHit = false;
    if (s.mode === 'tdm') {
      limitHit = s.teamScoreA >= KILL_LIMIT || s.teamScoreB >= KILL_LIMIT;
    } else {
      for (const p of s.players.values()) if (p.kills >= KILL_LIMIT) limitHit = true;
    }
    if (timeUp || limitHit) this.endMatch();
  }

  // ---------- simulation (pola sama dengan GameRoom.step) ----------

  private step() {
    if (!this.running || !this.room) return;
    const dt = TICK_MS / 1000;
    const now = Date.now();
    const world: AABB[] = GREYBOX.boxes;
    const s = this.room.state;

    // bot pikirkan & kirim input
    this.bots?.tick(now, dt);

    this.checkMatchEnd();
    if (s.phase === 'ended') {
      for (const e of this.entities.values()) e.cmds.length = 0;
      return;
    }

    for (const e of this.entities.values()) {
      if (e.deadUntil > 0 && now >= e.deadUntil) this.respawn(e);
    }

    for (const e of this.entities.values()) {
      if (e.deadUntil > 0) continue;
      const cmd = e.cmds.shift();
      if (!cmd) continue;
      stepMovement(e.sim, cmd, world, dt);
      e.lastProcessedSeq = cmd.seq;
      e.weapon = cmd.weaponSlot ?? e.weapon;
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
      if (cmd.fire && e.ammo > 0 && now >= e.lastFireAt + WEAPONS[e.weapon].fireIntervalMs && e.reloadUntil === 0) {
        this.handleFire(e, cmd, now);
      }
    }

    // snapshot setiap step (60Hz in-memory — murah, tanpa serialisasi jaringan)
    this.latest = this.snapshot();
  }

  /** Hitscan lokal — logika sama GameRoom.handleFire minus lag comp (latensi 0). */
  private handleFire(shooter: LocalEntity, cmd: InputCmd, now: number) {
    const w = WEAPONS[shooter.weapon];
    shooter.lastFireAt = now;
    shooter.ammo--;
    // BOTS.md 4.2: tembakan = suara radius besar (bot dengar via SoundBus)
    BotBrain.soundBus.emit(shooter.sim.x, shooter.sim.y, shooter.sim.z, 45, now);

    const targets: { x: number; y: number; z: number; height: number; id: string }[] = [];
    for (const [id, e] of this.entities) {
      if (id === shooter.id || e.deadUntil > 0 || now < e.spawnProtectUntil) continue;
      if (this.room!.state.mode === 'tdm' && e.team === shooter.team) continue;
      targets.push({ x: e.sim.x, y: e.sim.y, z: e.sim.z, height: e.sim.height, id });
    }

    const origin: [number, number, number] = [shooter.sim.x, shooter.sim.y + shooter.sim.height - 0.2, shooter.sim.z];
    const dir: [number, number, number] = [
      -Math.sin(cmd.yaw) * Math.cos(cmd.pitch),
      Math.sin(cmd.pitch),
      -Math.cos(cmd.yaw) * Math.cos(cmd.pitch),
    ];

    const results: { id: string; damage: number; point: [number, number, number] }[] = [];
    const targetBodies = targets.map((t) => ({ x: t.x, y: t.y, z: t.z, height: t.height }));

    for (let pellet = 0; pellet < w.pellets; pellet++) {
      const sp = pellet === 0 ? 0 : (Math.random() - 0.5) * 2 * w.spread;
      const spv = pellet === 0 ? 0 : (Math.random() - 0.5) * 2 * w.spread;
      const d: [number, number, number] = [dir[0] + spv, dir[1] + sp, dir[2]];
      const l = Math.hypot(d[0], d[1], d[2]) || 1;
      d[0] /= l; d[1] /= l; d[2] /= l;

      const res = fireWeapon(origin, d, shooter.weapon, GREYBOX.boxes, targetBodies, (p) => {
        const i = targetBodies.indexOf(p);
        const t = targets[i];
        return t ? Math.hypot(t.x - origin[0], t.z - origin[2]) : Infinity;
      });
      if (res.hitPlayer && res.hitPoint) {
        const i = targetBodies.findIndex((p) =>
          Math.abs(p.x - res.hitPoint![0]) + Math.abs(p.z - res.hitPoint![2]) < 0.9,
        );
        if (i >= 0) results.push({ id: targets[i]!.id, damage: res.damage, point: res.hitPoint });
      }
    }

    const dmgById = new Map<string, number>();
    for (const r of results) dmgById.set(r.id, (dmgById.get(r.id) ?? 0) + r.damage);
    for (const [id, dmg] of dmgById) {
      const victim = this.entities.get(id);
      if (!victim || victim.deadUntil > 0 || now < victim.spawnProtectUntil) continue;
      victim.hp = Math.max(0, victim.hp - dmg);
      this.room!.emit('hitConfirmed', { target: id, damage: dmg });
      if (id === 'local_player') this.room!.emit('damaged', { by: shooter.id, amount: dmg });
      if (victim.hp === 0) this.kill(shooter.id, id, shooter.weapon);
    }
  }

  private kill(killerId: string, victimId: string, weapon: WeaponId) {
    const s = this.room!.state;
    const killer = s.players.get(killerId);
    const victimE = this.entities.get(victimId);
    const victim = s.players.get(victimId);
    if (!victim || !victimE) return;
    victimE.deadUntil = Date.now() + RESPAWN_DELAY_MS;
    victimE.deaths++;
    victim.deaths++;
    if (killer && killerId !== victimId) {
      killer.kills++;
      if (s.mode === 'tdm') {
        if (killer.team === 0) s.teamScoreA++;
        else s.teamScoreB++;
      }
    }
    this.room!.emit('killFeed', {
      killer: killer?.nickname ?? victim.nickname,
      victim: victim.nickname,
      weapon,
      headshot: false,
      t: Date.now(),
    });
  }

  respawn(e: LocalEntity) {
    const spawn = GREYBOX.spawns[Math.floor(Math.random() * GREYBOX.spawns.length)] as [number, number, number];
    e.sim = newPlayerSimState(spawn[0], spawn[1], spawn[2]);
    e.hp = MAX_HP;
    e.deadUntil = 0;
    e.spawnProtectUntil = Date.now() + SPAWN_PROTECT_MS;
    e.ammo = WEAPONS[e.weapon].magSize;
    e.cmds.length = 0;
    e.lastProcessedSeq = 0; // bot baru boleh input lagi
  }

  private snapshot(): RemoteSnapshot {
    const s = this.room!.state;
    const players = new Map();
    for (const [id, e] of this.entities) {
      players.set(id, {
        x: e.sim.x, y: e.sim.y, z: e.sim.z,
        yaw: e.sim.yaw, pitch: e.sim.pitch,
        hp: e.hp, nickname: e.nickname, dead: e.deadUntil > 0, crouch: e.sim.crouch,
      });
    }
    return { serverTimeMs: Date.now(), serverTick: 0, players };
  }
}
