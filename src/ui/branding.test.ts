import assert from 'node:assert/strict';
import test from 'node:test';
import raw from '../data/teams.json' with { type: 'json' };
import { parseTeams } from '../core/teams.ts';
import { mascotName, teamLogoSvg, teamMascotSvg } from './branding.ts';

test('12球団にそれぞれ固有のロゴとマスコットがある', () => {
  const teams = parseTeams(raw);
  assert.equal(teams.length, 12);
  assert.equal(new Set(teams.map((t) => mascotName(t.id))).size, 12);
  assert.equal(new Set(teams.map(teamLogoSvg)).size, 12);
  assert.equal(new Set(teams.map(teamMascotSvg)).size, 12);
  for (const team of teams) {
    assert.match(teamLogoSvg(team), new RegExp(`${team.nameJa}のロゴ`));
    assert.match(teamMascotSvg(team), new RegExp(mascotName(team.id)));
  }
});
