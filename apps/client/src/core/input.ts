// Keyboard + mouse input, Pointer Lock.
export class InputManager {
  keys = new Set<string>();
  mouseDX = 0; mouseDY = 0;
  fireDown = false; firePressed = false;
  locked = false;
  onLockChange: (locked: boolean) => void = () => {};

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => { this.keys.add(e.code); if (e.code === 'Tab') e.preventDefault(); });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX; this.mouseDY += e.movementY;
    });
    window.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) { this.fireDown = true; this.firePressed = true; }
    });
    window.addEventListener('mouseup', (e) => { if (e.button === 0) this.fireDown = false; });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      this.onLockChange(this.locked);
    });
    this.canvas.addEventListener('click', () => { if (!this.locked) this.canvas.requestPointerLock(); });
  }

  requestLock() { this.canvas.requestPointerLock(); }

  /** Consume accumulated mouse delta (radians after sensitivity). */
  consumeMouse(sensitivity: number): [number, number] {
    const d: [number, number] = [this.mouseDX * sensitivity, this.mouseDY * sensitivity];
    this.mouseDX = 0; this.mouseDY = 0;
    return d;
  }

  get moveX(): number { return (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0); }
  get moveZ(): number { return (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0); }
  get jump(): boolean { return this.keys.has('Space'); }
  get crouch(): boolean { return this.keys.has('ControlLeft') || this.keys.has('KeyC'); }
  get walk(): boolean { return this.keys.has('ShiftLeft'); }
  consumeFirePressed(): boolean { const f = this.firePressed; this.firePressed = false; return f; }
}
