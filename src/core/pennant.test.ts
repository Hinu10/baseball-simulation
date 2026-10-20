import assert from 'node:assert/strict';
import { test } from 'node:test';
import raw from '../data/teams.json' with { type: 'json' };
import { createGameState, type GameState } from './gameState.ts';
import { addGame, emptyPennant, formatInnings, pairOthers, seasonOver, SEASON_GAMES, standings, titleRaces } from './pennant.ts';
import { parseTeams, type TeamData } from './teams.ts';

const teams = parseTeams(raw);

/** away が a 点、home が h 点で終わった3回の試合。 */
function finished(away: TeamData, home: TeamData, a: number, h: number): GameState {
  const s = createGameState(away, home, 3);
  s.teams[0].runsByInning = [a, 0, 0];
  s.teams[1].runsByInning = [h, 0, 0];
  s.over = true;
  return s;
}

test('勝敗・得失点・対戦回数を積み上げ、勝率順の順位表とゲーム差を出す', () => {
  const [a, b, c, d] = teams;
  let p = emptyPennant();
  p = addGame(p, finished(a, b, 3, 1));
  p = addGame(p, finished(c, d, 2, 2));
  p = addGame(p, finished(b, a, 5, 0));
  p = addGame(p, finished(a, c, 4, 2));
  assert.deepEqual(p.teams[a.id], { w: 2, l: 1, t: 0, rs: 7, ra: 8, innings: 9 });
  assert.equal(p.meetings[[a.id, b.id].sort().join('|')], 2);
  const rows = standings(p, teams);
  assert.equal(rows[0].team, a);
  assert.equal(rows[0].gamesBehind, 0);
  // b は 1勝1敗 → a（2勝1敗）と 0.5 差。
  assert.equal(rows.find((r) => r.team === b)!.gamesBehind, 0.5);
});

test('残りの球団は、対戦の少ない組から組み合わせる', () => {
  const six = teams.slice(0, 6);
  const [a, b, c, d, e, f] = six;
  let p = emptyPennant();
  p = addGame(p, finished(c, d, 1, 0));
  p = addGame(p, finished(e, f, 1, 0));
  const pairs = pairOthers(p, six, [a.id, b.id], () => 0);
  assert.equal(pairs.length, 2);
  const keys = pairs.map((x) => x.map((t) => t.id).sort().join('|')).sort();
  assert.ok(!keys.includes([c.id, d.id].sort().join('|')));
  assert.ok(!keys.includes([e.id, f.id].sort().join('|')));
});

test('タイトル争い：首位打者は規定打席以上、防御率は低い順', () => {
  const [a, b] = teams;
  const s = finished(a, b, 1, 0);
  // 9回分を3試合で消化した扱いにして、規定打席を 3 にする。
  s.innings = 9;
  const [x, y] = a.batters;
  s.batting = { [x.id]: { pa: 4, ab: 4, h: 2, hr: 1, rbi: 1 }, [y.id]: { pa: 1, ab: 1, h: 1, hr: 0, rbi: 0 } };
  const [p1, p2] = b.pitchers;
  s.pitching = { [p1.id]: { outs: 27, r: 3, h: 5, so: 8, bb: 2, w: 0, l: 1 }, [p2.id]: { outs: 2, r: 0, h: 0, so: 1, bb: 0, w: 0, l: 0 } };
  const races = titleRaces(addGame(emptyPennant(), s), teams);
  const avg = races.batting.find((r) => r.key === 'avg')!;
  assert.deepEqual(avg.leaders.map((l) => l.id), [x.id]); // y は打率 1.000 だが規定打席に届かない
  assert.equal(avg.format(avg.leaders[0].value), '.500');
  const era = races.pitching.find((r) => r.key === 'era')!;
  assert.deepEqual(era.leaders.map((l) => l.id), [p1.id]);
  assert.equal(era.format(era.leaders[0].value), '3.00');
  assert.equal(races.pitching.find((r) => r.key === 'so')!.leaders[0].id, p1.id);
});

test('全球団が規定の試合数を終えたらシーズン終了。投球回は 3.1 のように表す', () => {
  const p = emptyPennant();
  for (const t of teams) p.teams[t.id] = { w: SEASON_GAMES, l: 0, t: 0, rs: 0, ra: 0, innings: 0 };
  assert.equal(seasonOver(p, teams), true);
  p.teams[teams[0].id] = { ...p.teams[teams[0].id], w: SEASON_GAMES - 1 };
  assert.equal(seasonOver(p, teams), false);
  assert.equal(formatInnings(10), '3.1');
  assert.equal(formatInnings(9), '3');
});

test('出場した試合数は、打席に立った野手・登板した投手ごとに1試合ずつ数える', () => {
  const [away, home] = teams;
  const s = createGameState(away, home, 3);
  const [b, p] = [away.lineup[0], home.startingPitcher];
  s.batting[b] = { pa: 2, ab: 2, h: 1, hr: 0, rbi: 0, bb: 0, so: 1, sb: 0, g: 0 };
  s.pitching[p] = { outs: 9, r: 1, h: 3, so: 4, bb: 1, w: 0, l: 0, g: 0 };
  let pennant = addGame(emptyPennant(), s);
  pennant = addGame(pennant, s);
  assert.equal(pennant.batting[b].g, 2);
  assert.equal(pennant.batting[b].so, 2);
  assert.equal(pennant.pitching[p].g, 2);
  assert.equal(pennant.pitching[p].outs, 18);
});
