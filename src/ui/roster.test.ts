import assert from 'node:assert/strict';
import { test } from 'node:test';
import raw from '../data/teams.json' with { type: 'json' };
import { Match } from '../core/match.ts';
import { parseTeams } from '../core/teams.ts';
import { rank, rosterHtml } from './roster.ts';

const [away, home] = parseTeams(raw);

test('能力のランクは 95 以上が S、85 以上が A、19 以下が G', () => {
  assert.deepEqual([100, 95, 94, 85, 84, 75, 65, 55, 54, 40, 20, 19, 0].map(rank), ['S', 'S', 'A', 'A', 'B', 'B', 'C', 'D', 'E', 'E', 'F', 'G', 'G']);
});

test('試合前の選手・打順：打順の9人・控え・投手と先発が出る', () => {
  const html = rosterHtml(away);
  for (const b of away.batters) assert.ok(html.includes(b.name), b.name);
  for (const p of away.pitchers) assert.ok(html.includes(p.name), p.name);
  assert.ok(html.includes('控え') && html.includes('先発'));
  assert.ok(!html.includes('今日'), '試合前は今日の欄を出さない');
  // 打順どおりに並ぶ。
  const pos = away.lineup.map((id) => html.indexOf(away.batters.find((b) => b.id === id)!.name));
  assert.deepEqual([...pos].sort((a, b) => a - b), pos);
});

test('試合中の選手・打順：いまの打者に印がつき、今日の打席と投球数が出る', () => {
  const m = new Match({ away, home, mode: 'auto', seed: 3 });
  for (let i = 0; i < 200000 && m.state.log.length < 4; i++) m.tick(1 / 30);
  const html = rosterHtml(away, { state: m.state, index: 0 });
  const first = m.state.log.find((e) => e.batterId === away.lineup[0])!;
  assert.ok(html.includes(first.text.replace(/　.*/, '')));
  assert.ok(html.includes('class="current"'), 'いまの打者');
  assert.match(rosterHtml(home, { state: m.state, index: 1 }), /登板中（\d+球）/);
});
