// CPU の投球・打撃の判断。プレイヤーと同じ命令（PitchCommand・SwingCommand）を出すだけで、
// ルールや能力の計算は持たない。守備・走塁の AI は play.ts にある。

import { SWING_DURATION, type SwingCommand, type SwingMode } from './batting.ts';
import { RELEASE_POINT } from './field.ts';
import { clamp } from './math.ts';
import type { RunningStrategy } from './play.ts';
import { DEFAULT_ZONE, PITCH_TIME_SCALE, PITCHES, type Pitch, type PitchCommand } from './pitching.ts';
import type { Rng } from './rng.ts';
import type { Batter, Pitcher } from './teams.ts';
import type { PitchType } from './types.ts';

export type Difficulty = 'easy' | 'normal' | 'hard';
export type OffenseStrategy = 'aggressive' | 'normal' | 'careful';
export type PitchingStrategy = 'strike' | 'normal' | 'corner';

/** 監督モードで指示できる方針。 */
export interface Strategy {
  offense: OffenseStrategy;
  pitching: PitchingStrategy;
  running: RunningStrategy;
}

export const DEFAULT_STRATEGY: Strategy = { offense: 'normal', pitching: 'normal', running: 'normal' };

export const STRATEGY_LABEL = {
  offense: { aggressive: '積極', normal: '通常', careful: '慎重' },
  pitching: { strike: 'ストライク優先', normal: '通常', corner: '際どいコース' },
  running: { aggressive: '積極', normal: '通常', careful: '慎重' }
} as const;

export const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: 'かんたん', normal: 'ふつう', hard: 'むずかしい' };

/** CPU の打撃の誤差にかける倍率。大きいほど打てない。 */
export const DIFFICULTY_ERROR: Record<Difficulty, number> = { easy: 1.45, normal: 1.0, hard: 0.78 };

export interface Count {
  balls: number;
  strikes: number;
}

const Z = DEFAULT_ZONE;
const ZONE_MID = (Z.bottom + Z.top) / 2;

/** 投球の狙い：ど真ん中寄り・ゾーンの端・ボール球（誘い球）。 */
type Aim = 'heart' | 'edge' | 'chase';

export function choosePitch(p: Pitcher, count: Count, strategy: PitchingStrategy, rng: Rng): PitchCommand {
  const fastWeight = count.balls >= 3 ? 80 : count.strikes >= 2 ? 35 : 50;
  const others = p.pitches.filter((t) => t !== 'fastball');
  const type = rng.weighted<PitchType>([
    { value: 'fastball', weight: fastWeight },
    ...others.map((t) => ({ value: t, weight: (100 - fastWeight) / others.length }))
  ]);
  const w = { strike: { heart: 60, edge: 40, chase: 0 }, normal: { heart: 18, edge: 50, chase: 32 }, corner: { heart: 5, edge: 55, chase: 40 } }[strategy];
  const weights = { ...w };
  if (count.balls >= 3) {
    weights.chase = 0;
    weights.heart += 25;
  } else if (count.strikes >= 2 && count.balls < 2) {
    weights.chase += 25;
  }
  const aim = rng.weighted<Aim>([
    { value: 'heart', weight: weights.heart },
    { value: 'edge', weight: weights.edge },
    { value: 'chase', weight: weights.chase }
  ]);
  const side = rng.chance(0.5) ? 1 : -1;
  let x: number;
  let y: number;
  if (aim === 'heart') {
    x = rng.range(-0.12, 0.12);
    y = rng.range(ZONE_MID - 0.17, ZONE_MID + 0.17);
  } else if (aim === 'edge') {
    x = side * rng.range(0.19, 0.29);
    y = rng.range(Z.bottom + 0.02, Z.top - 0.08);
    if (rng.chance(0.35)) {
      x = rng.range(-0.2, 0.2);
      y = Z.bottom + rng.range(-0.04, 0.05);
    }
  } else {
    x = side * rng.range(0.3, 0.42);
    y = rng.range(Z.bottom - 0.05, Z.top - 0.1);
    if (rng.chance(0.4)) {
      x = rng.range(-0.2, 0.2);
      y = Z.bottom - rng.range(0.12, 0.25);
    }
  }
  // フォークは低めに、カーブは少し高めから落とす。
  if (type === 'fork') y -= 0.12;
  if (type === 'curve') y += 0.05;
  return { type, target: { x, y } };
}

