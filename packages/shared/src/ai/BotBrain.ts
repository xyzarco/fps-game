// BotBrain (BOTS.md 2.1): think(worldView, dt) → PlayerInput.
// Fase B2: state Roam — path following via navmesh, stuck detection, separation.
// PRNG ber-seed (ADR-008) agar perilaku reproducible.
import {
  newPlayerSimState, GREYBOX,
  type InputCmd, type PlayerSimState, type AABB,
} from '../index.js';
import { mulberry32, type Rng } from './rng.js';
import { NavService, type NavVec3 } from './navigation.js';
import { Perception, DIFFICULTY, SoundBus, type PerceptTarget, type DifficultyParams } from './perception.js';
import { newAimState, resampleAimError, turnToward, withinFireTolerance, type AimState } from './aim.js';

export interface BotWorldView {
  /** Posisi semua pemain lain (untuk separation & nanti persepsi B3). */
  others: { id: string; x: number; y: number; z: number; height?: number; dead?: boolean; crouch?: boolean }[];
  /** Suara fresh tick ini (tembakan, langkah) dari SoundBus.drain(). */
  sounds?: { x: number; y: number; z: number; radius: number; t: number }[];
  /** BOTS.md 5.3: id rekan satu tim — tidak jadi target persepsi/combat (TDM). */
  allies?: Set<string>;
}

export interface BotState {
  id: string;
  sim: PlayerSimState;
  path: NavVec3[];
  pathIdx: number;
  replanAt: number;
  goal: NavVec3 | null;
  /** Stuck detection (BOTS.md 3.4). */
  lastX: number; lastZ: number; stuckSince: number;
  strafeSign: number;
  /** Recovery mode: >0 = mundur/strafe dulu sebelum path lagi (BOTS.md 3.4). */
  recoverUntil: number;
  recoverMX: number;
  recoverMZ: number;
  /** B3: state machine — roam | investigate | search | combat | retreat (BOTS.md 5.1). */
  state: 'roam' | 'investigate' | 'search' | 'combat' | 'retreat';
  stateUntil: number;
  /** Combat: strafe arah & interval (BOTS.md 6: strafe kiri-kanan berinterval). */
  strafeDir: number;
  strafeUntil: number;
  /** HP terakhir (untuk retreat saat HP rendah). */
  hp: number;
  /** Ammo per senjata (diset host via reportAmmo). */
  ammo: Record<string, number>;
  fireCooldownUntil: number;
}

const REPLAN_INTERVAL_MS = 2500;
const WAYPOINT_REACH_DIST = 1.0;
const STUCK_DIST = 0.35;      // bergerak kurang dari ini dalam 1s = stuck
const STUCK_TIME_MS = 1000;
const SEPARATION_DIST = 1.6;

export class BotBrain {
  private nav: NavService;
  private rng: Rng;
  state: BotState;
  perception: Perception;
  static soundBus = new SoundBus();
  difficulty: DifficultyParams;
  perceptionEnabled = true;
  aim: AimState;
  /** Host set tiap tick: hp & ammo aktual bot (bot tidak membaca state internal host). */
  reportStatus(hp: number, ammo: Record<string, number>) {
    this.state.hp = hp;
    this.state.ammo = ammo;
  }

  constructor(id: string, spawn: [number, number, number], seed: number, nav: NavService, difficulty: keyof typeof DIFFICULTY = 'normal') {
    this.nav = nav;
    this.rng = mulberry32(seed);
    this.difficulty = DIFFICULTY[difficulty];
    this.perception = new Perception(this.difficulty, mulberry32(seed ^ 0x9e3779b9));
    this.aim = newAimState(0);
    this.state = {
      id,
      sim: newPlayerSimState(spawn[0], spawn[1], spawn[2]),
      path: [], pathIdx: 0, replanAt: 0, goal: null,
      lastX: spawn[0], lastZ: spawn[2], stuckSince: 0,
      strafeSign: this.rng() < 0.5 ? 1 : -1,
      recoverUntil: 0, recoverMX: 0, recoverMZ: 0,
      state: 'roam', stateUntil: 0,
      strafeDir: 1, strafeUntil: 0,
      hp: 100, ammo: { pistol: 12 }, fireCooldownUntil: 0,
    };
  }

