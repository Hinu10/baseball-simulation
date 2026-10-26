import assert from 'node:assert/strict';
import { test } from 'node:test';
import raw from '../data/teams.json' with { type: 'json' };
import { parseTeams } from '../core/teams.ts';
import { uniformLook } from './uniforms.ts';

test('12球団それぞれに異なるホーム・ビジターユニフォームがある', () => {
  const teams = parseTeams(raw);
  assert.equal(teams.length, 12);
  const looks = teams.flatMap((team) => {
    const home = uniformLook(team, 'home');
    const visitor = uniformLook(team, 'visitor');
    assert.notEqual(home.uniform, visitor.uniform, team.id);
    assert.notEqual(home.lettering, visitor.lettering, team.id);
    return [home, visitor].map((look) => `${look.uniform}/${look.trim}/${look.pattern}`);
  });
  assert.equal(new Set(looks).size, 24);
});
