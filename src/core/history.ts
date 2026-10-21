// 過去のシーズン。ゲームと同じ仕組み（試合・日程・調子・公示）で1シーズンを通して行い、順位・タイトル・ニーマシリーズを残す。
// 1シーズンは数分かかるので、ゲームの中では行わず scripts/history.ts で作って src/data/history.json に保存する。
import { conditionedTeam, initialConditions } from './condition.ts';
import { score, type GameState } from './gameState.ts';
import { managedTeam } from './manager.ts';
import { Match } from './match.ts';
import { addGame, advanceDay, emptyPennant, emptyRecord, gamesPlayed, leagues, pairOthers, seasonOver, standings, syncRosters, titleRaces, winPct, type GameResult, type Pennant } from './pennant.ts';
import { registeredTeam } from './registration.ts';
import { rotationStarter, type TeamData } from './teams.ts';

/** 日本シリーズにあたる、両リーグの優勝チームによる7回戦制のシリーズ。 */
export const SERIES_NAME = 'ニーマシリーズ';
/** 先に4勝したほうが優勝。引き分けがあれば第8戦まで行う。 */
export const SERIES_WINS = 4;
export const SERIES_MAX_GAMES = 8;

export interface HistoryRow {
  team: string;
  w: number;
  l: number;
  t: number;
  rs: number;
  ra: number;
  /** 首位とのゲーム差。 */
  gb: number;
}

export interface HistoryTitle {
  league: string;
  label: string;
  /** 上位（1位から、TITLE_TOP 人まで）。 */
  leaders: { name: string; team: string; value: string }[];
}

/** タイトルごとに残す人数。 */
export const TITLE_TOP = 3;

export interface SeriesGame extends GameResult {
  /** 何戦目か（1 から）。 */
  n: number;
}

export interface SeriesResult {
  name: string;
  /** 対戦した2球団（先に書いたほうが第1戦の本拠地）。 */
  teams: [string, string];
  wins: [number, number];
  ties: number;
  winner: string;
  games: SeriesGame[];
}

export interface Season {
  year: number;
  leagues: { name: string; rows: HistoryRow[] }[];
  titles: HistoryTitle[];
  series: SeriesResult;
}

/** その日の球団：公示・調子を反映し、ローテーションの先発を立て、CPU の監督が打順を整える（ゲームの他球場の試合と同じ）。 */
function todayTeam(p: Pennant, t: TeamData, starts: number): TeamData {
  const reg = registeredTeam(t, p.registrations[t.id], p.day);
  const team = { ...conditionedTeam(reg, p.condition), startingPitcher: rotationStarter(reg, starts) };
  return managedTeam(team).team;
}

const resultOf = (g: GameState): GameResult => ({ away: g.teams[0].team.id, home: g.teams[1].team.id, awayRuns: score(g, 0), homeRuns: score(g, 1) });

/**
 * 1シーズン（全球団 143 試合）を行う。onDay は進み具合の知らせ（日数）。
 * random は日程・調子・公示に、seed は各試合の乱数に使う。
 */
export function playSeason(teams: TeamData[], o: { random?: () => number; seed?: number; onDay?: (day: number) => void } = {}): Pennant {
  const random = o.random ?? Math.random;
  let seed = o.seed ?? 1;
  let p: Pennant = syncRosters({ ...emptyPennant(), condition: initialConditions(teams, random) }, teams);
  // 試合数がそろわないなどで終わらないときの安全弁。
  for (let guard = 0; guard < 400 && !seasonOver(p, teams); guard++) {
    const games: GameState[] = [];
    let next = p;
    for (const [away, home] of pairOthers(p, teams, [], random)) {
      const starts = (t: TeamData) => gamesPlayed(p.teams[t.id] ?? emptyRecord());
      const m = new Match({ away: todayTeam(p, away, starts(away)), home: todayTeam(p, home, starts(home)), innings: 9, mode: 'auto', difficulty: 'normal', seed: seed++ });
      m.skipToEnd();
      next = addGame(next, m.state);
      games.push(m.state);
    }
    p = advanceDay({ ...next, lastRound: games.map(resultOf) }, teams, games, random);
    o.onDay?.(p.day);
  }
  return p;
}

/**
 * 両リーグの優勝チームによるニーマシリーズ。勝率の高いほうが第1・2・6・7戦の本拠地（第3〜5戦と第8戦は相手）。
 * 先発はシーズンの続きのローテーションで回す。
 */
export function playSeries(p: Pennant, a: TeamData, b: TeamData, seed = 1): SeriesResult {
  const [first, second] = winPct(p.teams[a.id] ?? emptyRecord()) >= winPct(p.teams[b.id] ?? emptyRecord()) ? [a, b] : [b, a];
  const wins: [number, number] = [0, 0];
  let ties = 0;
  const games: SeriesGame[] = [];
  const base = (t: TeamData) => gamesPlayed(p.teams[t.id] ?? emptyRecord());
  for (let n = 1; n <= SERIES_MAX_GAMES && Math.max(...wins) < SERIES_WINS; n++) {
    const home = [1, 2, 6, 7].includes(n) ? first : second;
    const away = home === first ? second : first;
    const m = new Match({ away: todayTeam(p, away, base(away) + n - 1), home: todayTeam(p, home, base(home) + n - 1), innings: 9, mode: 'auto', difficulty: 'normal', seed: seed + n });
    m.skipToEnd();
    const g = { n, ...resultOf(m.state) };
    games.push(g);
    if (g.awayRuns === g.homeRuns) ties++;
    else {
      const winner = g.awayRuns > g.homeRuns ? g.away : g.home;
      wins[winner === first.id ? 0 : 1]++;
    }
  }
  return { name: SERIES_NAME, teams: [first.id, second.id], wins, ties, winner: wins[0] >= wins[1] ? first.id : second.id, games };
}

/** 終わったシーズンを、順位・主なタイトル・シリーズの記録にまとめる。 */
export function summarizeSeason(year: number, p: Pennant, teams: TeamData[], series: SeriesResult): Season {
  const ls = leagues(teams);
  const titles: HistoryTitle[] = [];
  for (const l of ls) {
    const races = titleRaces(p, l.teams, TITLE_TOP);
    for (const race of [...races.batting, ...races.pitching]) {
      titles.push({ league: l.name, label: race.label, leaders: race.leaders.map((x) => ({ name: x.name, team: x.team.id, value: race.format(x.value) })) });
    }
  }
  return {
    year,
    leagues: ls.map((l) => ({
      name: l.name,
      rows: standings(p, l.teams).map((r) => ({ team: r.team.id, w: r.record.w, l: r.record.l, t: r.record.t, rs: r.record.rs, ra: r.record.ra, gb: r.gamesBehind }))
    })),
    titles,
    series
  };
}
