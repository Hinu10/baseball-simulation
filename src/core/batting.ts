// 打撃。ミートカーソルとスイングのタイミングから打球の初速ベクトルを作る。
// ヒットかアウトかはここでは決めない。打球物理（ballPhysics.ts）と守備・走塁（play.ts）の結果で決まる。

import { clamp, rad, v3, type Vec3 } from './math.ts';
import type { Pitch, PlatePoint } from './pitching.ts';
import type { Rng } from './rng.ts';
import type { Batter } from './teams.ts';

export type SwingMode = 'meet' | 'power';

export interface SwingCommand {
  mode: SwingMode;
  cursor: PlatePoint;
  /** スイングを始めた時刻（リリースからの秒）。バントでは使わない。 */
  time: number;
  bunt?: boolean;
}

/** スイングを始めてからバットが本塁上に来るまで（ゲーム内の秒）。 */
export const SWING_DURATION = 0.16;
const BALL_R = 0.037;

/** ミートカーソルの大きさ（横・縦の半径 m）。ミート能力で大きく、強振で小さくなる。 */
export function cursorSize(b: Batter, mode: SwingMode): { halfW: number; halfH: number } {
  const r = (0.075 + 0.075 * (b.meet / 100)) * (mode === 'power' ? 0.62 : 1);
  return { halfW: r * 1.35, halfH: r * 0.85 };
}

/** 当たるタイミングの幅（±秒）。 */
export function timingWindow(b: Batter, mode: SwingMode): number {
  return (0.07 + 0.05 * (b.meet / 100)) * (mode === 'power' ? 0.78 : 1);
}

export type SwingOutcome =
  | { kind: 'miss' }
  | {
      kind: 'contact';
      origin: Vec3;
      velocity: Vec3;
      exitSpeed: number;
      /** 打球角度（度、上が +）と方向（度、一塁側が +）。 */
      launch: number;
      spray: number;
      /** 当たりの質（0〜1.06）。芯で捉えると 1 を超える。 */
      quality: number;
      sweet: boolean;
    };

const toVelocity = (speed: number, launch: number, spray: number): Vec3 =>
  v3(speed * Math.cos(rad(launch)) * Math.sin(rad(spray)), speed * Math.sin(rad(launch)), speed * Math.cos(rad(launch)) * Math.cos(rad(spray)));

function contact(pitch: Pitch, exitSpeed: number, launch: number, spray: number, quality: number, sweet: boolean): SwingOutcome {
  return {
    kind: 'contact',
    origin: v3(pitch.plate.x, Math.max(0.2, pitch.plate.y), 0.45),
    velocity: toVelocity(exitSpeed, launch, spray),
    exitSpeed,
    launch,
    spray,
    quality,
    sweet
  };
}

function bunt(b: Batter, pitch: Pitch, swing: SwingCommand, rng: Rng): SwingOutcome {
  const dx = pitch.plate.x - swing.cursor.x;
  const dy = pitch.plate.y - swing.cursor.y;
  if (Math.abs(dx) > 0.3 || Math.abs(dy) > 0.18) return { kind: 'miss' };
  // バットより上に来た球はフライになりやすい。
  const launch = dy > 0.08 ? rng.range(25, 55) : rng.range(-18, -4);
  const speed = rng.range(6, 10) + 4 * (Math.abs(dx) / 0.3);
  const spray = rng.gauss(0, 22) + (b.bats === 'R' ? -4 : 4);
  return contact(pitch, speed, launch, spray, 0.3, false);
}

export function evaluateSwing(b: Batter, pitch: Pitch, swing: SwingCommand, rng: Rng): SwingOutcome {
  if (swing.bunt) return bunt(b, pitch, swing, rng);
  const window = timingWindow(b, swing.mode);
  const timing = swing.time + SWING_DURATION - pitch.flightTime;
  if (Math.abs(timing) > window) return { kind: 'miss' };
  const size = cursorSize(b, swing.mode);
  const nx = (pitch.plate.x - swing.cursor.x) / (size.halfW + BALL_R);
  const ny = (pitch.plate.y - swing.cursor.y) / (size.halfH + BALL_R);
  const off = Math.hypot(nx, ny);
  if (off > 1) return { kind: 'miss' };
  const nt = timing / window;

  const sweet = off < 0.3 && Math.abs(nt) < 0.3;
  const quality = clamp(1 - 0.5 * off * off - 0.35 * nt * nt, 0.15, 1) * (sweet ? 1.06 : 1);
  const base = (33 + 15 * (b.power / 100)) * (swing.mode === 'power' ? 1.1 : 0.96);
  const exitSpeed = Math.max(4, base * quality + (pitch.speedKmh / 3.6) * 0.08 + rng.gauss(0, 1));

  // カーソルの中心より球が上なら、バットが球の下をたたいて打球が上がる。
  let launch = 11 + 40 * ny + (swing.mode === 'power' ? 4 : 0) + (b.power - 50) * 0.06 + rng.gauss(0, 4);
  // 早く振れば引っ張り、遅れれば流し方向。外角の球は流し方向に飛びやすい（右打者・左打者とも x の符号で同じ式になる）。
  const pull = b.bats === 'R' ? 1 : -1;
  let spray = pull * nt * 60 + 14 * (pitch.plate.x / 0.25) + rng.gauss(0, 6);
  // カーソルの端で当たると打球が散る（ファウルチップ・ファウルになりやすい）。
  if (off > 0.65 && rng.chance((off - 0.65) * 2.2)) {
    // かすった当たりは後ろや横へ飛ぶファウルになる。
    const back = rng.chance(0.6);
    launch = rng.range(back ? 15 : 30, back ? 70 : 75);
    spray = back ? 180 + rng.gauss(0, 35) : (rng.chance(0.5) ? 1 : -1) * rng.range(55, 100);
    return contact(pitch, rng.range(12, 26), launch, spray, quality * 0.5, false);
  }
  launch = clamp(launch, -40, 80);
  return contact(pitch, exitSpeed, launch, spray, quality, sweet);
}

export type BattedBallType = 'ground' | 'liner' | 'fly' | 'popup';

/** 表示用の打球の分類（結果を決めるのは物理）。 */
export function battedBallType(launch: number): BattedBallType {
  if (launch < 8) return 'ground';
  if (launch < 22) return 'liner';
  if (launch < 52) return 'fly';
  return 'popup';
}

export const BATTED_BALL_LABEL: Record<BattedBallType, string> = { ground: 'ゴロ', liner: 'ライナー', fly: 'フライ', popup: 'ポップフライ' };
