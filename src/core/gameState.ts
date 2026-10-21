// 試合状態。ルール（rules.ts）だけがこれを書き換え、表示は読むだけにする。

import { lineupOf, pitcherOf, type Batter, type Pitcher, type TeamData } from './teams.ts';
import type { LineupPosition } from './types.ts';

export type Half = 'top' | 'bottom';
/** 0 = 先攻（ビジター）、1 = 後攻（ホーム）。 */
export type TeamIndex = 0 | 1;
export type MatchMode = 'manual' | 'manager' | 'auto';

export interface TeamGameState {
  team: TeamData;
  lineup: Batter[];
  /** 打順ごとの守備位置。交代で入った選手は、その打順の守備位置を引き継ぐ。 */
  positions: LineupPosition[];
  /** 次の打者の打順（0〜8）。 */
  battingIndex: number;
  /** イニングごとの得点。 */
  runsByInning: number[];
  hits: number;
  pitcher: Pitcher;
  /** いまの投手の球数。投手が代わると 0 から数える。 */
  pitchCount: number;
  /** 交代で試合から退いた選手の id。再出場はできない。 */
  removed: string[];
}

export interface PlayLogEntry {
  inning: number;
  half: Half;
  batterId: string;
  text: string;
  runs: number;
}

/** 打撃成績（打席・打数・安打・本塁打・打点）。 */
export interface BattingLine {
  pa: number;
  ab: number;
  h: number;
  hr: number;
  rbi: number;
  /** 四球・三振・盗塁と、出場した試合数（ペナントの通算で数える）。以前の保存データには無いことがある。 */
  bb?: number;
  so?: number;
  sb?: number;
  g?: number;
}

export const emptyLine = (): BattingLine => ({ pa: 0, ab: 0, h: 0, hr: 0, rbi: 0, bb: 0, so: 0, sb: 0, g: 0 });

/** 打率。打数 0 なら null。 */
export const battingAverage = (l: BattingLine): number | null => (l.ab ? l.h / l.ab : null);

/** 成績を足し合わせる。 */
export function addLines(a: BattingLine, b: BattingLine): BattingLine {
  const n = (k: 'bb' | 'so' | 'sb' | 'g') => (a[k] ?? 0) + (b[k] ?? 0);
  return { pa: a.pa + b.pa, ab: a.ab + b.ab, h: a.h + b.h, hr: a.hr + b.hr, rbi: a.rbi + b.rbi, bb: n('bb'), so: n('so'), sb: n('sb'), g: n('g') };
}

/** 投手成績（アウト数・失点・被安打・奪三振・与四球・勝敗）。失点はすべて自責点として扱う。 */
export interface PitchingLine {
  outs: number;
  r: number;
  h: number;
  so: number;
  bb: number;
  w: number;
  l: number;
  /** 登板した試合数（ペナントの通算で数える）。以前の保存データには無いことがある。 */
  g?: number;
}

export const emptyPitchingLine = (): PitchingLine => ({ outs: 0, r: 0, h: 0, so: 0, bb: 0, w: 0, l: 0, g: 0 });

/** 投手成績を足し合わせる。 */
export function addPitchingLines(a: PitchingLine, b: PitchingLine): PitchingLine {
  return { outs: a.outs + b.outs, r: a.r + b.r, h: a.h + b.h, so: a.so + b.so, bb: a.bb + b.bb, w: a.w + b.w, l: a.l + b.l, g: (a.g ?? 0) + (b.g ?? 0) };
}

/** 防御率（9回あたりの失点）。投球回 0 なら null。 */
export const earnedRunAverage = (l: PitchingLine): number | null => (l.outs ? (l.r * 27) / l.outs : null);

export type EndReason = 'regulation' | 'walkoff' | 'skip-bottom';

