// ペナントレース。球団の勝敗と、選手の通算成績（打撃・投手）を積み上げ、順位表とタイトル争いを作る。
// 保存は ui/season.ts。ここは計算だけ。

import { addLines, addPitchingLines, battingAverage, earnedRunAverage, emptyLine, emptyPitchingLine, score, type BattingLine, type GameState, type PitchingLine } from './gameState.ts';
import { nextConditions, type Conditions } from './condition.ts';
import { addNotices, rosterMoves, syncRoster, type Notice, type Registrations } from './registration.ts';
import { allBatters, allPitchers, type TeamData } from './teams.ts';

/** 1シーズンの試合数（各球団）。同じリーグの5球団と25試合ずつ（125試合）、交流戦で他リーグの6球団と3試合ずつ（18試合）。 */
export const SEASON_GAMES = 143;
/** いま遊んでいるシーズンの年。前の年までの結果は core/history.ts（src/data/history.json）。 */
export const SEASON_YEAR = 2026;
/** 交流戦の期間（何日目から何日間か。日は0から数える）。 */
export const INTERLEAGUE = { from: 60, days: 18 };
/** その日（day 日目、0 から）が交流戦か。 */
export const isInterleague = (day: number) => day >= INTERLEAGUE.from && day < INTERLEAGUE.from + INTERLEAGUE.days;

/** リーグごとの球団（teams.json に出てくる順）。 */
export function leagues(teams: TeamData[]): { name: string; teams: TeamData[] }[] {
  const names = [...new Set(teams.map((t) => t.league))];
  return names.map((name) => ({ name, teams: teams.filter((t) => t.league === name) }));
}

/** その球団と同じリーグの球団。 */
export const leagueTeams = (teams: TeamData[], id: string) => {
  const league = teams.find((t) => t.id === id)?.league;
  return teams.filter((t) => t.league === league);
};

export interface TeamRecord {
  w: number;
  l: number;
  t: number;
  /** 得点・失点。 */
  rs: number;
  ra: number;
  /** 消化した規定イニングの合計。規定打席・規定投球回の計算に使う。 */
  innings: number;
}

/** 1試合の結果（他球場の結果の表示に使う）。 */
export interface GameResult {
  away: string;
  home: string;
  awayRuns: number;
  homeRuns: number;
}

export interface Pennant {
  teams: Record<string, TeamRecord>;
  batting: Record<string, BattingLine>;
  pitching: Record<string, PitchingLine>;
  /** 対戦した回数（キーは球団 id を並べたもの）。他球場の組み合わせを決めるのに使う。 */
  meetings: Record<string, number>;
  /** 直近の節の結果。 */
  lastRound: GameResult[];
  /** 選手の調子（選手 id ごと、-1〜1）。1節ごとに変わる。 */
  condition: Conditions;
  /** 消化した節（日）の数。 */
  day: number;
  /** 球団ごとの出場選手登録（無い球団は開幕時のまま）。 */
  registrations: Registrations;
  /** 公示（古い順）。 */
  notices: Notice[];
}

export const emptyPennant = (): Pennant => ({ teams: {}, batting: {}, pitching: {}, meetings: {}, lastRound: [], condition: {}, day: 0, registrations: {}, notices: [] });
export const emptyRecord = (): TeamRecord => ({ w: 0, l: 0, t: 0, rs: 0, ra: 0, innings: 0 });

const pairKey = (a: string, b: string) => [a, b].sort().join('|');
export const gamesPlayed = (r: TeamRecord) => r.w + r.l + r.t;
/** 勝率（引き分けは数えない）。 */
export const winPct = (r: TeamRecord) => (r.w + r.l ? r.w / (r.w + r.l) : 0);

/** 全球団が規定の試合数を終えたらシーズン終了。 */
export function seasonOver(p: Pennant, teams: TeamData[]): boolean {
  return teams.every((t) => gamesPlayed(p.teams[t.id] ?? emptyRecord()) >= SEASON_GAMES);
}

/** 終わった試合を足した新しいペナントを返す。 */
export function addGame(p: Pennant, s: GameState): Pennant {
  const next: Pennant = {
    teams: { ...p.teams },
    batting: { ...p.batting },
    pitching: { ...p.pitching },
    meetings: { ...p.meetings },
    lastRound: p.lastRound,
    condition: p.condition,
    day: p.day,
    registrations: p.registrations,
    notices: p.notices
  };
  const [away, home] = s.teams.map((t) => t.team.id);
  const runs = [score(s, 0), score(s, 1)];
  s.teams.forEach((t, i) => {
    const r = { ...(next.teams[t.team.id] ?? emptyRecord()) };
    const mine = runs[i];
    const theirs = runs[1 - i];
    if (mine > theirs) r.w += 1;
    else if (mine < theirs) r.l += 1;
    else r.t += 1;
    r.rs += mine;
    r.ra += theirs;
    r.innings += s.innings;
    next.teams[t.team.id] = r;
  });
  const key = pairKey(away, home);
  next.meetings[key] = (next.meetings[key] ?? 0) + 1;
  // 打席に立つか盗塁した野手、マウンドに上がった投手は、その試合に出場したと数える。
  for (const [id, line] of Object.entries(s.batting)) next.batting[id] = addLines(next.batting[id] ?? emptyLine(), { ...line, g: 1 });
  for (const [id, line] of Object.entries(s.pitching)) next.pitching[id] = addPitchingLines(next.pitching[id] ?? emptyPitchingLine(), { ...line, g: 1 });
  return next;
}

