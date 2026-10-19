// Sky Park Stadium の寸法と座標系。投球・打球・守備・走塁で共有する。
//
// 座標系：本塁が原点、単位はメートル。+z が投手・センター方向、+x が一塁側（本塁から見て右）、+y が上。
// フェア地域は z >= |x|（両ファウルラインの内側）。

import { v3, type Vec3 } from './math.ts';
import type { Position } from './types.ts';

export const STADIUM_NAME = 'Sky Park Stadium';
export const BASE_DISTANCE = 27.43;
export const MOUND_DISTANCE = 18.44;

const D = BASE_DISTANCE / Math.SQRT2;
/** 塁の位置。0 = 本塁、1〜3 = 一塁〜三塁、4 = 本塁（生還）。 */
export const BASES: readonly Vec3[] = [v3(0, 0, 0), v3(D, 0, D), v3(0, 0, 2 * D), v3(-D, 0, D), v3(0, 0, 0)];
export const basePos = (b: number): Vec3 => BASES[Math.max(0, Math.min(4, b))];
export const MOUND = v3(0, 0, MOUND_DISTANCE);

/** 内野の土の半径（マウンドの手前を中心とする円）。 */
export const INFIELD_DIRT_RADIUS = 29;
export const INFIELD_DIRT_CENTER = v3(0, 0, 18.3);

export const FENCE = { line: 92, center: 112, height: 3.2 };
/** ファウルラインから観客席までの幅と、バックネットまでの距離。 */
export const FOUL_GROUND = { side: 16, backstop: 18 };

/** センター方向からの角度（ラジアン、一塁側が +）。 */
export const sprayAngle = (p: { x: number; z: number }) => Math.atan2(p.x, p.z);

/** 角度 a（ラジアン）の方向のフェンスまでの距離。両翼 92m・中堅 112m を cos でつなぐ。 */
export function fenceDistance(a: number): number {
  const t = Math.min(Math.abs(a), Math.PI / 4);
  return FENCE.line + (FENCE.center - FENCE.line) * Math.cos(2 * t);
}

export const isFair = (p: { x: number; z: number }) => p.z >= Math.abs(p.x) - 1e-9;

/** ファウルラインからの距離（フェア側が負）。 */
export const distanceOutsideLine = (p: { x: number; z: number }) => (Math.abs(p.x) - p.z) / Math.SQRT2;

/** 打球がファウル地域の観客席・バックネットに入ったか。 */
export function inFoulStands(p: { x: number; z: number }): boolean {
  if (isFair(p)) return false;
  return distanceOutsideLine(p) > FOUL_GROUND.side || p.z < -FOUL_GROUND.backstop || Math.hypot(p.x, p.z) > FENCE.line + 4;
}

/** 内野の土の上か（バウンド・転がりの摩擦が変わる）。 */
export const onDirt = (p: { x: number; z: number }) => Math.hypot(p.x - INFIELD_DIRT_CENTER.x, p.z - INFIELD_DIRT_CENTER.z) < INFIELD_DIRT_RADIUS;

/** 投手のリリース位置と、本塁上の通過面（z = 0）。 */
export const RELEASE_POINT = v3(-0.35, 1.85, 17.2);
export const PLATE_Z = 0;

/** 打者の立ち位置（右打者は三塁側 = -x）。 */
export const batterBox = (bats: 'R' | 'L') => v3(bats === 'R' ? -0.85 : 0.85, 0, 0.1);

/** 守備位置の基本の立ち位置。 */
export const DEFAULT_FIELD_POSITIONS: Record<Position, Vec3> = {
  P: v3(0, 0, 18.0),
  C: v3(0, 0, -1.3),
  '1B': v3(20.5, 0, 25.5),
  '2B': v3(9, 0, 34),
  SS: v3(-9, 0, 34),
  '3B': v3(-20.5, 0, 25.5),
  LF: v3(-30, 0, 72),
  CF: v3(0, 0, 84),
  RF: v3(30, 0, 72)
};
