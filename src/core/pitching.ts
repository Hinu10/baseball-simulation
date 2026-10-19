// 投球。球種とコースから、制球誤差・疲労を含めた実際の球を作り、3D の軌道を時間で評価する。

import { PLATE_Z, RELEASE_POINT } from './field.ts';
import { clamp, v3, type Vec3 } from './math.ts';
import type { Rng } from './rng.ts';
import type { Pitcher } from './teams.ts';
import type { PitchType } from './types.ts';

/** 本塁上の面（z = 0）での位置。x は一塁側が +、y は高さ（m）。 */
export interface PlatePoint {
  x: number;
  y: number;
}

export interface PitchInfo {
  label: string;
  short: string;
  /** 最高球速に対する割合。 */
  speed: number;
  /** 右投手が変化量 100 で投げたときの、到達点での変化（m）。左投手は x が逆。 */
  breakX: number;
  breakY: number;
  /** 変化の始まりの遅さ。大きいほど打者の近くで曲がる。 */
  late: number;
}

export const PITCHES: Record<PitchType, PitchInfo> = {
  fastball: { label: 'ストレート', short: '直', speed: 1, breakX: -0.04, breakY: 0.04, late: 2 },
  curve: { label: 'カーブ', short: 'カ', speed: 0.78, breakX: 0.26, breakY: -0.42, late: 2 },
  slider: { label: 'スライダー', short: 'ス', speed: 0.88, breakX: 0.34, breakY: -0.1, late: 2.4 },
  fork: { label: 'フォーク', short: 'フ', speed: 0.9, breakX: 0, breakY: -0.46, late: 3.2 }
};

/** ストライクゾーン。打者ごとに持てる形にしておき、MVP は共通サイズを使う。 */
export interface StrikeZone {
  halfWidth: number;
  bottom: number;
  top: number;
}

/** ホームベースの幅 43.2cm の半分。 */
export const PLATE_HALF_WIDTH = 0.216;
export const DEFAULT_ZONE: StrikeZone = { halfWidth: PLATE_HALF_WIDTH, bottom: 0.46, top: 1.07 };

/** 打者の身長（m）からゾーンを作る（膝頭の下〜胸のあたり）。MVP では未使用。 */
export function zoneForHeight(height: number): StrikeZone {
  return { halfWidth: PLATE_HALF_WIDTH, bottom: height * 0.26, top: height * 0.6 };
}

const BALL_R = 0.037;
/** ボールが少しでもゾーンにかかればストライク。 */
export function isStrike(zone: StrikeZone, p: PlatePoint): boolean {
  return Math.abs(p.x) <= zone.halfWidth + BALL_R && p.y >= zone.bottom - BALL_R && p.y <= zone.top + BALL_R;
}

/** コースを狙える範囲。 */
export const AIM_RANGE = { x: 0.55, yMin: 0.15, yMax: 1.45 };

/**
 * アーケード向けに投球の進行を遅くする係数。1 なら実際の速さ（時速145kmで約0.42秒）。
 * 0.55 なら同じ球が約0.77秒かかり、人が見て打てる速さになる。打者の判断も同じ時間軸で行う。
 */
export const PITCH_TIME_SCALE = 0.55;
/** 振りかぶってからリリースまで（秒）。 */
export const WINDUP_TIME = 0.7;

/** 投手がプレートの上で左右にずれられる幅（m、一塁側が +）。 */
export const PITCHER_SHIFT_RANGE = 0.3;

export interface PitchCommand {
  type: PitchType;
  target: PlatePoint;
  /** プレートを踏む位置のずれ（m、一塁側が +）。リリースの位置が同じだけずれる。 */
  shift?: number;
}

export interface Pitch {
  type: PitchType;
  speedKmh: number;
  release: Vec3;
  /** 誤差を含めた実際の通過点。 */
  plate: PlatePoint;
  /** 狙ったコース。 */
  target: PlatePoint;
  /** 到達点での変化量（m）。 */
  breakX: number;
  breakY: number;
  late: number;
  /** リリースから本塁上までの時間（ゲーム内の秒）。 */
  flightTime: number;
  /** 制球が乱れた（狙いから大きく外れた）球。 */
  missed: boolean;
}

