// Multiplayer core: local prediction + reconciliation, remote interpolation, camera, weapons, HUD.
import * as THREE from 'three';
import { TICK_MS, PLAYER_HEIGHT, INTERP_DELAY_MS, MAX_HP, stepMovement, newPlayerSimState, fireWeapon, GREYBOX, WEAPONS, type WeaponId, type InputCmd } from '@fps/shared';
import { InputManager } from './input.js';
import { NetClient, type RemoteSnapshot } from '../net/netclient.js';

const SENSITIVITY = 0.0022;
const MAX_PENDING = 120;

interface RemoteVisual { mesh: THREE.Mesh; nameplate: THREE.Sprite; name: string }

export class Game {
  input: InputManager;
  net = new NetClient();
  sim = newPlayerSimState(0, 0, -30);       // predicted local state
  pending: InputCmd[] = [];                 // inputs not yet acked
  connected = false;

  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private sceneCamera: THREE.PerspectiveCamera;
  private dummies: { sim: ReturnType<typeof newPlayerSimState>; hp: number; mesh: THREE.Mesh; nameplate: THREE.Sprite }[] = [];
  private remotes = new Map<string, RemoteVisual>();
  private acc = 0;
  private lastTime = 0;
  private seq = 0;
  private serverEstOffset = 0;
  private weapon: WeaponId = 'pistol';
  private ammo = WEAPONS.pistol.magSize;
  private reserve = WEAPONS.pistol.reserveAmmo;
  private nextFireAt = 0;
  private reloadUntil = 0;
  private muzzleFlash: THREE.PointLight;
  private tracers: { line: THREE.Line; until: number }[] = [];
  private viewmodel: THREE.Group;
  private hud = { hp: el('hud-hp'), ammo: el('hud-ammo'), weapon: el('hud-weapon'), hitmarker: el('hitmarker'), lock: el('lock-hint'), fps: el('fps'), ping: el('hud-ping') };
  private fpsFrames = 0;
  private fpsLast = performance.now();
  private lastSnapshot: RemoteSnapshot | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

