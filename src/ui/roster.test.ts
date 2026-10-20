import assert from 'node:assert/strict';
import { test } from 'node:test';
import raw from '../data/teams.json' with { type: 'json' };
import { Match } from '../core/match.ts';
import { parseTeams } from '../core/teams.ts';
import { rank, rosterHtml, seasonStatsHtml } from './roster.ts';

const [away, home] = parseTeams(raw);

test('能力のランクは 95 以上が S、85 以上が A、19 以下が G', () => {
  assert.deepEqual([100, 95, 94, 85, 84, 75, 65, 55, 54, 40, 20, 19, 0].map(rank), ['S', 'S', 'A', 'A', 'B', 'B', 'C', 'D', 'E', 'E', 'F', 'G', 'G']);
});

test('試合前の選手・打順：打順の9人・控え・投手と先発が出る', () => {
  const html = rosterHtml(away);
  for (const b of away.batters) assert.ok(html.includes(b.name), b.name);
  for (const p of away.pitchers) assert.ok(html.includes(p.name), p.name);
  assert.ok(html.includes('控え') && html.includes('先発'));
  assert.ok(html.includes('首脳陣') && html.includes(away.staff[0].name), '監督が出る');
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

test('シーズン成績：全選手が並び、記録のある選手は打率・防御率まで、まだの選手は「―」', () => {
  const [b, idle] = [away.batters[0], away.batters.at(-1)!];
  const p = away.pitchers[0];
  const html = seasonStatsHtml(away, {
    batting: { [b.id]: { pa: 12, ab: 10, h: 3, hr: 1, rbi: 2, bb: 2, so: 3, sb: 1, g: 3 } },
    pitching: { [p.id]: { outs: 20, r: 3, h: 6, so: 8, bb: 2, w: 1, l: 0, g: 2 } }
  });
  for (const x of [...away.batters, ...away.pitchers]) assert.ok(html.includes(x.name), x.name);
  assert.ok(html.includes('.300'), '打率');
  assert.ok(html.includes('4.05') && html.includes('6回2/3'), '防御率と投球回');
  const idleRow = html.slice(html.indexOf(idle.name));
  assert.ok(idleRow.slice(0, idleRow.indexOf('</tr>')).includes('―'), 'まだ出場していない選手');
  // 以前の保存データ（四球・三振・盗塁・試合数が無い）でも表示できる。
  const old = seasonStatsHtml(away, { batting: { [b.id]: { pa: 1, ab: 1, h: 1, hr: 0, rbi: 0 } }, pitching: {} });
  assert.ok(old.includes('1.000'));
  const oldRow = old.slice(old.indexOf(b.name));
  assert.ok(oldRow.slice(0, oldRow.indexOf('</tr>')).includes('<td>―</td>'), '記録の無い欄は 0 でなく「―」');
  assert.ok(rosterHtml(away, undefined, { batting: {}, pitching: {} }).includes('今季の打撃成績'));
});

test('2軍で調整中の選手を出し、成績の表にも残す', () => {
  const down = away.batters.find((b) => !away.lineup.includes(b.id))!;
  const t = { ...away, batters: away.batters.filter((b) => b !== down), farm: { batters: [{ ...down, condition: -1 }], pitchers: [] } };
  const html = rosterHtml(t, undefined, { batting: {}, pitching: {} });
  assert.ok(html.includes('2軍で調整中'));
  assert.ok(html.slice(html.indexOf('今季の打撃成績')).includes(down.name));
});
