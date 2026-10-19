import assert from 'node:assert/strict';
import { test } from 'node:test';
import raw from '../data/teams.json' with { type: 'json' };
import { parseTeams } from '../core/teams.ts';
import { fanShare, outfit } from './crowd.ts';

test('観客はほとんどがユニフォーム姿で、席の場所でホーム・ビジターの割合が変わる', () => {
  const areas = {
    rightField: { x: 60, z: 80, outfield: true },
    leftPole: { x: -60, z: 75, outfield: true },
    leftCenter: { x: -20, z: 110, outfield: true },
    firstBase: { x: 30, z: 10, outfield: false },
    thirdBase: { x: -30, z: 10, outfield: false },
    behindHome: { x: 0, z: -20, outfield: false }
  };
  for (const [name, seat] of Object.entries(areas)) {
    const [home, visitor] = fanShare(seat);
    assert.ok(home + visitor >= 0.9, `${name} は私服が多すぎる`);
  }
  assert.ok(fanShare(areas.rightField)[0] > 0.9);
  assert.ok(fanShare(areas.leftPole)[1] > 0.8);
  assert.ok(fanShare(areas.firstBase)[0] > fanShare(areas.thirdBase)[0]);
  assert.ok(fanShare(areas.thirdBase)[1] > fanShare(areas.firstBase)[1]);
  // 全体ではホームのファンが多い。
  const all = Object.values(areas).map(fanShare);
  assert.ok(all.reduce((n, [h]) => n + h, 0) > all.reduce((n, [, v]) => n + v, 0));
});

test('観客のユニフォームは、どの型でもメインカラーとサブカラーの両方が入る', () => {
  for (const t of parseTeams(raw)) {
    for (const kind of ['home', 'color', 'alt'] as const) {
      const wear = outfit(t.colors, kind);
      assert.ok(wear.includes(t.colors.primary) && wear.includes(t.colors.secondary), `${t.nameJa} の ${kind}`);
    }
  }
});
