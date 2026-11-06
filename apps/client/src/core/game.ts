// Single-player core: fixed-timestep loop, camera, weapon, dummy targets, HUD bridge.
import * as THREE from 'three';
import { TICK_MS, PLAYER_HEIGHT, GRAVITY } from '@fps/shared';
import { stepMovement, newPlayerSimState, type PlayerSimState, type AABB } from '@fps/shared';
import { GREYBOX } from '@fps/shared';
import { fireWeapon } from '@fps/shared';
import { WEAPONS, type WeaponId } from '@fps/shared';
import { InputManager } from './input.js';

const SENSITIVITY = 0.0022;

interface Dummy { pos: THREE.Vector3; sim: PlayerSimState; hp: number; mesh: THREE.Mesh; nameplate: THREE.Sprite }

export class Game {
  input: InputManager;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private sceneCamera: THREE.PerspectiveCamera; // viewmodel camera (separate FOV)
  private sim: PlayerSimState;
  private world: AABB[] = GREYBOX.boxes;
  private dummies: Dummy[] = [];
  private acc = 0;
  private lastTime = 0;
  private seq = 0;
  private weapon: WeaponId = 'pistol';
  private ammo = WEAPONS.pistol.magSize;
  private reserve = WEAPONS.pistol.reserveAmmo;
  private nextFireAt = 0;
  private reloadUntil = 0;
  private muzzleFlash: THREE.PointLight;
  private tracers: { line: THREE.Line; until: number }[] = [];
  private viewmodel: THREE.Group;
  private hud = { hp: el('hud-hp'), ammo: el('hud-ammo'), weapon: el('hud-weapon'), crosshair: el('crosshair'), hitmarker: el('hitmarker'), lock: el('lock-hint'), fps: el('fps') };
  private fpsFrames = 0;
  private fpsLast = performance.now();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