  /** Path ke titik tertentu (lastKnown / sumber suara). */
  private gotoPoint(now: number, p: NavVec3) {
    const from = this.nav.nearestPoint({ x: this.state.sim.x, y: this.state.sim.y, z: this.state.sim.z });
    if (!from) return;
    this.state.path = this.nav.findPath(from, p);
    this.state.pathIdx = 0;
    this.state.goal = p;
    this.state.replanAt = now + 1500;
  }

  /** Pilih goal roam baru (titik acak navmesh) & hitung path. */
  private replan(now: number) {
    const goal = this.nav.randomPoint();
    if (!goal) { this.state.replanAt = now + 500; return; }
    const from = this.nav.nearestPoint({ x: this.state.sim.x, y: this.state.sim.y, z: this.state.sim.z });
    if (!from) { this.state.replanAt = now + 500; return; }
    this.state.path = this.nav.findPath(from, goal);
    this.state.pathIdx = 0;
    this.state.goal = goal;
    this.state.replanAt = now + REPLAN_INTERVAL_MS + this.rng() * 200;
  }

  /**
   * Think: hasilkan PlayerInput (TANPA men-step sim — host yang men-step,
   * satu sumber kebenaran; BOTS.md 2.1 bot=input AI, sim host sama dgn pemain).
   */
  update(view: BotWorldView, now: number, dt: number, seq: number): InputCmd {
    const st = this.state;

    // --- B3 persepsi (bisa dimatikan untuk test roam murni) ---
    if (this.perceptionEnabled) {
    const targets: PerceptTarget[] = view.others
      .filter((o) => !view.allies?.has(o.id)) // rekan satu tim bukan target (BOTS.md 5.3)
      .map((o) => ({
        id: o.id, x: o.x, y: o.y, z: o.z,
        height: o.height ?? 1.8, dead: o.dead ?? false, crouch: o.crouch ?? false,
      }));
    this.perception.updateVision(now, { x: st.sim.x, y: st.sim.y, z: st.sim.z, yaw: st.sim.yaw }, targets, GREYBOX.boxes as AABB[]);
    if (view.sounds) this.perception.hear(view.sounds, { x: st.sim.x, y: st.sim.y, z: st.sim.z }, now);
    }
    // --- state transitions (BOTS.md 5.1) ---
    const visible = [...this.perception.visible];
    const lowHp = st.hp <= 30;
    const noAmmo = Object.values(st.ammo).reduce((a, b) => a + b, 0) === 0;
    if (lowHp && visible.length > 0 && st.state !== 'retreat') {
      // Retreat: HP rendah + musuh terlihat → menjauh (BOTS.md 5.1)
      st.state = 'retreat';
      st.stateUntil = now + 1500 + this.rng() * 1000;
      const mem = this.perception.memory.get(visible[0]!)!;
      const dx = st.sim.x - mem.lastKnown.x, dz = st.sim.z - mem.lastKnown.z;
      const d = Math.hypot(dx, dz) || 1;
      this.gotoPoint(now, { x: st.sim.x + (dx / d) * 15, y: st.sim.y, z: st.sim.z + (dz / d) * 15 });
    } else if (visible.length > 0 && st.state !== 'combat') {
      // Musuh terlihat + reaction lewat → COMBAT (B4)
      const mem = this.perception.memory.get(visible[0]!)!;
      if (this.perception.canReactTo(visible[0]!, now)) {
        st.state = 'combat';
        this.aim.trackingSince = now;
      } else {
        st.state = 'investigate';
        this.gotoPoint(now, mem.lastKnown);
      }
    } else if (st.state === 'combat' && visible.length === 0) {
      // target hilang → Chase via lastKnown
      const mem = this.perception.mostRecentMemory(now);
      if (mem) {
        st.state = 'investigate';
        this.gotoPoint(now, mem.lastKnown);
      } else {
        st.state = 'roam';
      }
    } else if (st.state === 'retreat' && (now >= st.stateUntil || !lowHp)) {
      st.state = visible.length > 0 ? 'combat' : 'roam';
    } else if (st.state === 'investigate') {
      // target hilang dari pandangan → menuju lastKnown, lalu Search
      const mem = this.perception.mostRecentMemory(now);
      if (st.pathIdx >= st.path.length) {
        if (mem) {
          st.state = 'search';
          st.stateUntil = now + 3000 + this.rng() * 2000;
          this.gotoPoint(now, mem.lastKnown);
        } else {
          st.state = 'roam';
        }
      }
    } else if (st.state === 'search' && now >= st.stateUntil) {
      st.state = 'roam';
      st.goal = null; st.path = [];
    } else if (st.state === 'roam') {
      const snd = this.perception.latestSound(now);
      if (snd) {
        st.state = 'investigate';
        this.gotoPoint(now, { x: snd.x, y: snd.y, z: snd.z });
        this.perception.heardSounds = [];
      }
    }

    // goal/path: replan saat path habis, stuck, atau belum pernah plan
    if (st.pathIdx >= st.path.length || now >= st.replanAt) this.replan(now);

    // stuck detection
    const moved = Math.hypot(st.sim.x - st.lastX, st.sim.z - st.lastZ);
    if (moved < STUCK_DIST) {
      if (st.stuckSince === 0) st.stuckSince = now;
      else if (now - st.stuckSince > STUCK_TIME_MS) {
        // recovery (BOTS.md 3.4): mundur + strafe acak, lalu goal baru
        st.strafeSign = this.rng() < 0.5 ? 1 : -1;
        st.recoverUntil = now + 500 + this.rng() * 300;
        st.recoverMX = st.strafeSign;
        st.recoverMZ = -1; // mundur dari obstacle
        st.replanAt = 0;
        st.stuckSince = 0;
      }
    } else {
      st.stuckSince = 0;
      st.lastX = st.sim.x; st.lastZ = st.sim.z;
    }

    // --- COMBAT (B4): aim manusiawi + strafe + fire control ---
    if (st.state === 'combat' || st.state === 'retreat') {
      const visId = visible[0];
      const mem = visId ? this.perception.memory.get(visId) : this.perception.mostRecentMemory(now);
      if (!mem) { st.state = 'roam'; }
      else {
        const t = view.others.find((o) => o.id === visId);
        const tx = t ? t.x : mem.lastKnown.x;
        const tz = t ? t.z : mem.lastKnown.z;
        const ty = t ? t.y : mem.lastKnown.y;
        const dist = Math.hypot(tx - st.sim.x, tz - st.sim.z);

        // aim error resample (decay saat tracking — ADR-010)
        if (now >= this.aim.nextResample) resampleAimError(this.aim, now, this.difficulty, dist, this.rng);

        // titik bidik = target dgn error offset (konversi deg→rad, aplikasi di yaw target)
        const errYawRad = (this.aim.errYaw * Math.PI) / 180;
        const errPitchRad = (this.aim.errPitch * Math.PI) / 180;
        const targetYaw = Math.atan2(-(tx - st.sim.x), -(tz - st.sim.z)) + errYawRad;
        const eyeY = st.sim.y + 1.6;
        const targetPitch = Math.atan2(ty + 1.3 - eyeY, dist) + errPitchRad;
        const maxTurn = (this.difficulty.turnSpeedDeg * Math.PI / 180) * dt;
        const turned = turnToward(st.sim.yaw, st.sim.pitch, targetYaw, targetPitch, maxTurn);
        st.sim.yaw = turned.yaw; st.sim.pitch = turned.pitch;

        // fire control: reaction lewat + toleransi angular + LOS masih ada
        const tol = 2 + this.difficulty.aimErrorDeg; // deg — skala kesulitan
        const aimYawNoErr = Math.atan2(-(tx - st.sim.x), -(tz - st.sim.z));
        const canFire = visId !== undefined
          && this.perception.canReactTo(visId, now)
          && withinFireTolerance(st.sim.yaw, aimYawNoErr, tol)
          && now >= st.fireCooldownUntil;
        st.fireCooldownUntil = canFire ? now + 0 : st.fireCooldownUntil;

        // gerak combat: strafe kiri-kanan berinterval + jaga jarak ideal (pistol mid)
        if (now >= st.strafeUntil) {
          st.strafeDir = this.rng() < 0.5 ? 1 : -1;
          st.strafeUntil = now + 600 + this.rng() * 900;
        }
        let mx = st.strafeDir * (0.4 + this.difficulty.aggressiveness * 0.4);
        let mz = 0;
        if (dist > 25) mz = 0.6;        // mendekat
        else if (dist < 8) mz = -0.5;   // menjaga jarak
        if (st.state === 'retreat') { mx = st.strafeDir * 0.5; mz = -0.8; }

        const cmd: InputCmd = {
          seq, tick: 0,
          moveX: Math.max(-1, Math.min(1, mx)),
          moveZ: mz,
          yaw: st.sim.yaw, pitch: st.sim.pitch,
          jump: false, crouch: false, walk: false,
          fire: canFire, reload: false, weaponSlot: null,
        };
        return cmd;
      }
    }

    // arahkan ke waypoint
    let moveX = 0, moveZ = 0, yaw = st.sim.yaw;
    if (now < st.recoverUntil) {
      // recovery move: mundur/strafe, yaw tetap (jauhkan dari obstacle)
      return { seq, tick: 0, moveX: st.recoverMX, moveZ: st.recoverMZ, yaw: st.sim.yaw + Math.PI, pitch: 0, jump: false, crouch: false, walk: false, fire: false, reload: false, weaponSlot: null };
    }
    const wp = st.path[st.pathIdx];
    if (wp) {
      const dx = wp.x - st.sim.x, dz = wp.z - st.sim.z;
      const dist = Math.hypot(dx, dz);
      if (dist < WAYPOINT_REACH_DIST) {
        st.pathIdx++;
      } else {
        const targetYaw = Math.atan2(-dx, -dz); // dir=(-sin yaw, -cos yaw)
        // turn-speed clamp (ADR-010): 220 deg/s
        const maxTurn = (220 * Math.PI / 180) * dt;
        let dYaw = targetYaw - st.sim.yaw;
        while (dYaw > Math.PI) dYaw -= Math.PI * 2;
        while (dYaw < -Math.PI) dYaw += Math.PI * 2;
        yaw = st.sim.yaw + Math.max(-maxTurn, Math.min(maxTurn, dYaw));
        // gerak relatif yaw: maju
        moveZ = 1;
        // separation: dorongan menjauh dari bot terdekat
        let sepX = 0, sepZ = 0;
        for (const o of view.others) {
          if (o.id === st.id) continue;
          const ox = st.sim.x - o.x, oz = st.sim.z - o.z;
          const d = Math.hypot(ox, oz);
          if (d > 0.01 && d < SEPARATION_DIST) {
            sepX += (ox / d) * (1 - d / SEPARATION_DIST);
            sepZ += (oz / d) * (1 - d / SEPARATION_DIST);
          }
        }
        // konversi separation (world) ke lokal (rotasi -yaw)
        const s = Math.sin(-yaw), c = Math.cos(-yaw);
        const localSepX = sepX * c - sepZ * s;
        const localSepZ = sepX * s + sepZ * c;
        moveX = Math.max(-1, Math.min(1, localSepX * 2 + st.strafeSign * 0.25));
        moveZ = Math.max(-1, Math.min(1, moveZ + localSepZ));
      }
    }

    const cmd: InputCmd = {
      seq, tick: 0,
      moveX, moveZ,
      yaw, pitch: 0,
      jump: false, crouch: false, walk: false,
      fire: false, reload: false, weaponSlot: null,
    };
    return cmd;
  }
}
