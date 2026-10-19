import assert from 'node:assert/strict';
import { test } from 'node:test';
import raw from '../data/teams.json' with { type: 'json' };
import { glowColor, inkOn, lineupOf, luminance, parseTeams, TeamDataError, textColor } from './teams.ts';

const clone = () => structuredClone(raw) as { teams: any[] };

test('同梱の teams.json は6球団とも検証を通る', () => {
  const teams = parseTeams(raw);
  assert.deepEqual(
    teams.map((t) => t.nameJa),
    ['マイカイスピーカー', 'ジョガワコーク', 'スマーリンズ', '花桜', '神山国', 'ファクロムエックス']
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