    this.scene.background = new THREE.Color(0x0f1220);
    this.scene.fog = new THREE.Fog(0x0f1220, 40, 90);
    this.camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 300);
    this.sceneCamera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.01, 10);

    // lights
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

    this.sim = newPlayerSimState(0, 0, -30);
    this.input = new InputManager(canvas);
    this.input.onLockChange = (l) => { this.hud.lock.style.display = l ? 'none' : 'flex'; };

    window.addEventListener('resize', () => {
      this.camera.aspect = this.sceneCamera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix(); this.sceneCamera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
    });
  }

  private buildMap() {
    const wallMat = new THREE.MeshLambertMaterial({ color: 0x5a627a });
    const floorMat = new THREE.MeshLambertMaterial({ color: 0x3c4258 });
    for (const b of this.world) {
      const w = b.maxX - b.minX, h = b.maxY - b.minY, d = b.maxZ - b.minZ;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), b.maxY - b.minY < 6 ? wallMat : floorMat);
      mesh.position.set((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2);
      this.scene.add(mesh);
    }
  }

  private buildDummies(n: number) {
    const spots = [[-12, 0, 12], [12, 0, 12], [-12, 0, -12], [12, 0, -14]];
    const geo = new THREE.CapsuleGeometry(0.4, PLAYER_HEIGHT - 0.8, 6, 12);
    for (let i = 0; i < n; i++) {
      const mat = new THREE.MeshLambertMaterial({ color: 0xd95f4e });
      const mesh = new THREE.Mesh(geo, mat);
      const [x, y, z] = spots[i % spots.length] as [number, number, number];
      mesh.position.set(x, y + PLAYER_HEIGHT / 2, z);
      this.scene.add(mesh);
      this.dummies.push({
        pos: new THREE.Vector3(x, y, z),
        sim: newPlayerSimState(x, y, z),
        hp: 100, mesh,
        nameplate: makeNameplate(`Dummy ${i + 1}`),
      });
      const np = this.dummies[this.dummies.length - 1]!.nameplate;
      np.position.set(x, y + PLAYER_HEIGHT + 0.35, z);
      this.scene.add(np);
    }
  }

  private buildViewmodel(): THREE.Group {
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.10, 0.42),
      new THREE.MeshLambertMaterial({ color: 0x2b2f3d }),
    );
    body.position.set(0.25, -0.2, -0.5);
    const barrel = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.04, 0.18),
      new THREE.MeshLambertMaterial({ color: 0x171a24 }),
    );
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
    if (dt > 0.25) dt = 0.25; // tab-back clamp
    this.acc += dt;
    let steps = 0;
    while (this.acc >= TICK_MS / 1000 && steps < 5) {
      this.tick(TICK_MS / 1000);
      this.acc -= TICK_MS / 1000;
      steps++;
    }
    this.renderInterp(dt);
    this.renderer.render(this.scene, this.camera);
    // viewmodel pass: clear depth so weapon never clips walls
    this.renderer.autoClear = false;
    this.renderer.clearDepth();
    this.renderer.render(this.sceneCamera, this.sceneCamera);
    this.renderer.autoClear = true;
    this.updateHud();
    this.updateTracers(now);
    this.muzzleFlash.intensity = Math.max(0, this.muzzleFlash.intensity - 40 * dt);
    this.fpsFrames++;
    if (now - this.fpsLast >= 500) {
      this.hud.fps.textContent = `${Math.round((this.fpsFrames * 1000) / (now - this.fpsLast))} fps`;
      this.fpsLast = now; this.fpsFrames = 0;
    }
  }

  private tick(dt: number) {
    const now = performance.now();
    this.seq++;
    const [mdx, mdy] = this.input.consumeMouse(SENSITIVITY);
    this.sim.yaw -= mdx;
    this.sim.pitch = clamp(this.sim.pitch - mdy, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);

    const wantFire = WEAPONS[this.weapon].auto ? this.input.fireDown : this.input.consumeFirePressed();
    const cmd = {
      seq: this.seq, tick: this.seq, moveX: this.input.moveX, moveZ: this.input.moveZ,
      yaw: this.sim.yaw, pitch: this.sim.pitch, jump: this.input.jump,
      crouch: this.input.crouch, walk: this.input.walk,
      fire: wantFire, reload: this.input.keys.has('KeyR'), weaponSlot: null,
    };

    stepMovement(this.sim, cmd, this.world, dt);

    // weapon
    if (cmd.reload && this.ammo < WEAPONS[this.weapon].magSize && now >= this.reloadUntil) {
      this.reloadUntil = now + WEAPONS[this.weapon].reloadMs;
    }
    if (now < this.reloadUntil) { /* reloading */ }
    else if (this.reloadUntil !== 0 && this.ammo < WEAPONS[this.weapon].magSize) {
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

    // camera at eye height
    this.camera.position.set(this.sim.x, this.sim.y + this.sim.height - 0.2, this.sim.z);
    this.camera.rotation.set(this.sim.pitch, this.sim.yaw, 0, 'YXZ');
  }

  private fireShot() {
    const dir = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(this.sim.pitch, this.sim.yaw, 0, 'YXZ'));
    const origin: [number, number, number] = [this.sim.x, this.sim.y + this.sim.height - 0.2, this.sim.z];
    const targets = this.dummies.filter((d) => d.hp > 0).map((d) => ({ x: d.sim.x, y: d.sim.y, z: d.sim.z, height: d.sim.height }));
    const distMap = this.dummies.filter((d) => d.hp > 0);
    const res = fireWeapon(origin, [dir.x, dir.y, dir.z], this.weapon, this.world, targets, (p) => {
      const i = targets.indexOf(p);
      const d = i >= 0 ? distMap[i] : undefined;
      return d ? d.pos.distanceTo(new THREE.Vector3(origin[0], origin[1], origin[2])) : Infinity;
    });
    // fx
    this.muzzleFlash.intensity = 8;
    this.addTracer(origin, res.hitPoint ?? res.impactPoint ?? [dir.x * 100, dir.y * 100, dir.z * 100]);
    if (res.hitPlayer) this.showHitmarker(res.damage);
    if (res.hitPlayer && res.hitPoint) {
      // apply damage to nearest hit dummy
      let best: Dummy | null = null; let bestD = Infinity;
      for (const d of this.dummies) {
        if (d.hp <= 0) continue;
        const dist = d.pos.distanceToSquared(new THREE.Vector3(...res.hitPoint));
        if (dist < bestD) { bestD = dist; best = d; }
      }
      if (best) {
        best.hp -= res.damage;
        if (best.hp <= 0) {
          best.hp = 0;
          setTimeout(() => { best!.hp = 100; }, 3000); // dummy respawn
        }
      }
    }
  }

  private addTracer(a: number[] | [number, number, number], b: number[] | [number, number, number]) {
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

  private renderInterp(dt: number) {
    // dummy visuals
    for (const d of this.dummies) {
      d.mesh.visible = d.hp > 0;
      d.mesh.rotation.y = Math.sin(performance.now() / 1500 + d.pos.x) * 0.5; // idle spin to show it's a bot
    }
    // subtle viewmodel sway
    this.viewmodel.position.y = Math.sin(performance.now() / 400) * 0.004;
    this.viewmodel.position.x = Math.cos(performance.now() / 500) * 0.003;
  }

  private updateHud() {
    this.hud.hp.textContent = `HP 100`;
    this.hud.ammo.textContent = this.reloadUntil !== 0 ? 'RELOADING…' : `${this.ammo} / ${this.reserve === -1 ? '∞' : this.reserve}`;
    this.hud.weapon.textContent = WEAPONS[this.weapon].name;
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
