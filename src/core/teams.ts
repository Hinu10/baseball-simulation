// 球団・選手データの型と、JSON（src/data/teams.json）を読み込むときの検証。
// 球団名・選手名・打順はコードに書かず、JSON を書き換えて変える。

import { FIELD_POSITIONS, PITCH_TYPES, type Hand, type LineupPosition, type PitchType } from './types.ts';

export interface TeamColors {
  primary: string;
  secondary: string;
  uniform: string;
  cap: string;
}

/** 野手。能力はすべて 0〜100。 */
export interface Batter {
  id: string;
  name: string;
  number: number;
  position: LineupPosition;
  bats: Hand;
  meet: number;
  power: number;
  speed: number;
  arm: number;
  fielding: number;
}

/** 投手。velocity は最高球速（km/h）、ほかは 0〜100。DH 制なので打席には立たない。 */
export interface Pitcher {
  id: string;
  name: string;
  number: number;
  throws: Hand;
  velocity: number;
  control: number;
  stamina: number;
  breaking: number;
  pitches: PitchType[];
  arm: number;
  fielding: number;
  speed: number;
}

export interface TeamData {
  id: string;
  name: string;
  nameJa: string;
  shortName: string;
  abbr: string;
  colors: TeamColors;
  batters: Batter[];
  pitchers: Pitcher[];
  /** 打順（野手の id を9人）。 */
  lineup: string[];
  startingPitcher: string;
}

const RATINGS = ['meet', 'power', 'speed', 'arm', 'fielding'] as const;
const PITCHER_RATINGS = ['control', 'stamina', 'breaking', 'arm', 'fielding', 'speed'] as const;
const LINEUP_POSITIONS = [...FIELD_POSITIONS.filter((p) => p !== 'P'), 'DH'];

export class TeamDataError extends Error {}

function fail(team: string, message: string): never {
  throw new TeamDataError(`${team}: ${message}`);
}

function checkRating(team: string, who: string, key: string, v: unknown) {
  if (typeof v !== 'number' || !(v >= 0 && v <= 100)) fail(team, `${who} の ${key} は 0〜100 の数値にしてください（${String(v)}）`);
}

/** teams.json の中身を検証して返す。問題があれば TeamDataError。 */
export function parseTeams(raw: unknown): TeamData[] {
  const teams = (raw as { teams?: unknown }).teams;
  if (!Array.isArray(teams) || teams.length < 2) throw new TeamDataError('teams に2球団以上が必要です');
  const ids = new Set<string>();
  for (const t of teams as TeamData[]) {
    const name = t.name ?? '(名前なし)';
    if (!t.id || ids.has(t.id)) fail(name, '球団 id がないか重複しています');
    ids.add(t.id);
    for (const key of ['name', 'nameJa', 'shortName', 'abbr'] as const) if (typeof t[key] !== 'string' || !t[key]) fail(name, `${key} がありません`);
    for (const key of ['primary', 'secondary', 'uniform', 'cap'] as const) {
      if (!/^#[0-9a-fA-F]{6}$/.test(t.colors?.[key] ?? '')) fail(name, `colors.${key} は #rrggbb で書いてください`);
    }
    if (!Array.isArray(t.batters) || t.batters.length < 9) fail(name, '野手は9人以上必要です');
    if (!Array.isArray(t.pitchers) || t.pitchers.length < 1) fail(name, '投手が必要です');
    const playerIds = new Set<string>();
    for (const b of t.batters) {
      if (!b.id || playerIds.has(b.id)) fail(name, `選手 id が重複しています（${b.id}）`);
      playerIds.add(b.id);
      if (!LINEUP_POSITIONS.includes(b.position)) fail(name, `${b.name} の守備位置 ${b.position} が不正です`);
      if (b.bats !== 'R' && b.bats !== 'L') fail(name, `${b.name} の bats は R か L です`);
      for (const k of RATINGS) checkRating(name, b.name, k, b[k]);
    }
    for (const p of t.pitchers) {
      if (!p.id || playerIds.has(p.id)) fail(name, `選手 id が重複しています（${p.id}）`);
      playerIds.add(p.id);
      if (p.throws !== 'R' && p.throws !== 'L') fail(name, `${p.name} の throws は R か L です`);
      if (typeof p.velocity !== 'number' || p.velocity < 100 || p.velocity > 170) fail(name, `${p.name} の velocity は 100〜170 km/h にしてください`);
      for (const k of PITCHER_RATINGS) checkRating(name, p.name, k, p[k]);
      if (!Array.isArray(p.pitches) || !p.pitches.includes('fastball')) fail(name, `${p.name} はストレート（fastball）を投げられる必要があります`);
      for (const pt of p.pitches) if (!PITCH_TYPES.includes(pt)) fail(name, `${p.name} の球種 ${pt} が不正です`);
    }
    if (!Array.isArray(t.lineup) || t.lineup.length !== 9) fail(name, '打順は9人です');
    if (new Set(t.lineup).size !== 9) fail(name, '打順に同じ選手が2回入っています');
    const lineup = t.lineup.map((id) => t.batters.find((b) => b.id === id) ?? fail(name, `打順の ${id} が野手にいません`));
    const positions = lineup.map((b) => b.position).sort();
    if (positions.join() !== [...LINEUP_POSITIONS].sort().join()) fail(name, `打順の守備位置がそろっていません（${positions.join(', ')}）`);
    if (!t.pitchers.some((p) => p.id === t.startingPitcher)) fail(name, `先発投手 ${t.startingPitcher} が投手にいません`);
  }
  return teams as TeamData[];
}

export function lineupOf(team: TeamData): Batter[] {
  return team.lineup.map((id) => team.batters.find((b) => b.id === id)!);
}

export function pitcherOf(team: TeamData, id: string): Pitcher {
  return team.pitchers.find((p) => p.id === id)!;
}
