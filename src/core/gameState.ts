// 試合状態。ルール（rules.ts）だけがこれを書き換え、表示は読むだけにする。

import { lineupOf, pitcherOf, type Batter, type Pitcher, type TeamData } from './teams.ts';

export type Half = 'top' | 'bottom';
/** 0 = 先攻（ビジター）、1 = 後攻（ホーム）。 */
export type TeamIndex = 0 | 1;
export type MatchMode = 'manual' | 'manager' | 'auto';

export interface TeamGameState {
  team: TeamData;
  lineup: Batter[];
  /** 次の打者の打順（0〜8）。 */
  battingIndex: number;
  /** イニングごとの得点。 */
  runsByInning: number[];
  hits: number;
  pitcher: Pitcher;
  pitchCount: number;
}

export interface PlayLogEntry {
  inning: number;
  half: Half;
  batterId: string;
  text: string;
  runs: number;
}

export type EndReason = 'regulation' | 'walkoff' | 'skip-bottom';

export interface GameState {
  /** 規定イニング（MVP は 3）。 */
  innings: number;
  inning: number;
  half: Half;
  outs: number;
  balls: number;
  strikes: number;
  teams: [TeamGameState, TeamGameState];
  /** 塁上の走者（選手 id）。添字 1〜3 が一塁〜三塁。0 は使わない。 */
  bases: [null, string | null, string | null, string | null];
  mode: MatchMode;
  over: boolean;
  /** 勝ったチーム。引き分けは null。 */
  winner: TeamIndex | null;
  endReason: EndReason | null;
  log: PlayLogEntry[];
}

export function createGameState(away: TeamData, home: TeamData, innings = 3, mode: MatchMode = 'manual'): GameState {
  const team = (t: TeamData): TeamGameState => ({
    team: t,
    lineup: lineupOf(t),
    battingIndex: 0,
    runsByInning: [],
    hits: 0,
    pitcher: pitcherOf(t, t.startingPitcher),
    pitchCount: 0
  });
  return {
    innings,
    inning: 1,
    half: 'top',
    outs: 0,
    balls: 0,
    strikes: 0,
    teams: [team(away), team(home)],
    bases: [null, null, null, null],
    mode,
    over: false,
    winner: null,
    endReason: null,
    log: []
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
