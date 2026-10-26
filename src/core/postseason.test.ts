import assert from 'node:assert/strict';
import { test } from 'node:test';
import raw from '../data/teams.json' with { type: 'json' };
import { score } from './gameState.ts';
import { Match } from './match.ts';
import { emptyPennant } from './pennant.ts';
import { addSeriesGame, seriesHome, seriesStatus, startPostseason, type Postseason } from './postseason.ts';
import { parseTeams } from './teams.ts';

const ps: Postseason = { finals: [], first: 'kanbu', second: 'hanazakura', games: [] };
const game = (p: Postseason, winner: string | null) => {
  const next = seriesStatus(p).next!;
  const [a, h] = winner === null ? [2, 2] : winner === next.away ? [3, 1] : [1, 3];
  return addSeriesGame(p, { away: next.away, home: next.home, awayRuns: a, homeRuns: h });
};

test('本拠地は第1・2・6・7戦が first、第3〜5戦と第8戦が second', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map((n) => seriesHome(ps, n)), ['kanbu', 'kanbu', 'hanazakura', 'hanazakura', 'hanazakura', 'kanbu', 'kanbu', 'hanazakura']);
  assert.deepEqual(seriesStatus(ps).next, { n: 1, home: 'kanbu', away: 'hanazakura' });
});

test('先に4勝したほうが優勝し、そのあとの試合は足さない', () => {
  let p = ps;
  for (const w of ['hanazakura', 'kanbu', 'hanazakura', 'hanazakura', 'kanbu', 'hanazakura']) p = game(p, w);
  const s = seriesStatus(p);
  assert.deepEqual(s.wins, [2, 4]);
  assert.equal(s.winner, 'hanazakura');
  assert.equal(s.next, null);
  assert.equal(addSeriesGame(p, { away: 'kanbu', home: 'hanazakura', awayRuns: 1, homeRuns: 0 }), p);
});

test('引き分けがあれば第8戦まで行う', () => {
  let p = ps;
  for (const w of [null, 'kanbu', 'kanbu', 'kanbu', 'hanazakura', 'hanazakura', 'hanazakura']) p = game(p, w);
  const s = seriesStatus(p);
  assert.deepEqual([s.wins, s.ties, s.winner], [[3, 3], 1, null]);
  assert.deepEqual(s.next, { n: 8, home: 'hanazakura', away: 'kanbu' });
});

test('ファイナルを渡さなければ両リーグの優勝チームで、勝率の高いほうが first', () => {
  const teams = parseTeams(raw);
  const rec = (w: number, l: number) => ({ w, l, t: 0, rs: 0, ra: 0, innings: 0 });
  const p = { ...emptyPennant(), teams: { kamiyama: rec(80, 60), hanazakura: rec(70, 70), kanbu: rec(90, 50), onetar: rec(75, 65) } };
  const plain = startPostseason(p, teams);
  assert.deepEqual([plain.first, plain.second], ['kanbu', 'kamiyama']);
  const ps = startPostseason(p, teams, [{ league: teams.find((t) => t.id === 'hanazakura')!.league, winner: 'hanazakura', loser: 'kamiyama', wins: [4, 2] }]);
  assert.deepEqual([ps.first, ps.second], ['kanbu', 'hanazakura']);
});

test('試合の状態を渡すと、イニングごとの得点・安打と、シーズンとは別の選手の成績（投手は役割つき）を残す', () => {
  const teams = parseTeams(raw);
  const find = (id: string) => teams.find((t) => t.id === id)!;
  const m = new Match({ away: find('hanazakura'), home: find('kanbu'), innings: 9, mode: 'auto', difficulty: 'normal', seed: 3 });
  m.skipToEnd();
  const s = m.state;
  const p = addSeriesGame(ps, { away: 'hanazakura', home: 'kanbu', awayRuns: score(s, 0), homeRuns: score(s, 1) }, s);
  const [g] = p.games;
  assert.equal(g.innings![0].reduce((a, b) => a + b, 0), g.awayRuns);
  assert.deepEqual(g.hits, [s.teams[0].hits, s.teams[1].hits]);
  assert.deepEqual(Object.keys(p.batting!).sort(), Object.keys(s.batting).sort());
  assert.deepEqual(g.batting, s.batting);
  const starter = s.teams[1].team.startingPitcher;
  assert.equal(p.pitching![starter].g, 1);
  assert.deepEqual([p.players![starter].team, p.players![starter].role], ['kanbu', 'starter']);
});