    this.scene.background = new THREE.Color(0x0f1220);
    this.scene.fog = new THREE.Fog(0x0f1220, 40, 90);
    this.camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 300);
    this.sceneCamera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.01, 10);

    const hemi = new THREE.HemisphereLight(0x8fa3ff, 0x202028, 1.1);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(20, 40, 10);
    this.scene.add(sun);

    this.buildMap();
    this.buildDummies(4);
    this.viewmodel = this.buildViewmodel();
    this.sceneCamera.add(this.viewmodel);
    this.muzzleFlash = new THREE.PointLight(0xffcc66, 0, 6);
    this.viewmodel.add(this.muzzleFlash);
    this.muzzleFlash.position.set(0.25, -0.18, -0.6);

    this.input = new InputManager(canvas);
    this.input.onLockChange = (l) => { this.hud.lock.style.display = l ? 'none' : 'flex'; };

    window.addEventListener('resize', () => {
      this.camera.aspect = this.sceneCamera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix(); this.sceneCamera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
    });

    this.net.onJoinWorld = () => { this.connected = true; };
  }

  async connect(nickname: string) {
    await this.net.join(nickname.slice(0, 16) || 'Player');
  }

  private buildMap() {
    const wallMat = new THREE.MeshLambertMaterial({ color: 0x5a627a });
    const floorMat = new THREE.MeshLambertMaterial({ color: 0x3c4258 });
    for (const b of GREYBOX.boxes) {
      const w = b.maxX - b.minX, h = b.maxY - b.minY, d = b.maxZ - b.minZ;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), h < 6 ? wallMat : floorMat);
      mesh.position.set((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2);
      this.scene.add(mesh);
    }
  }

  private buildDummies(n: number) {
    const spots = [[-12, 0, 12], [12, 0, 12], [-12, 0, -12], [12, 0, -14]];
    const geo = new THREE.CapsuleGeometry(0.4, PLAYER_HEIGHT - 0.8, 6, 12);
    for (let i = 0; i < n; i++) {
      const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0xd95f4e }));
      const [x, y, z] = spots[i % spots.length] as [number, number, number];
      mesh.position.set(x, y + PLAYER_HEIGHT / 2, z);
      this.scene.add(mesh);
      this.dummies.push({ sim: newPlayerSimState(x, y, z), hp: 100, mesh, nameplate: makeNameplate(`Dummy ${i + 1}`) });
      const np = this.dummies[this.dummies.length - 1]!.nameplate;
      np.position.set(x, y + PLAYER_HEIGHT + 0.35, z);
      this.scene.add(np);
    }
  }

  private buildViewmodel(): THREE.Group {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.10, 0.42), new THREE.MeshLambertMaterial({ color: 0x2b2f3d }));
    body.position.set(0.25, -0.2, -0.5);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.18), new THREE.MeshLambertMaterial({ color: 0x171a24 }));
    barrel.position.set(0.25, -0.17, -0.78);
    g.add(body, barrel);
    return g;
  }

  start() {
    this.lastTime = performance.now();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  private frame() {
    const now = performance.now();
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (dt > 0.25) dt = 0.25;
    this.acc += dt;
    let steps = 0;
    while (this.acc >= TICK_MS / 1000 && steps < 5) {
      this.tick(TICK_MS / 1000, now);
      this.acc -= TICK_MS / 1000;
      steps++;
    }
    this.renderFrame(now);
    this.renderer.render(this.scene, this.camera);
    this.renderer.autoClear = false;
    this.renderer.clearDepth();
    this.renderer.render(this.sceneCamera, this.sceneCamera);
    this.renderer.autoClear = true;
    this.muzzleFlash.intensity = Math.max(0, this.muzzleFlash.intensity - 40 * dt);
    this.fpsFrames++;
    if (now - this.fpsLast >= 500) {
      this.hud.fps.textContent = `${Math.round((this.fpsFrames * 1000) / (now - this.fpsLast))} fps`;
      this.fpsLast = now; this.fpsFrames = 0;
    }
  }

  private tick(dt: number, now: number) {
    this.seq++;
    const [mdx, mdy] = this.input.consumeMouse(SENSITIVITY);
    this.sim.yaw -= mdx;
    this.sim.pitch = clamp(this.sim.pitch - mdy, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);

    const cmd: InputCmd = {
      seq: this.seq, tick: this.seq, moveX: this.input.moveX, moveZ: this.input.moveZ,
      yaw: this.sim.yaw, pitch: this.sim.pitch, jump: this.input.jump,
      crouch: this.input.crouch, walk: this.input.walk,
      fire: WEAPONS[this.weapon].auto ? this.input.fireDown : this.input.consumeFirePressed(),
      reload: this.input.keys.has('KeyR'), weaponSlot: null,
    };

    // client-side prediction: apply immediately
    stepMovement(this.sim, cmd, GREYBOX.boxes, dt);
    this.pending.push(cmd);
    if (this.pending.length > MAX_PENDING) this.pending.shift();

    if (this.connected) this.net.sendInput(cmd);

    // reconciliation: rewind to acked server state, replay unacked inputs
    if (this.connected) {
      const acked = this.net.lastProcessedSeq;
      if (acked > 0 && this.pending.length && this.pending[0]!.seq <= acked) {
        const serverPlayer = this.net.sessionId ? this.net.latest?.players.get(this.net.sessionId) : undefined;
        if (serverPlayer) {
          this.sim.x = serverPlayer.x; this.sim.y = serverPlayer.y; this.sim.z = serverPlayer.z;
          for (const c of this.pending) {
            if (c.seq > acked) stepMovement(this.sim, c, GREYBOX.boxes, TICK_MS / 1000);
          }
          this.pending = this.pending.filter((c) => c.seq > acked);
        }
      }
      if (this.net.latest) {
        const off = this.net.latest.serverTimeMs - now;
        this.serverEstOffset = this.serverEstOffset === 0 ? off : this.serverEstOffset * 0.95 + off * 0.05;
      }
    }

    // weapon
    if (cmd.reload && this.ammo < WEAPONS[this.weapon].magSize && now >= this.reloadUntil) {
      this.reloadUntil = now + WEAPONS[this.weapon].reloadMs;
    }
    if (this.reloadUntil !== 0 && now >= this.reloadUntil && this.ammo < WEAPONS[this.weapon].magSize) {
      const need = WEAPONS[this.weapon].magSize - this.ammo;
      const take = this.reserve === -1 ? need : Math.min(need, this.reserve);
      this.ammo += take;
      if (this.reserve !== -1) this.reserve -= take;
      this.reloadUntil = 0;
    }
    if (cmd.fire && now >= this.nextFireAt && this.ammo > 0 && this.reloadUntil === 0) {
      this.nextFireAt = now + WEAPONS[this.weapon].fireIntervalMs;
      this.ammo--;
      this.fireShot();
    }

    this.camera.position.set(this.sim.x, this.sim.y + this.sim.height - 0.2, this.sim.z);
    this.camera.rotation.set(this.sim.pitch, this.sim.yaw, 0, 'YXZ');
  }

  private renderFrame(now: number) {
    if (this.net.latest) {
      const renderTime = now + this.serverEstOffset - INTERP_DELAY_MS;
      const snap = this.net.interpolate(renderTime);
      if (snap) this.applyRemoteSnapshot(snap);
    }
    for (const d of this.dummies) {
      d.mesh.visible = d.hp > 0;
      d.mesh.rotation.y = Math.sin(now / 1500 + d.sim.x) * 0.5;
    }
    this.viewmodel.position.y = Math.sin(now / 400) * 0.004;
    this.viewmodel.position.x = Math.cos(now / 500) * 0.003;
    this.updateHud();
    this.updateTracers(now);
  }

  private applyRemoteSnapshot(snap: RemoteSnapshot) {
    this.lastSnapshot = snap;
    const seen = new Set<string>();
    for (const [id, p] of snap.players) {
      if (id === this.net.sessionId) continue;
      seen.add(id);
      let rv = this.remotes.get(id);
      if (!rv) {
        const mesh = new THREE.Mesh(
          new THREE.CapsuleGeometry(0.4, PLAYER_HEIGHT - 0.8, 6, 12),
          new THREE.MeshLambertMaterial({ color: 0x4ea3d9 }),
        );
        this.scene.add(mesh);
        const nameplate = makeNameplate(p.nickname || 'Player');
        this.scene.add(nameplate);
        rv = { mesh, nameplate, name: p.nickname };
        this.remotes.set(id, rv);
      }
      rv.mesh.position.set(p.x, p.y + PLAYER_HEIGHT / 2, p.z);
      rv.mesh.visible = !p.dead;
      rv.nameplate.position.set(p.x, p.y + PLAYER_HEIGHT + 0.35, p.z);
      rv.nameplate.visible = !p.dead;
    }
    for (const [id, rv] of this.remotes) {
      if (!seen.has(id)) {
        this.scene.remove(rv.mesh, rv.nameplate);
        this.remotes.delete(id);
      }
    }
  }

  private fireShot() {
    const dir = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(this.sim.pitch, this.sim.yaw, 0, 'YXZ'));
    const origin: [number, number, number] = [this.sim.x, this.sim.y + this.sim.height - 0.2, this.sim.z];
    const aliveDummies = this.dummies.filter((d) => d.hp > 0);
    const targets = aliveDummies.map((d) => ({ x: d.sim.x, y: d.sim.y, z: d.sim.z, height: d.sim.height }));
    const remoteTargets: { x: number; y: number; z: number; height: number; id: string }[] = [];
    if (this.lastSnapshot) {
      for (const [id, p] of this.lastSnapshot.players) {
        if (id === this.net.sessionId || p.dead) continue;
        remoteTargets.push({ x: p.x, y: p.y, z: p.z, height: PLAYER_HEIGHT, id });
      }
    }
    const allTargets = [...targets, ...remoteTargets.map((r) => ({ x: r.x, y: r.y, z: r.z, height: r.height }))];
    const res = fireWeapon(origin, [dir.x, dir.y, dir.z], this.weapon, GREYBOX.boxes, allTargets, (p) => {
      const i = allTargets.indexOf(p);
      const t = i >= 0 ? allTargets[i] : undefined;
      return t ? Math.hypot(t.x - origin[0], t.z - origin[2]) : Infinity;
    });
    this.muzzleFlash.intensity = 8;
    this.addTracer(origin, res.hitPoint ?? res.impactPoint ?? [dir.x * 100, dir.y * 100, dir.z * 100]);
    if (res.hitPlayer && res.hitPoint) {
      this.showHitmarker(res.damage);
      let bestDummy = -1; let bestD = Infinity;
      aliveDummies.forEach((d, i) => {
        const dist = (d.sim.x - res.hitPoint![0]) ** 2 + (d.sim.z - res.hitPoint![2]) ** 2;
        if (dist < bestD) { bestD = dist; bestDummy = i; }
      });
      if (bestDummy >= 0) {
        const d = aliveDummies[bestDummy]!;
        d.hp = Math.max(0, d.hp - res.damage);
        if (d.hp === 0) setTimeout(() => { d.hp = 100; }, 3000);
      }
      // remote damage: authoritative server only (Fase 3); local hitmarker is cosmetic
    }
  }

  private addTracer(a: ArrayLike<number>, b: ArrayLike<number>) {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(a[0], a[1], a[2]), new THREE.Vector3(b[0], b[1], b[2]),
    ]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffdd88, transparent: true, opacity: 0.8 }));
    this.scene.add(line);
    this.tracers.push({ line, until: performance.now() + 80 });
  }

  private updateTracers(now: number) {
    this.tracers = this.tracers.filter((t) => {
      if (now > t.until) { this.scene.remove(t.line); t.line.geometry.dispose(); return false; }
      return true;
    });
  }

  private showHitmarker(dmg: number) {
    const el = this.hud.hitmarker;
    el.textContent = `✛ ${dmg}`;
    el.style.opacity = '1';
    setTimeout(() => (el.style.opacity = '0'), 120);
  }

  private updateHud() {
    this.hud.hp.textContent = `HP ${this.net.sessionId ? (this.net.latest?.players.get(this.net.sessionId)?.hp ?? MAX_HP) : MAX_HP}`;
    this.hud.ammo.textContent = this.reloadUntil !== 0 ? 'RELOADING…' : `${this.ammo} / ${this.reserve === -1 ? '∞' : this.reserve}`;
    this.hud.weapon.textContent = WEAPONS[this.weapon].name;
    this.hud.ping.textContent = this.connected ? `connected · ${this.remotes.size} remote` : 'offline (sandbox)';
  }
}

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

function makeNameplate(text: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.font = 'bold 28px sans-serif';
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.fillText(text, 128, 42);
  const tex = new THREE.CanvasTexture(c);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  sp.scale.set(1.6, 0.4, 1);
  return sp;
}

function el(id: string): HTMLElement {
  const e = document.getElementById(id);
  if (!e) throw new Error(`missing #${id}`);
  return e;
}
