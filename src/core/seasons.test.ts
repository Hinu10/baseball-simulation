import assert from 'node:assert/strict';
import { test } from 'node:test';
import raw from '../data/teams.json' with { type: 'json' };
import { SEASON_YEAR } from './pennant.ts';
import { PAST_ROSTERS, SEASON_YEARS, swappedId, teamsOf } from './seasons.ts';
import { lineupOf, parseTeams } from './teams.ts';

const teams = parseTeams(raw);

test('いまのシーズンは球団データのまま、2025年は寛ブに渕野が戻り4番・捕手で出る', () => {
  assert.equal(SEASON_YEARS[0], SEASON_YEAR);
  assert.equal(teamsOf(SEASON_YEAR, teams), teams);
  const kanbu = teamsOf(2025, teams).find((t) => t.id === 'kanbu')!;
  const order = lineupOf(kanbu);
  assert.equal(order[3].name, '渕野 剛臣');
  assert.equal(order[3].position, 'C');
  // DH はフレッティーで、ミラーはまだいない。
  assert.equal(order[6].name, 'フレッティー');
  assert.ok(![...kanbu.batters, ...kanbu.farm!.batters].some((b) => b.name === 'ミラー'));
  // 右翼は井崎で、川鷺は控え（代打）。
  assert.equal(order[4].name, '井崎 涼介');
  assert.ok(!order.some((b) => b.name === '川鷺 尤輔') && kanbu.batters.some((b) => b.name === '川鷺 尤輔'));
  // エースの風嵐は故障で2軍にいて、開幕投手はほかの先発。
  assert.ok(!kanbu.pitchers.some((p) => p.name === '風嵐 柊弥'));
  assert.ok(kanbu.farm!.pitchers.find((p) => p.name === '風嵐 柊弥')!.injured! > 0);
  assert.notEqual(kanbu.startingPitcher, 'kbt-p1');
  assert.ok(kanbu.pitchers.some((p) => p.id === kanbu.startingPitcher));
});

test('2026年の名簿は2027年の変更から独立した練習試合用の名簿', () => {
  assert.deepEqual(SEASON_YEARS, [2027, 2026, 2025]);
  const archived = teamsOf(2026, teams);
  assert.notEqual(archived, teams);
  assert.deepEqual(archived.map((t) => t.lineup), teams.map((t) => t.lineup));
  assert.equal(archived.find((t) => t.id === 'kanbu')!.batters.some((b) => b.name === '渕野 剛臣'), false);
});

test('毎年の入れ替え：2025年は今いる選手の枠に、その年だけいた選手が同じ背番号・役割で入る', () => {
  const past = teamsOf(2025, teams);
  for (const r of PAST_ROSTERS[2025]) {
    const now = teams.find((t) => t.id === r.team)!;
    const then = past.find((t) => t.id === r.team)!;
    const all = (t: typeof now) => [...t.batters, ...t.pitchers, ...(t.farm?.batters ?? []), ...(t.farm?.pitchers ?? []), ...(t.development?.batters ?? []), ...(t.development?.pitchers ?? [])];
    for (const sw of r.swaps ?? []) {
      const before = all(now).find((p) => p.id === sw.out)!;
      const after = all(then).find((p) => p.id === swappedId(2025, sw.out))!;
      assert.ok(after, `${sw.name} がいない`);
      assert.equal(after.name, sw.name);
      assert.equal(after.number, before.number);
      assert.ok(!all(then).some((p) => p.id === sw.out), `${before.name} は2025年にはまだいない`);
    }
    // 打順に入れ替えた選手がいれば、新しい id に置き換わっている。
    for (const id of then.lineup) assert.ok(then.batters.some((b) => b.id === id));
  }
});

test('過去の年度の球団も、球団データの決まり（背番号・打順・守備位置）を満たす', () => {
  for (const year of Object.keys(PAST_ROSTERS).map(Number)) {
    const past = teamsOf(year, teams);
    assert.doesNotThrow(() => parseTeams(Array.isArray(raw) ? past : { ...(raw as object), teams: past }), `${year}年の球団データがおかしい`);
  }
});
