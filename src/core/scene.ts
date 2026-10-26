// 試合の合間の場面（本塁打の出迎え・投手交代・投球練習）で使う、時刻から位置を決める部品。
import { distXZ, lerp, type Vec3 } from './math.ts';

export const facingTo = (from: Vec3, to: Vec3) => Math.atan2(to.x - from.x, to.z - from.z);

/** 折れ線 points を speed で進んで t 秒後の位置と向き。t < 0 なら出発前。 */
export function along(points: Vec3[], speed: number, t: number): { pos: Vec3; facing: number; moving: boolean } {
  let left = Math.max(0, t) * speed;
  for (let i = 1; i < points.length; i++) {
    const d = distXZ(points[i - 1], points[i]);
    if (left <= d && d > 1e-6) return { pos: lerp(points[i - 1], points[i], left / d), facing: facingTo(points[i - 1], points[i]), moving: t > 0 };
    left -= d;
  }
  const n = points.length;
  return { pos: points[n - 1], facing: n > 1 ? facingTo(points[n - 2], points[n - 1]) : 0, moving: false };
}

/** 折れ線を speed で進むのにかかる秒。 */
export function pathDuration(points: Vec3[], speed: number): number {
  let d = 0;
  for (let i = 1; i < points.length; i++) d += distXZ(points[i - 1], points[i]);
  return d / speed;
}
