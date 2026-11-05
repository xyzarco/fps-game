// Minimal vector math, allocation-free where possible (mutate `out`).
export interface Vec3 { x: number; y: number; z: number }
export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const set = (o: Vec3, x: number, y: number, z: number): Vec3 => { o.x = x; o.y = y; o.z = z; return o; };
export const add = (o: Vec3, a: Vec3, b: Vec3): Vec3 => set(o, a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (o: Vec3, a: Vec3, b: Vec3): Vec3 => set(o, a.x - b.x, a.y - b.y, a.z - b.z);
export const scale = (o: Vec3, a: Vec3, s: number): Vec3 => set(o, a.x * s, a.y * s, a.z * s);
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const len = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
export const norm = (o: Vec3, a: Vec3): Vec3 => { const l = len(a) || 1; return scale(o, a, 1 / l); };
export const copy = (o: Vec3, a: Vec3): Vec3 => set(o, a.x, a.y, a.z);