/**
 * 1節（1日）の試合を終えたあと、その日の成績も踏まえて全選手の調子を進め、出場選手登録を入れ替える（公示）。
 * teams は teams.json の球団（登録を反映する前）。
 */
export function advanceDay(p: Pennant, teams: TeamData[], games: GameState[], random: () => number = Math.random): Pennant {
  const batting = Object.assign({}, ...games.map((g) => g.batting));
  const pitching = Object.assign({}, ...games.map((g) => g.pitching));
  const condition = nextConditions(p.condition, teams, batting, pitching, random);
  const day = p.day + 1;
  const moves = rosterMoves(p.registrations, teams, condition, day, random);
  return { ...p, condition, day, registrations: moves.registrations, notices: addNotices(p.notices, moves.notices) };
}

/** teams.json の1軍の入れ替えを、途中のペナントの登録に反映する（順位・成績・公示はそのまま）。 */
export function syncRosters(p: Pennant, teams: TeamData[]): Pennant {
  const registrations = { ...p.registrations };
  for (const t of teams) {
    const reg = registrations[t.id];
    if (!reg) continue;
    // 公示で2軍から上がった選手（最初の公示が登録）。抹消されてから戻った1軍の選手は含めない。
    const first = new Map<string, Notice['kind']>();
    for (const n of p.notices) if (n.team === t.id && n.kind !== 'sign' && !first.has(n.id)) first.set(n.id, n.kind);
    const promoted = new Set([...first].filter(([, kind]) => kind === 'up').map(([id]) => id));
    registrations[t.id] = syncRoster(t, reg, promoted);
  }
  return { ...p, registrations };
}

/** その節（day）に出た公示。 */
export const noticesOn = (p: Pennant, day: number) => p.notices.filter((n) => n.day === day);

/** その日に組みたい相手か（交流戦なら他リーグ、ふだんは同じリーグ）。 */
const wanted = (day: number, a: TeamData, b: TeamData) => (a.league === b.league) !== isInterleague(day);

/** 1シーズンの、同じリーグの球団・他リーグの球団それぞれとの対戦数。 */
export const MEETINGS = { league: 25, interleague: 3 };

/**
 * あなたの試合と同じ節に行う、残りの球団どうしの組み合わせ。ふだんは同じリーグ、交流戦の期間は他リーグの球団と組む。
 * 組み方を全通り調べ、対戦数がそろう（決まった対戦数を越えない・少ない組を優先する）ものを選ぶ。
 * その日に組みたい相手と組めない球団（あなたの試合で数が合わないとき）は、ほかの相手と組む。
 * random は先攻・後攻と同点のときの選び方に使う。
 */
export function pairOthers(p: Pennant, teams: TeamData[], playing: string[], random: () => number = Math.random): [TeamData, TeamData][] {
  const rest = teams.filter((t) => !playing.includes(t.id));
  const cost = (a: TeamData, b: TeamData) => {
    const m = p.meetings[pairKey(a.id, b.id)] ?? 0;
    const cap = a.league === b.league ? MEETINGS.league : MEETINGS.interleague;
    return (wanted(p.day, a, b) ? 0 : 10000) + (m >= cap ? 1000 : 0) + m * m;
  };
  let best: [TeamData, TeamData][] = [];
  let bestCost = Infinity;
  let ties = 0;
  const search = (left: TeamData[], acc: [TeamData, TeamData][], sum: number) => {
    if (sum > bestCost) return;
    if (left.length < 2) {
      // 同じ点のときは、出てきた順に等しい確率で選ぶ。
      if (sum < bestCost) {
        bestCost = sum;
        best = [...acc];
        ties = 1;
      } else if (random() < 1 / ++ties) best = [...acc];
      return;
    }
    const [a, ...others] = left;
    for (const b of others) {
      acc.push([a, b]);
      search(others.filter((t) => t !== b), acc, sum + cost(a, b));
      acc.pop();
    }
  };
  search(rest, [], 0);
  return best.map(([a, b]) => (random() < 0.5 ? [a, b] : [b, a]));
}

