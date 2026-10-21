// 設定だけを端末に保存する（試合の途中経過は保存しない）。
import type { Difficulty } from '../core/ai.ts';
import type { Innings, MatchMode } from '../core/gameState.ts';
import type { BattingControl, FieldingControl, RunningControl } from '../core/match.ts';

export interface Settings {
  team: string;
  /** 相手の球団。あなたのチームと同じなら、別の球団に読み替える。 */
  opponent: string;
  /** 'home' なら後攻。 */
  side: 'away' | 'home';
  mode: MatchMode;
  /** 手動モードの守備。 */
  fielding: FieldingControl;
  /** 手動モードの打撃。 */
  batting: BattingControl;
  /** 手動モードの走塁。 */
  running: RunningControl;
  difficulty: Difficulty;
  /** 規定イニング。延長の回数はこれで決まる。 */
  innings: Innings;
  sound: boolean;
}

const KEY = 'baseball-simulation.settings';
export const DEFAULT_SETTINGS: Settings = { team: 'maikai', opponent: 'jogawa', side: 'home', mode: 'manual', fielding: 'manual', batting: 'easy', running: 'auto', difficulty: 'normal', innings: 3, sound: true };

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
