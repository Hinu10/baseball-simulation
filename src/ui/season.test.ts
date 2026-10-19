import assert from 'node:assert/strict';
import { test } from 'node:test';
import raw from '../data/teams.json' with { type: 'json' };
import { createGameState } from '../core/gameState.ts';
import { parseTeams } from '../core/teams.ts';
import { addGameToSeason, formatAverage } from './season.ts';

test('打率は .285 のように、打数 0 は -.--- と表示する', () => {
  assert.equal(formatAverage({ pa: 10, ab: 7, h: 2, hr: 0, rbi: 0 }), '.286');
  assert.equal(formatAverage({ pa: 3, ab: 3, h: 3, hr: 1, rbi: 2 }), '1.000');
  assert.equal(formatAverage({ pa: 1, ab: 0, h: 0, hr: 0, rbi: 0 }), '-.---');
});

test('試合の成績を通算に足す', () => {
  const [away, home] = parseTeams(raw);
  const s = createGameState(away, home, 3);
  s.batting = { a: { pa: 4, ab: 3, h: 2, hr: 1, rbi: 3 } };
  const season = addGameToSeason({ a: { pa: 10, ab: 9, h: 3, hr: 0, rbi: 1 }, b: { pa: 1, ab: 1, h: 0, hr: 0, rbi: 0 } }, s);
  assert.deepEqual(season.a, { pa: 14, ab: 12, h: 5, hr: 1, rbi: 4 });
  assert.deepEqual(season.b, { pa: 1, ab: 1, h: 0, hr: 0, rbi: 0 });
});