export interface BatterSituation extends Count {
  outs: number;
  runnerOnFirst: boolean;
  runnerOnSecond: boolean;
  pitcherVelocity: number;
}

/**
 * CPU 打者のスイングを決める。球の見え方（変化球にだまされる）とタイミングに能力・難易度に応じた誤差が乗る。
 * null なら見送り。
 */
export function planSwing(b: Batter, pitch: Pitch, sit: BatterSituation, strategy: OffenseStrategy, errorScale: number, rng: Rng): SwingCommand | null {
  const skill = b.meet / 100;
  // 変化球は曲がる前の軌道で判断しがち。
  const deceive = 0.35 * (1 - skill * 0.5);
  const seeErr = (0.055 - 0.03 * skill) * errorScale;
  const seen = {
    x: pitch.plate.x - pitch.breakX * deceive + rng.gauss(0, seeErr),
    y: pitch.plate.y - pitch.breakY * deceive + rng.gauss(0, seeErr)
  };
  const margin = (strategy === 'aggressive' ? 0.05 : strategy === 'careful' ? -0.03 : 0) + (sit.strikes >= 2 ? 0.05 : 0);
  const inZone = Math.abs(seen.x) <= Z.halfWidth + 0.037 + margin && seen.y >= Z.bottom - 0.037 - margin && seen.y <= Z.top + 0.037 + margin;

  // 送りバント：慎重な方針、ノーアウトで一塁か二塁に走者、長打の少ない打者。
  if (strategy === 'careful' && sit.outs === 0 && (sit.runnerOnFirst || sit.runnerOnSecond) && b.power < 55 && sit.strikes < 2 && rng.chance(0.6)) {
    if (!inZone) return null;
    return { mode: 'meet', cursor: { x: seen.x, y: seen.y }, time: 0, bunt: true };
  }

  let swingP: number;
  if (inZone) swingP = strategy === 'aggressive' ? 0.8 : strategy === 'careful' ? 0.55 : 0.68;
  else swingP = strategy === 'aggressive' ? 0.25 : strategy === 'careful' ? 0.08 : 0.15;
  if (sit.balls === 3 && sit.strikes < 2) swingP *= inZone ? 0.75 : 0.4;
  if (sit.strikes >= 2) swingP = inZone ? Math.max(swingP, 0.9) : swingP + 0.08;
  if (!rng.chance(swingP)) return null;

  let mode: SwingMode = 'meet';
  if (sit.strikes < 2) {
    const threshold = strategy === 'aggressive' ? 55 : strategy === 'careful' ? 101 : 70;
    if (b.power >= threshold && sit.balls >= sit.strikes) mode = 'power';
  }
  // ストレートのつもりで待つので、遅い球にはタイミングが早くなる。
  const fastFlight = RELEASE_POINT.z / (sit.pitcherVelocity / 3.6) / PITCH_TIME_SCALE;
  const bias = -(pitch.flightTime - fastFlight) * 0.3 * (1 - skill * 0.4);
  const timeErr = (0.085 - 0.04 * skill) * errorScale;
  const cursorErr = (0.085 - 0.04 * skill) * errorScale;
  // 長打を狙う打者は球の少し下にカーソルを置いて打ち上げる。
  const lift = mode === 'power' ? 0.025 : 0.005;
  return {
    mode,
    cursor: { x: clamp(seen.x + rng.gauss(0, cursorErr), -0.6, 0.6), y: clamp(seen.y - lift + rng.gauss(0, cursorErr), 0.1, 1.5) },
    time: pitch.flightTime - SWING_DURATION + bias + rng.gauss(0, timeErr)
  };
}

export const pitchLabel = (t: PitchType) => PITCHES[t].label;
