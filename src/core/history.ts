// 過去のシーズン。ゲームと同じ仕組み（試合・日程・調子・公示）で1シーズンを通して行い、順位・タイトル・ニーマシリーズを残す。
// 1シーズンは数分かかるので、ゲームの中では行わず scripts/history.ts で作って src/data/history.json に保存する。
import { conditionedTeam, initialConditions } from './condition.ts';
import { score, type BattingLine, type GameState, type PitchingLine } from './gameState.ts';
import { managedTeam } from './manager.ts';
import { Match } from './match.ts';
import { addGame, advanceDay, emptyPennant, emptyRecord, gamesPlayed, leagues, pairOthers, seasonOver, standings, syncRosters, titleRaces, winPct, type GameResult, type Pennant } from './pennant.ts';
import { registeredTeam } from './registration.ts';
import { renameSwapped } from './seasons.ts';
import { rotationStarter, type TeamData } from './teams.ts';

import { SERIES_MAX_GAMES, SERIES_NAME, SERIES_WINS, type SeriesGame } from './postseason.ts';

export { SERIES_MAX_GAMES, SERIES_NAME, SERIES_WINS, type SeriesGame };

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
  /** 選手ごと（id）のその年の成績。以前に作った記録には無いことがある。 */
  stats?: { batting: Record<string, BattingLine>; pitching: Record<string, PitchingLine> };
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
 * random は日程・調子・公示に、seed は各試合の乱数に使う。untilGames を渡すと、全球団がその試合数に届いたところで止める。
 */
