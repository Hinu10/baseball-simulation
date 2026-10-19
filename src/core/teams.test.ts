import assert from 'node:assert/strict';
import { test } from 'node:test';
import raw from '../data/teams.json' with { type: 'json' };
import { lineupOf, parseTeams, TeamDataError } from './teams.ts';

const clone = () => structuredClone(raw) as { teams: any[] };

test('同梱の teams.json は2球団とも検証を通る', () => {
  const teams = parseTeams(raw);
  assert.deepEqual(
    teams.map((t) => t.name),
    ['Tokyo Comets', 'Osaka Wolves']
  );
  for (const t of teams) {
    assert.ok(t.batters.length >= 9);
    assert.ok(t.pitchers.length >= 3);
    assert.equal(lineupOf(t).length, 9);
  }
  assert.notEqual(teams[0].colors.primary, teams[1].colors.primary);
});

test('能力が 0〜100 の外なら弾く', () => {
  const d = clone();
  d.teams[0].batters[0].power = 120;
  assert.throws(() => parseTeams(d), TeamDataError);
});

test('打順の守備位置が欠けていたら弾く', () => {
  const d = clone();
  d.teams[0].batters[0].position = 'SS';
  assert.throws(() => parseTeams(d), /守備位置/);
});

test('打順にいない選手 id や重複を弾く', () => {
  const d = clone();
  d.teams[1].lineup[3] = 'nobody';
  assert.throws(() => parseTeams(d), /野手にいません/);
  const e = clone();
  e.teams[1].lineup[3] = e.teams[1].lineup[2];
  assert.throws(() => parseTeams(e), /2回/);
});

test('知らない球種を弾く', () => {
  const d = clone();
  d.teams[0].pitchers[0].pitches.push('knuckle');
  assert.throws(() => parseTeams(d), /球種/);
});
