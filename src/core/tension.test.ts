import assert from 'node:assert/strict';
import { test } from 'node:test';
import raw from '../data/teams.json' with { type: 'json' };
import { createGameState } from './gameState.ts';
import { tension } from './tension.ts';
import { parseTeams } from './teams.ts';

const [away, home] = parseTeams(raw);

test('走者なしの序盤は静かで、得点圏・満塁・終盤の接戦ほど盛り上がる', () => {
  const s = createGameState(away, home, 9);
  assert.equal(tension(s), 0);
  s.bases[2] = 'x';
  const scoring = tension(s);
  assert.ok(scoring > 0);
  s.bases = [null, 'a', 'b', 'c'];
  const loaded = tension(s);
  assert.ok(loaded > scoring);
  s.inning = 9;
  s.half = 'bottom';
  assert.ok(tension(s) > loaded);
  assert.ok(tension(s) <= 1);
});

test('大差の試合は、得点圏に走者がいてもあまり盛り上がらない', () => {
  const s = createGameState(away, home, 9);
  s.bases[3] = 'x';
  const even = tension(s);
  s.teams[1].runsByInning = [8];
  assert.ok(tension(s) < even);
});
