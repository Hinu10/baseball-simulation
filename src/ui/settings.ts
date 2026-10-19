// 設定だけを端末に保存する（試合の途中経過は保存しない）。
import type { Difficulty } from '../core/ai.ts';
import type { MatchMode } from '../core/gameState.ts';
import type { BattingControl, FieldingControl } from '../core/match.ts';

export interface Settings {
  team: string;
  /** 'home' なら後攻。 */
  side: 'away' | 'home';
  mode: MatchMode;
  /** 手動モードの守備。 */
  fielding: FieldingControl;
  /** 手動モードの打撃。 */
  batting: BattingControl;
  difficulty: Difficulty;
}

const KEY = 'baseball-simulation.settings';
export const DEFAULT_SETTINGS: Settings = { team: 'comets', side: 'home', mode: 'manual', fielding: 'manual', batting: 'easy', difficulty: 'normal' };

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    // 保存先が使えない環境では既定値で動く。
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // 保存できなくても遊べる。
  }
}
