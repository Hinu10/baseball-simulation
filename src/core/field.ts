// 球場の寸法と座標系。投球・打球・守備・走塁で共有する。
// ダイヤモンドは全球場で同じ。フェンスとファウルゾーンは球場（Park）ごとに違い、ホーム（後攻）の球団の球場を使う。
//
// 座標系：本塁が原点、単位はメートル。+z が投手・センター方向、+x が一塁側（本塁から見て右）、+y が上。
// フェア地域は z >= |x|（両ファウルラインの内側）。

import { v3, type Vec3 } from './math.ts';
import type { Position } from './types.ts';

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

/** 外野フェンス：左翼・右翼のポールまでと中堅までの距離、高さ（m）。 */
export interface Fence {
  left: number;
  right: number;
  center: number;
  height: number;
}

/** 球場。寸法だけを持ち、見た目は render/stadium.ts が id ごとに作る。 */
export interface Park {
  id: string;
  name: string;
  nameJa: string;
  fence: Fence;
  /** ファウルラインから観客席までの幅と、バックネットまでの距離。 */
  foul: { side: number; backstop: number };
  /** 屋根があるか。 */
  dome: boolean;
}

/** 本拠地のない球団の試合や、メニューの背景に使う球場。 */
export const DEFAULT_PARK: Park = {
  id: 'skypark',
  name: 'Sky Park Stadium',
  nameJa: 'スカイパークスタジアム',
  fence: { left: 92, right: 92, center: 112, height: 3.2 },
  foul: { side: 16, backstop: 18 },
  dome: false
};

/** 各球団の本拠地（球団 id → 球場）。 */
export const HOME_PARKS: Readonly<Record<string, Park>> = {
  hanazakura: {
    id: 'hanazakura',
    name: 'Hanazakura Dome',
    nameJa: '花桜ドーム',
    fence: { left: 93, right: 93, center: 114, height: 3.4 },
    foul: { side: 15, backstop: 17 },
    dome: true
  },
  kamiyama: {
    id: 'kamiyama',
    name: 'Kamiyamakoku Dome',
    nameJa: '神山国ドーム',
    fence: { left: 92, right: 92, center: 113, height: 3.6 },
    foul: { side: 16, backstop: 18 },
    dome: true
  },
  jogawa: {
    id: 'jogawa',
    name: 'Jogawa Dome',
    nameJa: 'じょがわドーム',
    fence: { left: 98, right: 98, center: 121, height: 3.4 },
    foul: { side: 19, backstop: 21 },
    dome: true
  },
  maikai: {
    id: 'maikai',
    name: 'Maikai Stadium',
    nameJa: 'マイカイスタジアム',
    fence: { left: 94, right: 94, center: 116, height: 3.0 },
    foul: { side: 17, backstop: 19 },
    dome: false
  },
  facrom: {
    id: 'facrom',
    name: 'Facrom Stadium',
    nameJa: 'ファクロムスタジアム',
    fence: { left: 88, right: 88, center: 106, height: 3.8 },
    foul: { side: 12, backstop: 15 },
    dome: false
  },
  smarlins: {
    id: 'smarlins',
    name: 'Smarlins Stadium',
    nameJa: 'スマーリンズスタジアム',
    // 海に面した右翼が深く、左翼が浅い（左右非対称）。
    fence: { left: 89, right: 99, center: 115, height: 3.2 },
    foul: { side: 15, backstop: 17 },
    dome: false
  },
  kanbu: {
    id: 'kanbu',
    name: 'Kanbu Dome',
    nameJa: '寛ブドーム',
    // とにかく広い。
    fence: { left: 102, right: 102, center: 127, height: 3.6 },
    foul: { side: 22, backstop: 24 },
    dome: true
  },
  manyama: {
    id: 'manyama',
    name: 'Manyama Dome Stadium',
    nameJa: '万山ドームスタジアム',
    // 開閉式の屋根（開くかどうかは試合ごと）。
    fence: { left: 95, right: 95, center: 118, height: 4.0 },
    foul: { side: 16, backstop: 18 },
    dome: true
  },
  onetar: {
    id: 'onetar',
    name: 'Onetar Stadium',
    nameJa: 'オネタールスタジアム',
    fence: { left: 93, right: 93, center: 114, height: 3.2 },
    foul: { side: 16, backstop: 18 },
    dome: false
  },
  sackstars: {
    id: 'sackstars',
    name: 'Sack Stars Stadium',
    nameJa: 'サックスターズスタジアム',
    fence: { left: 92, right: 92, center: 113, height: 3.0 },
    foul: { side: 15, backstop: 17 },
    dome: false
  },
  merry: {
    id: 'merry',
    name: 'Merry Stadium',
    nameJa: 'メリースタジアム',
    fence: { left: 91, right: 91, center: 112, height: 3.0 },
    foul: { side: 15, backstop: 17 },
    dome: false
  },
  kanenodunk: {
    id: 'kanenodunk',
    name: 'Kanenodunk Dome',
    nameJa: '金ノダンクドーム',
    fence: { left: 92, right: 92, center: 113, height: 3.4 },
    foul: { side: 16, backstop: 18 },
    dome: true
  }
};

export const parkOf = (homeTeamId: string): Park => HOME_PARKS[homeTeamId] ?? DEFAULT_PARK;

/** センター方向からの角度（ラジアン、一塁側が +）。 */
export const sprayAngle = (p: { x: number; z: number }) => Math.atan2(p.x, p.z);

/** その側（a < 0 が左翼）のポールまでの距離。 */
export const lineDistance = (a: number, park: Park = DEFAULT_PARK) => (a < 0 ? park.fence.left : park.fence.right);

/** 角度 a（ラジアン）の方向のフェンスまでの距離。両翼と中堅を cos でつなぐ。 */
export function fenceDistance(a: number, park: Park = DEFAULT_PARK): number {
  const t = Math.min(Math.abs(a), Math.PI / 4);
  const line = lineDistance(a, park);
  return line + (park.fence.center - line) * Math.cos(2 * t);
}

export const isFair = (p: { x: number; z: number }) => p.z >= Math.abs(p.x) - 1e-9;

/** ファウルラインからの距離（フェア側が負）。 */
export const distanceOutsideLine = (p: { x: number; z: number }) => (Math.abs(p.x) - p.z) / Math.SQRT2;

/** 打球がファウル地域の観客席・バックネットに入ったか。 */
export function inFoulStands(p: { x: number; z: number }, park: Park = DEFAULT_PARK): boolean {
  if (isFair(p)) return false;
  return distanceOutsideLine(p) > park.foul.side || p.z < -park.foul.backstop || Math.hypot(p.x, p.z) > lineDistance(p.x, park) + 4;
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
