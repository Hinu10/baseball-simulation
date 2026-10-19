// core で使う小さなベクトル計算。Three.js には依存しない。

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const add = (a: Vec3, b: Vec3): Vec3 => v3(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a: Vec3, b: Vec3): Vec3 => v3(a.x - b.x, a.y - b.y, a.z - b.z);
export const scale = (a: Vec3, k: number): Vec3 => v3(a.x * k, a.y * k, a.z * k);
export const len = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
export const lenXZ = (a: Vec3): number => Math.hypot(a.x, a.z);
export const distXZ = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.z - b.z);
export const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => v3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
export const copy = (a: Vec3): Vec3 => v3(a.x, a.y, a.z);
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const deg = (rad: number) => (rad * 180) / Math.PI;
export const rad = (d: number) => (d * Math.PI) / 180;

/** a から b へ、最大 step だけ水平に近づける。着いたら true。 */
export function moveTowardXZ(p: Vec3, target: Vec3, step: number): boolean {
  const dx = target.x - p.x;
  const dz = target.z - p.z;
  const d = Math.hypot(dx, dz);
  if (d <= step || d < 1e-6) {
    p.x = target.x;
    p.z = target.z;
    return true;
  }
  p.x += (dx / d) * step;
  p.z += (dz / d) * step;
  return false;
}
