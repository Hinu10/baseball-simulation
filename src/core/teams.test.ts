import assert from 'node:assert/strict';
import { test } from 'node:test';
import raw from '../data/teams.json' with { type: 'json' };
import { DEFAULT_PARK, parkOf } from './field.ts';
import { allBatters, glowColor, inkOn, lineupOf, luminance, managerOf, parseTeams, roleOf, rotationStarter, TeamDataError, textColor } from './teams.ts';

const clone = () => structuredClone(raw) as { teams: any[] };

test('同梱の teams.json は12球団とも検証を通る', () => {
  const teams = parseTeams(raw);
  assert.deepEqual(
    teams.map((t) => t.nameJa),
    ['マイカイスピーカー', 'ジョガワコーク', 'スマーリンズ', '花桜', '神山国', 'ファクロムエックス', '寛ブタイガー', '万山グース', 'オネタール', 'サックスターズ', 'メリークッスーズ', '金ノダンク']
  );
  for (const t of teams) {
    assert.ok(t.batters.length >= 9);
    assert.ok(t.pitchers.length >= 3);
    assert.equal(lineupOf(t).length, 9);
  }
  assert.equal(new Set(teams.map((t) => t.colors.primary)).size, teams.length);
  assert.equal(new Set(teams.flatMap((t) => [...t.batters, ...t.pitchers].map((p) => p.name))).size, teams.reduce((n, t) => n + t.batters.length + t.pitchers.length, 0));
});

test('チームカラーが明るくても、白い背景・暗い背景で読める文字色を選ぶ', () => {
  for (const t of parseTeams(raw)) {
    assert.ok(luminance(textColor(t.colors)) < 0.3, `${t.nameJa} の文字色`);
    assert.ok(luminance(glowColor(t.colors)) > 0.1, `${t.nameJa} のスコアボードの色`);
    const ink = inkOn(t.colors.primary);
    const contrast = (a: string, b: string) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
    assert.ok(contrast(ink, t.colors.primary) >= 3, `${t.nameJa} のタブの文字`);
  }
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

test('各球団の登録は29〜31人で、先発・中継ぎ・抑えがそろい、先発はローテーションで回る', () => {
  for (const t of parseTeams(raw)) {
    const n = t.batters.length + t.pitchers.length;
    assert.ok(n >= 29 && n <= 31, `${t.nameJa} は ${n} 人`);
    const starters = t.pitchers.filter((p) => roleOf(p) === 'starter');
    assert.ok(starters.length >= 5 && t.pitchers.some((p) => roleOf(p) === 'reliever') && t.pitchers.some((p) => roleOf(p) === 'closer'), t.nameJa);
    assert.equal(rotationStarter(t, 0), t.startingPitcher);
    const order = Array.from({ length: starters.length }, (_, i) => rotationStarter(t, i));
    assert.equal(new Set(order).size, starters.length, '一巡するまで同じ先発は出ない');
    assert.equal(rotationStarter(t, starters.length), t.startingPitcher);
  }
});

test('各球団の首脳陣：先頭が監督で、背番号は選手と重ならない', () => {
  const managers = Object.fromEntries(parseTeams(raw).map((t) => [t.id, managerOf(t).name.split(' ')[0]]));
  const first = Object.fromEntries(Object.entries(managers).slice(0, 6));
  assert.deepEqual(first, { hanazakura: '上尾', kamiyama: '河卿田', jogawa: '元新', maikai: '考田', facrom: '加野尾', smarlins: '澤' });
  for (const t of parseTeams(raw)) {
    const players = new Set([...t.batters, ...t.pitchers].map((p) => p.number));
    for (const m of t.staff) assert.ok(!players.has(m.number), `${t.shortName} ${m.name}`);
  }
});

test('各球団に2軍と育成の選手がいて、育成の背番号は3桁', () => {
  for (const t of parseTeams(raw)) {
    assert.ok(t.farm!.batters.length >= 6 && t.farm!.pitchers.length >= 6, t.shortName);
    assert.ok(t.development!.batters.length && t.development!.pitchers.length, t.shortName);
    for (const p of [...t.development!.batters, ...t.development!.pitchers]) assert.ok(p.number >= 100, p.name);
  }
  const c = clone();
  c.teams[0].development.batters[0].number = 5;
  assert.throws(() => parseTeams(c), TeamDataError);
});

test('寛ブタイガーの主力：4人がスタメンで、開幕投手は風嵐。海外に移った淵野はいない', () => {
  const t = parseTeams(raw).find((x) => x.id === 'kanbu')!;
  const names = lineupOf(t).map((b) => b.name);
  for (const n of ['中座 玲', '畑見 一樹', '川鷺 尤輔', '大森 煌大']) assert.ok(names.includes(n), n);
  assert.equal(t.pitchers.find((p) => p.id === t.startingPitcher)!.name, '風嵐 柊弥');
  assert.ok(!allBatters(t).some((b) => b.name.startsWith('淵野')));
});

test('12球団すべてに本拠地の球場がある', () => {
  for (const t of parseTeams(raw)) assert.notEqual(parkOf(t.id), DEFAULT_PARK, t.shortName);
  assert.ok(parkOf('kanbu').fence.center > Math.max(...parseTeams(raw).filter((t) => t.id !== 'kanbu').map((t) => parkOf(t.id).fence.center)), '寛ブドームが一番広い');
});
