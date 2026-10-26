import assert from 'node:assert/strict';
import { test } from 'node:test';
import raw from '../data/teams.json' with { type: 'json' };
import { emptyLine, emptyPitchingLine } from './gameState.ts';
import { MAX_HEROES, pickHeroes } from './hero.ts';
import { Match } from './match.ts';
import { parseTeams } from './teams.ts';

const [away, home] = parseTeams(raw);

test('ヒーローは勝ったチームから2人まで選ばれ、引き分けや試合中は選ばれない', () => {
  const m = new Match({ away, home, mode: 'auto', seed: 7 });
  assert.deepEqual(pickHeroes(m.state), []);
  m.skipToEnd();
  const heroes = pickHeroes(m.state);
  if (m.state.winner === null) {
    assert.deepEqual(heroes, []);
    return;
  }
  const t = m.state.teams[m.state.winner].team;
  assert.ok(heroes.length >= 1 && heroes.length <= MAX_HEROES);
  for (const h of heroes) {
    assert.ok([...t.batters, ...t.pitchers].some((p) => p.id === h.id), `${h.name} は勝ったチームの選手ではない`);
    assert.ok(h.line && h.quote);
  }
});

test('本塁打を打って打点を挙げた打者が、ヒットだけの打者より先に選ばれる', () => {
  const m = new Match({ away, home, mode: 'auto', seed: 7 });
  const s = m.state;
  const [a, b] = home.batters;
  s.over = true;
  s.winner = 1;
  s.batting[a.id] = { ...emptyLine(), pa: 4, ab: 4, h: 1 };
  s.batting[b.id] = { ...emptyLine(), pa: 4, ab: 4, h: 2, hr: 2, rbi: 4 };
  s.pitching[home.pitchers[0].id] = { ...emptyPitchingLine(), outs: 9, r: 3 };
  const [first] = pickHeroes(s);
  assert.equal(first.id, b.id);
  assert.equal(first.line, '4打数2安打 2本塁打 4打点');
});
