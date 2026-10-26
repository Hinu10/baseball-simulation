// 試合の途中経過を端末に保存する。開き直したり、途中でメニューに戻ったりしても、続きから遊べる。
// 新しい試合を始めるか、試合が終わったら消す。
import type { MatchSnapshot } from '../core/match.ts';

const KEY = 'baseball-simulation.match';

export interface SavedMatch {
  /** 試合の年度（いまのシーズンならペナント・ニーマシリーズの試合）。 */
  year: number;
  snapshot: MatchSnapshot;
}

export function loadMatch(): SavedMatch | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as SavedMatch) : null;
  } catch {
    return null;
  }
}

export function saveMatch(m: SavedMatch) {
  try {
    localStorage.setItem(KEY, JSON.stringify(m));
  } catch {
    // 保存できなくても遊べる。
  }
}

export function clearMatch() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // 消せなくても遊べる。
  }
}