/** 日程どおりの次の相手（その日に組みたい相手のうち、対戦の少ない球団。同じなら試合数の少ない球団）。 */
export function nextOpponent(p: Pennant, teams: TeamData[], mine: TeamData): TeamData {
  const pool = teams.filter((t) => t !== mine && wanted(p.day, mine, t));
  const meet = (t: TeamData) => p.meetings[pairKey(mine.id, t.id)] ?? 0;
  const played = (t: TeamData) => gamesPlayed(p.teams[t.id] ?? emptyRecord());
  return (pool.length ? pool : teams.filter((t) => t !== mine)).reduce((a, t) => (meet(t) < meet(a) || (meet(t) === meet(a) && played(t) < played(a)) ? t : a));
}

export interface StandingRow {
  team: TeamData;
  record: TeamRecord;
  /** 首位とのゲーム差。首位は 0。 */
  gamesBehind: number;
}

/** 順位表（勝率順。同率なら勝ち数、得失点差の順）。 */
export function standings(p: Pennant, teams: TeamData[]): StandingRow[] {
  const rows = teams.map((team) => ({ team, record: p.teams[team.id] ?? emptyRecord() }));
  rows.sort((a, b) => winPct(b.record) - winPct(a.record) || b.record.w - a.record.w || b.record.rs - b.record.ra - (a.record.rs - a.record.ra));
  const top = rows[0].record;
  return rows.map((r) => ({ ...r, gamesBehind: (top.w - top.l - (r.record.w - r.record.l)) / 2 }));
}

/** 規定打席（チームの消化イニング 9 回あたり 3.1 打席）。 */
export const qualifyingPa = (r: TeamRecord) => Math.floor((r.innings / 9) * 3.1);
/** 規定投球回のアウト数（チームの消化イニング 9 回あたり 1 回）。 */
export const qualifyingOuts = (r: TeamRecord) => Math.floor(r.innings / 9) * 3;

export interface Leader {
  id: string;
  name: string;
  team: TeamData;
  value: number;
}

export interface TitleRace {
  key: string;
  label: string;
  /** 値の表記。 */
  format: (v: number) => string;
  leaders: Leader[];
  /** 規定打席・規定投球回などの条件の説明。 */
  note?: string;
}

/** 打率の表記（.285、1.000）。 */
export const formatRate = (v: number) => v.toFixed(3).replace(/^0/, '');
/** 投球回の表記（10 アウトなら 3.1）。 */
export const formatInnings = (outs: number) => `${Math.floor(outs / 3)}${outs % 3 ? `.${outs % 3}` : ''}`;

type Entry<L> = { id: string; name: string; team: TeamData; line: L };

/** タイトル争い（打撃4部門・投手3部門）。各部門の上位 top 人。 */
export function titleRaces(p: Pennant, teams: TeamData[], top = 5): { batting: TitleRace[]; pitching: TitleRace[] } {
  const batters: Entry<BattingLine>[] = teams.flatMap((team) => allBatters(team).filter((b) => p.batting[b.id]).map((b) => ({ id: b.id, name: b.name, team, line: p.batting[b.id] })));
  const pitchers: Entry<PitchingLine>[] = teams.flatMap((team) => allPitchers(team).filter((x) => p.pitching[x.id]).map((x) => ({ id: x.id, name: x.name, team, line: p.pitching[x.id] })));
  const record = (t: TeamData) => p.teams[t.id] ?? emptyRecord();

  const rank = <L,>(list: Entry<L>[], value: (l: L) => number | null, ascending = false): Leader[] =>
    list
      .map((e) => ({ id: e.id, name: e.name, team: e.team, value: value(e.line) }))
      .filter((e): e is Leader => e.value !== null && (ascending || e.value > 0))
      .sort((a, b) => (ascending ? a.value - b.value : b.value - a.value))
      .slice(0, top);

  const sample = teams.find((t) => p.teams[t.id]);
  const paNote = sample ? `規定打席 ${qualifyingPa(record(sample))}` : undefined;
  const ipNote = sample ? `規定投球回 ${formatInnings(qualifyingOuts(record(sample)))}` : undefined;
  const count = (v: number) => String(v);

  return {
    batting: [
      { key: 'avg', label: '首位打者', format: formatRate, note: paNote, leaders: rank(batters.filter((e) => e.line.pa >= Math.max(1, qualifyingPa(record(e.team)))), battingAverage) },
      { key: 'hr', label: '本塁打王', format: count, leaders: rank(batters, (l) => l.hr) },
      { key: 'rbi', label: '打点王', format: count, leaders: rank(batters, (l) => l.rbi) },
      { key: 'h', label: '最多安打', format: count, leaders: rank(batters, (l) => l.h) }
    ],
    pitching: [
      { key: 'era', label: '最優秀防御率', format: (v) => v.toFixed(2), note: ipNote, leaders: rank(pitchers.filter((e) => e.line.outs >= Math.max(1, qualifyingOuts(record(e.team)))), earnedRunAverage, true) },
      { key: 'w', label: '最多勝', format: count, leaders: rank(pitchers, (l) => l.w) },
      { key: 'so', label: '最多奪三振', format: count, leaders: rank(pitchers, (l) => l.so) }
    ]
  };
}
