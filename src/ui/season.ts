// ペナントレースの経過（順位・通算成績）を端末に保存する。計算は core/pennant.ts。
import type { BattingLine } from '../core/gameState.ts';
import { emptyPennant, type Pennant } from '../core/pennant.ts';

const KEY = 'baseball-simulation.pennant';
export type SeasonStats = Record<string, BattingLine>;

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
