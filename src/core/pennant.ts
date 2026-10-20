// ペナントレース。球団の勝敗と、選手の通算成績（打撃・投手）を積み上げ、順位表とタイトル争いを作る。
// 保存は ui/season.ts。ここは計算だけ。

import { addLines, addPitchingLines, battingAverage, earnedRunAverage, emptyLine, emptyPitchingLine, score, type BattingLine, type GameState, type PitchingLine } from './gameState.ts';
import { nextConditions, type Conditions } from './condition.ts';
import { allBatters, allPitchers, type TeamData } from './teams.ts';

/** 1シーズンの試合数（各球団）。 */
export const SEASON_GAMES = 30;

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
}

export const emptyPennant = (): Pennant => ({ teams: {}, batting: {}, pitching: {}, meetings: {}, lastRound: [], condition: {} });
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
    condition: p.condition
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

/** 1節（1日）の試合を終えたあと、その日の成績も踏まえて全選手の調子を進める。 */
export function advanceConditions(p: Pennant, teams: TeamData[], games: GameState[], random: () => number = Math.random): Pennant {
  const batting = Object.assign({}, ...games.map((g) => g.batting));
  const pitching = Object.assign({}, ...games.map((g) => g.pitching));
  return { ...p, condition: nextConditions(p.condition, teams, batting, pitching, random) };
}

/**
 * あなたの試合と同じ節に行う、残りの球団どうしの組み合わせ。対戦の少ない組を優先し、
 * 試合数の少ない球団から組む。random は先攻・後攻と同点のときの選び方に使う。
 */
export function pairOthers(p: Pennant, teams: TeamData[], playing: string[], random: () => number = Math.random): [TeamData, TeamData][] {
  let rest = teams.filter((t) => !playing.includes(t.id));
  const played = (t: TeamData) => gamesPlayed(p.teams[t.id] ?? emptyRecord());
  const pairs: [TeamData, TeamData][] = [];
  while (rest.length >= 2) {
    const a = rest.reduce((x, y) => (played(y) < played(x) ? y : x));
    const others = rest.filter((t) => t !== a);
    const fewest = Math.min(...others.map((t) => p.meetings[pairKey(a.id, t.id)] ?? 0));
    const candidates = others.filter((t) => (p.meetings[pairKey(a.id, t.id)] ?? 0) === fewest);
    const b = candidates[Math.floor(random() * candidates.length)];
    pairs.push(random() < 0.5 ? [a, b] : [b, a]);
    rest = rest.filter((t) => t !== a && t !== b);
  }
  return pairs;
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
