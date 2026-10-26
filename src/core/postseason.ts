// ポストシーズン。両リーグのファイナル（結果だけを残す）を勝ち上がった2球団で、ニーマシリーズを1試合ずつ戦う。
// 本拠地の決まりと勝ち抜けの数は、過去のシーズンのシリーズ（history.ts の playSeries）と同じ。
import { addLines, addPitchingLines, emptyLine, emptyPitchingLine, type BattingLine, type GameState, type PitchingLine } from './gameState.ts';
import { emptyRecord, leagues, standings, winPct, type GameResult, type Pennant } from './pennant.ts';
import { roleOf, type PitcherRole, type TeamData } from './teams.ts';

/** 日本シリーズにあたる、両リーグのファイナルを勝ち上がった球団どうしのシリーズ。 */
export const SERIES_NAME = 'ニーマシリーズ';
/** 先に4勝したほうが優勝。引き分けがあれば第8戦まで行う。 */
export const SERIES_WINS = 4;
export const SERIES_MAX_GAMES = 8;

export interface SeriesGame extends GameResult {
  /** 何戦目か（1 から）。 */
  n: number;
  /** 先攻・後攻のイニングごとの得点と安打。以前の保存データや過去のシーズンの記録には無い。 */
  innings?: [number[], number[]];
  hits?: [number, number];
  /** その試合の打者ごと（id）の成績。打席に入った順に並ぶ。 */
  batting?: Record<string, BattingLine>;
}

/** リーグのファイナル（リーグ優勝チームにアドバンテージ1勝）。結果だけを残す。 */
export interface FinalResult {
  league: string;
  winner: string;
  loser: string;
  /** 勝ち上がった球団と敗れた球団の勝ち数（アドバンテージを含む）。 */
  wins: [number, number];
}

export interface Postseason {
  finals: FinalResult[];
  /** ニーマシリーズの2球団。first が第1・2・6・7戦の本拠地（第3〜5戦と第8戦は second）。 */
  first: string;
  second: string;
  games: SeriesGame[];
  /** シリーズの選手ごと（id）の成績。シーズンの成績とは別に数える。以前の保存データには無い。 */
  batting?: Record<string, BattingLine>;
  pitching?: Record<string, PitchingLine>;
  /** 成績に出てくる選手の名前と球団。 */
  players?: Record<string, { name: string; team: string; role?: PitcherRole }>;
}

/** n 戦目の本拠地。 */
export const seriesHome = (ps: Postseason, n: number) => ([1, 2, 6, 7].includes(n) ? ps.first : ps.second);

export interface SeriesStatus {
  /** first・second の勝ち数。 */
  wins: [number, number];
  ties: number;
  /** 決まっていなければ null。 */
  winner: string | null;
  /** 次の試合（終わっていれば null）。 */
  next: { n: number; away: string; home: string } | null;
}

export function seriesStatus(ps: Postseason): SeriesStatus {
  const wins: [number, number] = [0, 0];
  let ties = 0;
  for (const g of ps.games) {
    if (g.awayRuns === g.homeRuns) ties++;
    else wins[(g.awayRuns > g.homeRuns ? g.away : g.home) === ps.first ? 0 : 1]++;
  }
  const played = ps.games.length;
  const over = Math.max(...wins) >= SERIES_WINS || played >= SERIES_MAX_GAMES;
  // 第8戦まで行って勝ち数が並べば、本拠地の多い first の優勝とする。
  const winner = over ? (wins[0] >= wins[1] ? ps.first : ps.second) : null;
  if (over) return { wins, ties, winner, next: null };
  const n = played + 1;
  const home = seriesHome(ps, n);
  return { wins, ties, winner, next: { n, home, away: home === ps.first ? ps.second : ps.first } };
}

/** 終わった試合をシリーズに足す。試合の状態 s を渡せば、イニングごとの得点と選手の成績も残す。シリーズが終わっていれば足さない。 */
export function addSeriesGame(ps: Postseason, g: GameResult, s?: GameState): Postseason {
  const { next } = seriesStatus(ps);
  if (!next) return ps;
  if (!s) return { ...ps, games: [...ps.games, { n: next.n, ...g }] };
  const game: SeriesGame = { n: next.n, ...g, innings: [[...s.teams[0].runsByInning], [...s.teams[1].runsByInning]], hits: [s.teams[0].hits, s.teams[1].hits], batting: structuredClone(s.batting) };
  const batting = { ...ps.batting };
  const pitching = { ...ps.pitching };
  const players = { ...ps.players };
  for (const [id, line] of Object.entries(s.batting)) batting[id] = addLines(batting[id] ?? emptyLine(), { ...line, g: 1 });
  for (const [id, line] of Object.entries(s.pitching)) pitching[id] = addPitchingLines(pitching[id] ?? emptyPitchingLine(), { ...line, g: 1 });
  for (const t of s.teams) {
    for (const p of t.team.batters) if (s.batting[p.id]) players[p.id] = { name: p.name, team: t.team.id };
    for (const p of t.team.pitchers) if (s.batting[p.id] || s.pitching[p.id]) players[p.id] = { name: p.name, team: t.team.id, role: roleOf(p) };
  }
  return { ...ps, games: [...ps.games, game], batting, pitching, players };
}

/**
 * ニーマシリーズを始める。ファイナルを渡さなければ両リーグの優勝チームどうし。
 * 勝率の高いほうが first（本拠地が多い）。
 */
export function startPostseason(p: Pennant, teams: TeamData[], finals: FinalResult[] = []): Postseason {
  const [a, b] = leagues(teams).map((l) => finals.find((f) => f.league === l.name)?.winner ?? standings(p, l.teams)[0].team.id);
  const pct = (id: string) => winPct(p.teams[id] ?? emptyRecord());
  const [first, second] = pct(a) >= pct(b) ? [a, b] : [b, a];
  return { finals, first, second, games: [] };
}
