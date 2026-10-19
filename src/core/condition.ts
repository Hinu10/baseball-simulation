// 選手の調子。1試合ごとに少しずつ変わり、好調・不調はしばらく続いて、だんだん普通にもどる。
// 調子は -1（絶不調）〜 +1（絶好調）。試合には、調子で能力を上下させた選手を渡す。

import { clamp } from './math.ts';
import type { BattingLine, PitchingLine } from './gameState.ts';
import type { Batter, Pitcher, TeamData } from './teams.ts';

export type Conditions = Record<string, number>;

/** 前の試合の調子をどれだけ引き継ぐか（大きいほど好不調が長く続く）。 */
const CARRY = 0.75;
/** 1試合ごとの調子のゆらぎ（標準偏差）。 */
const DRIFT = 0.35;

export const CONDITION_LEVELS = [
  { min: 0.6, label: '絶好調', mark: '⇧', cls: 'c-best' },
  { min: 0.2, label: '好調', mark: '↗', cls: 'c-good' },
  { min: -0.2, label: '普通', mark: '→', cls: 'c-normal' },
  { min: -0.6, label: '不調', mark: '↘', cls: 'c-bad' },
  { min: -Infinity, label: '絶不調', mark: '⇩', cls: 'c-worst' }
] as const;

export type ConditionLevel = (typeof CONDITION_LEVELS)[number];

export function conditionLevel(c: number): ConditionLevel {
  return CONDITION_LEVELS.find((l) => c >= l.min)!;
}

/** 標準正規分布の乱数（Box–Muller）。 */
function gauss(random: () => number): number {
  return Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
}

const playerIds = (teams: TeamData[]) => teams.flatMap((t) => [...t.batters, ...t.pitchers].map((p) => p.id));

/** 開幕時の調子（ばらつかせておく）。 */
export function initialConditions(teams: TeamData[], random: () => number = Math.random): Conditions {
  return Object.fromEntries(playerIds(teams).map((id) => [id, clamp(gauss(random) * 0.45, -1, 1)]));
}

/** 試合の結果が調子に少し跳ね返る（打てば乗ってくる、打たれれば落ちる）。 */
function feedback(b: BattingLine | undefined, p: PitchingLine | undefined): number {
  let f = 0;
  if (b && b.ab) f += 0.1 * (b.h - 0.27 * b.ab) + 0.05 * b.hr;
  if (p && p.outs) f += 0.05 * (p.outs / 3 - 1.5 * p.r) / Math.max(1, p.outs / 9);
  return clamp(f, -0.25, 0.25);
}

/** 1試合（1日）たったあとの調子。batting・pitching はその日の成績（出場しなかった選手はなし）。 */
export function nextConditions(
  prev: Conditions,
  teams: TeamData[],
  batting: Record<string, BattingLine>,
  pitching: Record<string, PitchingLine>,
  random: () => number = Math.random
): Conditions {
  return Object.fromEntries(
    playerIds(teams).map((id) => [id, clamp(CARRY * (prev[id] ?? 0) + DRIFT * gauss(random) + feedback(batting[id], pitching[id]), -1, 1)])
  );
}

const rating = (v: number) => clamp(Math.round(v), 0, 100);

/** 調子で上下させた今日の野手。ミート ±10、パワー ±8。 */
export function conditionedBatter(b: Batter, c: number): Batter {
  return { ...b, meet: rating(b.meet + 10 * c), power: rating(b.power + 8 * c), condition: c };
}

/** 調子で上下させた今日の投手。球速 ±3km/h、コントロール ±10、変化球 ±8。スタミナは変わらない。 */
export function conditionedPitcher(p: Pitcher, c: number): Pitcher {
  return { ...p, velocity: Math.round(p.velocity + 3 * c), control: rating(p.control + 10 * c), breaking: rating(p.breaking + 8 * c), condition: c };
}

/** 選手の調子を反映した今日の球団。 */
export function conditionedTeam(t: TeamData, conditions: Conditions): TeamData {
  return {
    ...t,
    batters: t.batters.map((b) => conditionedBatter(b, conditions[b.id] ?? 0)),
    pitchers: t.pitchers.map((p) => conditionedPitcher(p, conditions[p.id] ?? 0))
  };
}
