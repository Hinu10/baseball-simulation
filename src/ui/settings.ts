// 設定を端末に保存する（試合の途中経過は ui/matchSave.ts）。
import type { Difficulty } from '../core/ai.ts';
import { SEASON_YEAR } from '../core/pennant.ts';
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
  /** 年度。現行年度はペナント、終了した年度は練習試合。 */
  year: number;
  sound: boolean;
  /** 応援席の鳴り物（トランペットと太鼓）を鳴らすか。効果音がオフなら鳴らない。 */
  ouen: boolean;
  /** 以前の保存形式。読み込み時に2026年の lineups へ移す。 */
  lineup?: LineupEdit;
  /** 年度と球団ごとのスタメン変更。過去の年の選手が他の年の打順に混ざらないよう分ける。 */
  lineups?: Record<string, LineupEdit>;
}

import type { LineupEdit } from '../core/lineupEdit.ts';

const KEY = 'baseball-simulation.settings';
export const DEFAULT_SETTINGS: Settings = { team: 'maikai', opponent: 'jogawa', side: 'home', mode: 'manual', fielding: 'manual', batting: 'easy', running: 'auto', difficulty: 'normal', innings: 3, year: SEASON_YEAR, sound: true, ouen: true };

export const lineupKey = (year: number, team: string) => `${year}:${team}`;
export const savedLineup = (settings: Settings, year = settings.year, team = settings.team): LineupEdit | undefined =>
  settings.lineups?.[lineupKey(year, team)];

export function withSavedLineup(settings: Settings, edit: LineupEdit | undefined): Settings {
  const key = lineupKey(settings.year, settings.team);
  const lineups = { ...settings.lineups };
  if (edit) lineups[key] = edit;
  else delete lineups[key];
  return { ...settings, lineups, lineup: undefined };
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const settings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } as Settings;
      if (settings.lineup) return {
        ...settings,
        lineups: { [lineupKey(2026, settings.lineup.team)]: settings.lineup, ...settings.lineups },
        lineup: undefined
      };
      return settings;
    }
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