/** 投球数とスタミナから疲労（0〜1）。スタミナ 50 でおよそ 50 球から疲れ始める。 */
export function fatigue(p: Pitcher, pitchCount: number): number {
  const capacity = 35 + 0.9 * p.stamina;
  return clamp((pitchCount - capacity * 0.6) / (capacity * 0.6), 0, 1);
}

/** コントロールと疲労による制球誤差の標準偏差（m）。 */
export function controlError(p: Pitcher, tired: number): number {
  return (0.14 - 0.105 * (p.control / 100)) * (1 + 0.7 * tired);
}

/** 制球が大きく乱れる確率。コントロールが低いほど、疲れているほど高い。 */
export function missChance(p: Pitcher, tired: number): number {
  return 0.012 + 0.06 * (1 - p.control / 100) + 0.05 * tired;
}

export function createPitch(p: Pitcher, cmd: PitchCommand, tired: number, rng: Rng): Pitch {
  const info = PITCHES[cmd.type];
  const speedKmh = p.velocity * info.speed * (1 - 0.06 * tired) * rng.range(0.97, 1.0);
  const sd = controlError(p, tired) * (cmd.type === 'fastball' ? 1 : 1.15);
  // たまに指にかからず、狙いから大きく外れる（すっぽ抜け・引っかけ・甘く入る）。
  const missed = rng.chance(missChance(p, tired));
  const angle = rng.range(0, Math.PI * 2);
  const off = missed ? rng.range(0.22, 0.45) : 0;
  const plate = {
    x: clamp(cmd.target.x + rng.gauss(0, sd) + Math.cos(angle) * off, -1.2, 1.2),
    y: clamp(cmd.target.y + rng.gauss(0, sd) + Math.sin(angle) * off, 0.05, 2.2)
  };
  const shape = pitchShape(p, cmd);
  const flightTime = (shape.release.z - PLATE_Z) / (speedKmh / 3.6) / PITCH_TIME_SCALE;
  return { ...shape, speedKmh, plate, flightTime, missed };
}

/** 球速・誤差によらない球の形（リリースの位置と変化）。 */
function pitchShape(p: Pitcher, cmd: PitchCommand) {
  const info = PITCHES[cmd.type];
  const amount = 0.45 + 0.55 * (p.breaking / 100);
  const hand = p.throws === 'R' ? 1 : -1;
  const shift = clamp(cmd.shift ?? 0, -PITCHER_SHIFT_RANGE, PITCHER_SHIFT_RANGE);
  return {
    type: cmd.type,
    release: v3(RELEASE_POINT.x * hand + shift, RELEASE_POINT.y, RELEASE_POINT.z),
    target: { ...cmd.target },
    breakX: info.breakX * amount * hand,
    breakY: info.breakY * amount,
    late: info.late
  };
}

/** 投げる前に見せる軌道。狙いどおりに投げたときの通り道（リリース → 狙ったコース）を点の列で返す。 */
export function previewPath(p: Pitcher, cmd: PitchCommand, points = 32): Vec3[] {
  const pitch: Pitch = { ...pitchShape(p, cmd), speedKmh: p.velocity, plate: { ...cmd.target }, flightTime: 1, missed: false };
  return Array.from({ length: points + 1 }, (_, i) => pitchPosition(pitch, i / points));
}

/**
 * リリースから t 秒後の位置。まっすぐ「通過点 − 変化量」に向かう線に、s^late で大きくなる変化を足す。
 * s = 1 でちょうど通過点に着く。t が flightTime を過ぎたら捕手に向かってそのまま進む。
 */
export function pitchPosition(p: Pitch, t: number): Vec3 {
  const s = t / p.flightTime;
  const aimX = p.plate.x - p.breakX;
  const aimY = p.plate.y - p.breakY;
  const k = s <= 1 ? Math.pow(Math.max(0, s), p.late) : 1 + p.late * (s - 1);
  return v3(
    p.release.x + (aimX - p.release.x) * s + p.breakX * k,
    p.release.y + (aimY - p.release.y) * s + p.breakY * k,
    p.release.z + (PLATE_Z - p.release.z) * s
  );
}
