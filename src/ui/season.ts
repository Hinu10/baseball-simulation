// ペナントレースの経過（順位・通算成績）を端末に保存する。計算は core/pennant.ts。
import { earnedRunAverage, type BattingLine, type PitchingLine } from '../core/gameState.ts';
import { emptyPennant, type Pennant } from '../core/pennant.ts';
import { SEASON_YEAR } from '../core/pennant.ts';

// 年度を変えても前年の端末内のペナントを次の年へ持ち越さない。
const KEY = `baseball-simulation.pennant.${SEASON_YEAR}`;
export type SeasonStats = Record<string, BattingLine>;
export type SeasonPitching = Record<string, PitchingLine>;

export function loadPennant(): Pennant {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...emptyPennant(), ...JSON.parse(raw) };
  } catch {
    // 読めなければ開幕から。
  }
  return emptyPennant();
}

export function savePennant(p: Pennant) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // 保存できなくても遊べる。
  }
}

/** 打率の表記（.285、1.000）。打数 0 は「-.---」。 */
export function formatAverage(l: BattingLine): string {
  if (!l.ab) return '-.---';
  return (l.h / l.ab).toFixed(3).replace(/^0/, '');
}

/** 防御率の表記（3.25）。投球回 0 は「-.--」。 */
export function formatEra(l: PitchingLine): string {
  const era = earnedRunAverage(l);
  return era === null ? '-.--' : era.toFixed(2);
}

/** 投球回の表記（5回1/3）。 */
export function formatInnings(outs: number): string {
  const whole = Math.floor(outs / 3);
  const rest = outs % 3;
  return rest ? `${whole}回${rest}/3` : `${whole}回`;
}