export function playSeason(teams: TeamData[], o: { random?: () => number; seed?: number; onDay?: (day: number) => void; untilGames?: number } = {}): Pennant {
  const random = o.random ?? Math.random;
  let seed = o.seed ?? 1;
  let p: Pennant = syncRosters({ ...emptyPennant(), condition: initialConditions(teams, random) }, teams);
  // 試合数がそろわないなどで終わらないときの安全弁。
  const reached = () => o.untilGames !== undefined && teams.every((t) => gamesPlayed(p.teams[t.id] ?? emptyRecord()) >= o.untilGames!);
  for (let guard = 0; guard < 400 && !seasonOver(p, teams) && !reached(); guard++) {
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

/**
 * シーズン後に球団を離れた選手のその年の記録。teams.json にいないのでシミュレーションでは作り直せず、
 * タイトルの表にあとから書き足す（addFormerPlayers）。値はタイトルの表と同じ書き方。
 */
export interface FormerPlayer {
  year: number;
  /** その年の顔ぶれ（core/seasons.ts の PAST_ROSTERS）での id。 */
  id: string;
  name: string;
  team: string;
  titles: Record<string, string>;
  /** その年の打撃成績（選手ごとの成績の表に入れる）。 */
  batting?: BattingLine;
}

export const FORMER_PLAYERS: FormerPlayer[] = [
  // 寛ブの捕手。三冠王を取り、シーズン後に海外へ移った。
  {
    year: 2025,
    id: 'kbt-fuchino',
    name: '渕野 剛臣',
    team: 'kanbu',
    titles: { 首位打者: '.418', 本塁打王: '88', 打点王: '231' },
    batting: { pa: 612, ab: 529, h: 221, hr: 88, rbi: 231, bb: 79, so: 74, sb: 4, g: 141 }
  },
  // 寛ブの右翼手。川鷺が代打中心だったこの年、右翼の先発で15本塁打。
  {
    year: 2025,
    id: 'kbt-izaki',
    name: '井崎 涼介',
    team: 'kanbu',
    titles: {},
    batting: { pa: 528, ab: 474, h: 119, hr: 15, rbi: 62, bb: 46, so: 121, sb: 3, g: 128 }
  },
  // 寛ブの DH の外国人選手。翌年はミラーに代わった（この年のミラーの出番はフレッティーのもの）。
  {
    year: 2025,
    id: 'kbt-fretty',
    name: 'フレッティー',
    team: 'kanbu',
    titles: {},
    batting: { pa: 556, ab: 498, h: 138, hr: 20, rbi: 68, bb: 52, so: 132, sb: 0, g: 136 }
  }
];

/** 値の小さいほうが上のタイトル。 */
const LOWER_IS_BETTER = ['最優秀防御率'];

/** 離れた選手の記録を、その年のタイトルの表に入れて並べ直す（人数を TITLE_TOP 人にそろえるのは applyRecorded）。 */
export function addFormerPlayers(season: Season, players: FormerPlayer[] = FORMER_PLAYERS): Season {
  const titles = season.titles.map((t) => {
    const league = season.leagues.find((l) => l.name === t.league)!;
    const extra = players
      .filter((p) => p.year === season.year && p.titles[t.label] !== undefined && league.rows.some((r) => r.team === p.team))
      .map((p) => ({ name: p.name, team: p.team, value: p.titles[t.label] }));
    if (!extra.length) return t;
    const sign = LOWER_IS_BETTER.includes(t.label) ? 1 : -1;
    const leaders = [...extra, ...t.leaders.filter((x) => !extra.some((e) => e.name === x.name))]
      .sort((a, b) => sign * (parseFloat(a.value) - parseFloat(b.value)));
    return { ...t, leaders };
  });
  const extra = players.filter((p) => p.year === season.year && p.batting);
  const stats = season.stats && extra.length ? { ...season.stats, batting: { ...season.stats.batting, ...Object.fromEntries(extra.map((p) => [p.id, p.batting!])) } } : season.stats;
  return { ...season, titles, stats };
}

/** 実際の結果が決まっている年の記録。シミュレーションの結果をこれで置き換える。 */
export interface Recorded {
  /** 球団ごとの勝敗。ゲーム差と順位は置き換えたあとで計算し直す。 */
  records?: Record<string, { w: number; l: number; t: number }>;
  /** シリーズ。scores は1戦ずつ［勝ったチームの得点, 負けたチームの得点］。本拠地の決まりは playSeries と同じ。 */
  series?: { winner: string; scores: [number, number][] };
  /** 球団ごとの得点・失点。 */
  runs?: Record<string, { rs: number; ra: number }>;
  /** 選手ごと（id）の打撃成績の置き換え（その年の1シーズン分）。 */
  batting?: Record<string, BattingLine>;
  /** その年はまだいなかった選手（id）。成績の表から除く。 */
  absent?: string[];
  /** タイトル争いに加われる選手がほとんどいない球団。そのリーグの表全体で、これらの球団の選手は max 人（順位の高い者から）まで。 */
  fewContenders?: { teams: string[]; max: number };
}

export const RECORDED: Record<number, Recorded> = {
  2025: {
    // 寛ブが95勝で独走。そのぶん同じリーグの5球団が2つずつ負けを増やした。
    records: {
      // コスモ・リーグは最初に作ったシーズンの順位のまま（球団データを直して作り直しても変わらないように）。
      kamiyama: { w: 87, l: 51, t: 5 },
      facrom: { w: 72, l: 58, t: 13 },
      hanazakura: { w: 66, l: 68, t: 9 },
      maikai: { w: 66, l: 69, t: 8 },
      jogawa: { w: 59, l: 77, t: 7 },
      smarlins: { w: 43, l: 94, t: 6 },
      kanbu: { w: 95, l: 46, t: 2 },
      manyama: { w: 78, l: 63, t: 2 },
      onetar: { w: 77, l: 63, t: 3 },
      sackstars: { w: 75, l: 64, t: 4 },
      kanenodunk: { w: 59, l: 81, t: 3 },
      merry: { w: 49, l: 92, t: 2 }
    },
    // 寛ブが神山国に4連勝。どの試合も大差だった。
    series: { winner: 'kanbu', scores: [[11, 2], [9, 1], [8, 0], [12, 3]] },
    // 渕野（正捕手・231打点）と井崎がいたぶん寛ブの得点は打点の合計に見合うだけ多く、その分を同じリーグの5球団が48点ずつ多く取られた。
    runs: {
      kanbu: { rs: 781, ra: 315 },
      manyama: { rs: 436, ra: 396 },
      onetar: { rs: 425, ra: 445 },
      sackstars: { rs: 490, ra: 455 },
      kanenodunk: { rs: 366, ra: 560 },
      merry: { rs: 384, ra: 616 }
    },
    // 正捕手は渕野で、駒井は控え。川鷺は代打が多く、右翼は井崎が守った。
    batting: {
      'kbt-07': { pa: 92, ab: 83, h: 13, hr: 1, rbi: 6, bb: 7, so: 31, sb: 0, g: 41 },
      'kbt-03': { pa: 112, ab: 99, h: 26, hr: 4, rbi: 15, bb: 11, so: 28, sb: 0, g: 84 }
    },
    // ミラーはまだ来ていない（DH はフレッティー）。
    absent: ['kbt-16'],
    // ガイア・リーグの下位3球団には、タイトルを争えるほどの選手がほとんどいない。
    fewContenders: { teams: ['sackstars', 'kanenodunk', 'merry'], max: 1 }
  }
};

/**
 * その年の勝敗とシリーズを、決まっている記録（RECORDED）に置き換え、タイトルの表を TITLE_TOP 人にそろえる。
 * fewContenders があるので、タイトルの表は TITLE_TOP 人より多めに作っておく（summarizeSeason の top）。
 */
export function applyRecorded(season: Season, recorded: Recorded | undefined = RECORDED[season.year]): Season {
  const titles = limitContenders(season.titles, recorded?.fewContenders).map((t) => ({ ...t, leaders: t.leaders.slice(0, TITLE_TOP) }));
  if (!recorded) return { ...season, titles };
  let { leagues, series } = season;
  const records = recorded.records;
  const pct = (r: { w: number; l: number }) => (r.w + r.l ? r.w / (r.w + r.l) : 0);
  if (records || recorded.runs) {
    leagues = leagues.map((lg) => {
      const rows = lg.rows
        .map((r) => ({ ...r, ...records?.[r.team], ...recorded.runs?.[r.team] }))
        .sort((a, b) => pct(b) - pct(a));
      const [top] = rows;
      return { ...lg, rows: rows.map((r) => ({ ...r, gb: (top.w - r.w + r.l - top.l) / 2 })) };
    });
  }
  // 勝率の高いほうが第1戦の本拠地（勝敗を置き換えると入れ替わることがある）。
  const row = (id: string) => leagues.flatMap((l) => l.rows).find((r) => r.team === id)!;
  const [first, second] = [...series.teams].sort((a, b) => pct(row(b)) - pct(row(a)));
  series = { ...series, teams: [first, second] };
  const rs = recorded.series;
  if (rs) {
    const games: SeriesGame[] = rs.scores.map(([w, l], i) => {
      const n = i + 1;
      const home = [1, 2, 6, 7].includes(n) ? first : second;
      const away = home === first ? second : first;
      return { n, away, home, awayRuns: away === rs.winner ? w : l, homeRuns: home === rs.winner ? w : l };
    });
    const wins = [first, second].map((t) => (t === rs.winner ? games.length : 0)) as [number, number];
    series = { ...series, wins, ties: 0, winner: rs.winner, games };
  }
  let stats = season.stats && recorded.batting ? { ...season.stats, batting: { ...season.stats.batting, ...recorded.batting } } : season.stats;
  // 毎年の入れ替え（core/seasons.ts）：その年はまだいない選手の枠の成績は、その年だけいた選手のもの。
  if (stats) stats = { batting: renameSwapped(season.year, stats.batting), pitching: renameSwapped(season.year, stats.pitching) };
  if (stats && recorded.absent) {
    const here = ([id]: [string, unknown]) => !recorded.absent!.includes(id);
    stats = { batting: Object.fromEntries(Object.entries(stats.batting).filter(here)), pitching: Object.fromEntries(Object.entries(stats.pitching).filter(here)) };
  }
  return { ...season, leagues, series, titles, stats };
}

/** fewContenders の球団の選手を、リーグごとに表の上位 TITLE_TOP 人に入る者から順位の高い順に max 人だけ残す。 */
function limitContenders(titles: HistoryTitle[], few: Recorded['fewContenders']): HistoryTitle[] {
  if (!few) return titles;
  const weak = (x: HistoryTitle['leaders'][number]) => few.teams.includes(x.team);
  const kept = new Set<string>();
  for (const league of new Set(titles.map((t) => t.league))) {
    titles
      .filter((t) => t.league === league)
      .flatMap((t) => t.leaders.slice(0, TITLE_TOP).flatMap((x, rank) => (weak(x) ? [{ key: `${t.label}:${x.name}`, rank }] : [])))
      .sort((a, b) => a.rank - b.rank)
      .slice(0, few.max)
      .forEach((x) => kept.add(x.key));
  }
  return titles.map((t) => ({ ...t, leaders: t.leaders.filter((x) => !weak(x) || kept.has(`${t.label}:${x.name}`)) }));
}

/** 打撃の三冠（首位打者・本塁打王・打点王）をひとりで取った選手。リーグごとに、いなければ入らない。 */
export function tripleCrowns(season: Season): { league: string; name: string; team: string }[] {
  return season.leagues.flatMap((l) => {
    const tops = ['首位打者', '本塁打王', '打点王'].map((label) => season.titles.find((t) => t.league === l.name && t.label === label)?.leaders[0]);
    const [a] = tops;
    return a && tops.every((x) => x?.name === a.name && x.team === a.team) ? [{ league: l.name, name: a.name, team: a.team }] : [];
  });
}

/** 終わったシーズンを、順位・主なタイトル・シリーズの記録にまとめる。 */
export function summarizeSeason(year: number, p: Pennant, teams: TeamData[], series: SeriesResult, top = TITLE_TOP): Season {
  const ls = leagues(teams);
  const titles: HistoryTitle[] = [];
  for (const l of ls) {
    const races = titleRaces(p, l.teams, top);
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
    series,
    stats: { batting: p.batting, pitching: p.pitching }
  };
}