/** 選べる規定イニング。 */
export const INNINGS_OPTIONS = [3, 7, 9] as const;
export type Innings = (typeof INNINGS_OPTIONS)[number];
/** 規定イニングごとに許す延長の回数。 */
export const EXTRA_INNINGS: Record<Innings, number> = { 3: 1, 7: 2, 9: 3 };

export interface GameState {
  /** 規定イニング。 */
  innings: number;
  /** 規定回で同点のときに続ける延長の回数（0 なら延長なし）。 */
  extraInnings: number;
  inning: number;
  half: Half;
  outs: number;
  balls: number;
  strikes: number;
  teams: [TeamGameState, TeamGameState];
  /** 塁上の走者（選手 id）。添字 1〜3 が一塁〜三塁。0 は使わない。 */
  bases: [null, string | null, string | null, string | null];
  /** 走者（選手 id）を出塁させた投手の id。その走者がかえったら、この投手の失点にする。以前の保存データには無い。 */
  responsible?: Record<string, string>;
  mode: MatchMode;
  over: boolean;
  /** 勝ったチーム。引き分けは null。 */
  winner: TeamIndex | null;
  endReason: EndReason | null;
  log: PlayLogEntry[];
  /** この試合の打撃成績（選手 id ごと）。 */
  batting: Record<string, BattingLine>;
  /** この試合の投手成績（選手 id ごと）。 */
  pitching: Record<string, PitchingLine>;
  /** 最後にリードを奪ったときの勝利投手・敗戦投手の候補。試合終了で勝敗をつける。 */
  decision: { win: string; lose: string } | null;
}

export function createGameState(away: TeamData, home: TeamData, innings = 3, mode: MatchMode = 'manual', extraInnings = 0): GameState {
  const team = (t: TeamData): TeamGameState => ({
    team: t,
    lineup: lineupOf(t),
    positions: lineupOf(t).map((b) => b.position),
    battingIndex: 0,
    runsByInning: [],
    hits: 0,
    pitcher: pitcherOf(t, t.startingPitcher),
    pitchCount: 0,
    removed: []
  });
  return {
    innings,
    extraInnings,
    inning: 1,
    half: 'top',
    outs: 0,
    balls: 0,
    strikes: 0,
    teams: [team(away), team(home)],
    bases: [null, null, null, null],
    responsible: {},
    mode,
    over: false,
    winner: null,
    endReason: null,
    log: [],
    batting: {},
    pitching: {},
    decision: null
  };
}

export const battingTeam = (s: GameState): TeamIndex => (s.half === 'top' ? 0 : 1);
export const fieldingTeam = (s: GameState): TeamIndex => (s.half === 'top' ? 1 : 0);

export function score(s: GameState, t: TeamIndex): number {
  return s.teams[t].runsByInning.reduce((a, b) => a + b, 0);
}

export function currentBatter(s: GameState): Batter {
  const t = s.teams[battingTeam(s)];
  return t.lineup[t.battingIndex];
}

/** いまの打者の守備位置。 */
export function currentBatterPosition(s: GameState): LineupPosition {
  const t = s.teams[battingTeam(s)];
  return t.positions[t.battingIndex];
}

/** 控えの野手（打順に入っておらず、まだ退いていない）。 */
export function benchBatters(t: TeamGameState): Batter[] {
  return t.team.batters.filter((b) => !t.lineup.includes(b) && !t.removed.includes(b.id));
}

/** 控えの投手（登板中でなく、まだ退いていない）。 */
export function benchPitchers(t: TeamGameState): Pitcher[] {
  return t.team.pitchers.filter((p) => p !== t.pitcher && !t.removed.includes(p.id));
}

export function currentPitcher(s: GameState): Pitcher {
  return s.teams[fieldingTeam(s)].pitcher;
}

export function findBatter(s: GameState, id: string): Batter | undefined {
  for (const t of s.teams) {
    const b = t.team.batters.find((x) => x.id === id);
    if (b) return b;
  }
  return undefined;
}

export function runnersOn(s: GameState): number {
  return s.bases.filter((b) => b).length;
}
