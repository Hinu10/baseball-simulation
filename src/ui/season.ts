// 通算の打撃成績を端末に保存する（ペナントレースのように試合をまたいで積み上がる）。
import { addLines, emptyLine, type BattingLine, type GameState } from '../core/gameState.ts';

const KEY = 'baseball-simulation.season';
export type SeasonStats = Record<string, BattingLine>;

export function loadSeason(): SeasonStats {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as SeasonStats;
  } catch {
    // 読めなければ通算 0 から。
  }
  return {};
}

/** 終わった試合の成績を通算に足して保存する。 */
export function addGameToSeason(season: SeasonStats, s: GameState): SeasonStats {
  const next = { ...season };
  for (const [id, line] of Object.entries(s.batting)) next[id] = addLines(next[id] ?? emptyLine(), line);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // 保存できなくても遊べる。
  }
  return next;
}

/** 打率の表記（.285、1.000）。打数 0 は「-.---」。 */
export function formatAverage(l: BattingLine): string {
  if (!l.ab) return '-.---';
  return (l.h / l.ab).toFixed(3).replace(/^0/, '');
}
