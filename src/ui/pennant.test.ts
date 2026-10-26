import assert from 'node:assert/strict';
import { test } from 'node:test';
import raw from '../data/teams.json' with { type: 'json' };
import { emptyPennant } from '../core/pennant.ts';
import type { Postseason } from '../core/postseason.ts';
import type { Notice } from '../core/registration.ts';
import { parseTeams } from '../core/teams.ts';
import { PAST_SEASONS, pennantHtml, PENNANT_TABS } from './pennant.ts';

const teams = parseTeams(raw);

test('2025年と2026年は全球団143試合を終えた記録として残る', () => {
  assert.deepEqual(PAST_SEASONS.map((s) => s.year), [2026, 2025]);
  for (const season of PAST_SEASONS) {
    const rows = season.leagues.flatMap((league) => league.rows);
    assert.equal(rows.length, 12);
    assert.ok(rows.every((r) => r.w + r.l + r.t === 143), `${season.year}年に未消化試合がある`);
    assert.ok(season.stats && Object.keys(season.stats.batting).length > 0);
    assert.ok(PENNANT_TABS.includes(`${season.year}年`));
  }
});

test('公示のタブ：新しい日から、同じ日は登録・抹消の順に並ぶ', () => {
  const t = teams[0];
  const n = (day: number, kind: Notice['kind'], name: string): Notice => ({ day, team: t.id, kind, id: name, name, number: 1, group: '投手' });
  const p = { ...emptyPennant(), day: 9, notices: [n(3, 'up', '甲'), n(3, 'down', '乙'), n(9, 'sign', '丙')] };
  const html = pennantHtml(p, teams, PENNANT_TABS.indexOf('公示'), t.id);
  assert.ok(html.indexOf('9日目') < html.indexOf('3日目'));
  assert.ok(html.indexOf('甲') < html.indexOf('乙'));
  assert.ok(html.includes('支配下選手登録') && html.includes('出場選手登録抹消'));
  assert.ok(pennantHtml(emptyPennant(), teams, 3, t.id).includes('まだ公示はありません'));
});

test('前の年のタブに、ニーマシリーズ・最終順位・タイトルの上位が出る', () => {
  const tab = PENNANT_TABS.indexOf('2025年' as (typeof PENNANT_TABS)[number]);
  assert.ok(tab >= 5, '2025年のタブがある');
  const html = pennantHtml(emptyPennant(), teams, tab, teams[0].id);
  const s = PAST_SEASONS.find((x) => x.year === 2025)!;
  assert.ok(html.includes('ニーマシリーズ') && html.includes('で優勝'));
  assert.equal((html.match(/第\d戦/g) ?? []).length, s.series.games.length);
  for (const lg of s.leagues) assert.ok(html.includes(lg.name));
  assert.ok(html.includes(s.titles[0].leaders[0].name));
  // シリーズの勝ち数は 4 勝。
  assert.equal(Math.max(...s.series.wins), 4);
});

test('2025年：海外に移った渕野（寛ブ）が三冠王で、首位打者・本塁打王・打点王の1位に入る', () => {
  const s = PAST_SEASONS.find((x) => x.year === 2025)!;
  for (const [label, value] of [['首位打者', '.418'], ['本塁打王', '88'], ['打点王', '231']]) {
    const t = s.titles.find((x) => x.league === 'ガイア・リーグ' && x.label === label)!;
    assert.deepEqual(t.leaders[0], { name: '渕野 剛臣', team: 'kanbu', value }, label);
    assert.equal(t.leaders.length, 3);
  }
  const html = pennantHtml(emptyPennant(), teams, PENNANT_TABS.indexOf('2025年' as (typeof PENNANT_TABS)[number]), teams[0].id);
  assert.ok(html.includes('三冠王　渕野 剛臣'));
});

test('2025年のニーマシリーズ：寛ブが神山国に4連勝、どの試合も大差', () => {
  const sr = PAST_SEASONS.find((x) => x.year === 2025)!.series;
  assert.equal(sr.winner, 'kanbu');
  assert.deepEqual(sr.wins[sr.teams.indexOf('kanbu')], 4);
  assert.equal(sr.games.length, 4);
  for (const g of sr.games) {
    const [win, lose] = g.away === 'kanbu' ? [g.awayRuns, g.homeRuns] : [g.homeRuns, g.awayRuns];
    assert.ok(win - lose >= 5, `第${g.n}戦`);
  }
});

test('2025年のペナント：寛ブが95勝で優勝し、勝ちと負けの数は全体で釣り合う', () => {
  const s = PAST_SEASONS.find((x) => x.year === 2025)!;
  const gaia = s.leagues.find((l) => l.name === 'ガイア・リーグ')!;
  assert.deepEqual([gaia.rows[0].team, gaia.rows[0].w, gaia.rows[0].gb], ['kanbu', 95, 0]);
  const rows = s.leagues.flatMap((l) => l.rows);
  assert.equal(rows.reduce((n, r) => n + r.w, 0), rows.reduce((n, r) => n + r.l, 0));
  assert.equal(s.series.teams[0], 'kanbu', '勝率の高い寛ブが第1戦の本拠地');
});

test('2025年の記録：得点と失点は全体で釣り合い、寛ブの打点の合計は得点を超えない', () => {
  const s = PAST_SEASONS.find((x) => x.year === 2025)!;
  const rows = s.leagues.flatMap((l) => l.rows);
  assert.equal(rows.reduce((n, r) => n + r.rs, 0), rows.reduce((n, r) => n + r.ra, 0));
  const kanbu = rows.find((r) => r.team === 'kanbu')!;
  const rbi = Object.entries(s.stats!.batting)
    .filter(([id]) => id.startsWith('kbt-'))
    .reduce((n, [, l]) => n + l.rbi, 0);
  assert.ok(rbi <= kanbu.rs, `打点 ${rbi} が得点 ${kanbu.rs} を超えている`);
  // 渕野は三冠王の成績、井崎は15本塁打、川鷺は代打が多く打席が少ない。
  assert.equal(s.stats!.batting['kbt-fuchino'].hr, 88);
  assert.equal(s.stats!.batting['kbt-izaki'].hr, 15);
  assert.ok(s.stats!.batting['kbt-03'].pa < 200);
  // ミラーはこの年いない。
  assert.equal(s.stats!.batting['kbt-16'], undefined);
});

test('ニーマシリーズのタブ：各試合のスコア（イニングごと・R・H）と、投手の役割つきの成績が出る', () => {
  const tab = PENNANT_TABS.indexOf('ニーマシリーズ');
  assert.equal(tab, 4);
  assert.ok(pennantHtml(emptyPennant(), teams, tab, 'kanbu').includes('シーズンが終わると'));
  const ps: Postseason = {
    finals: [],
    first: 'kanbu',
    second: 'kamiyama',
    games: [{ n: 1, away: 'kamiyama', home: 'kanbu', awayRuns: 1, homeRuns: 2, innings: [[0, 0, 1, 0, 0, 0, 0, 0, 0], [0, 2, 0, 0, 0, 0, 0, 0]], hits: [5, 7], batting: { a: { pa: 4, ab: 4, h: 2, hr: 1, rbi: 2, bb: 0, so: 1, sb: 1 } } }],
    batting: { a: { pa: 4, ab: 4, h: 2, hr: 1, rbi: 2, g: 1 } },
    pitching: { b: { outs: 27, r: 1, h: 5, so: 9, bb: 1, w: 1, l: 0, g: 1 }, c: { outs: 3, r: 0, h: 0, so: 2, bb: 0, w: 0, l: 0, g: 1 } },
    players: { a: { name: '打者甲', team: 'kanbu' }, b: { name: '投手乙', team: 'kanbu', role: 'starter' }, c: { name: '投手丙', team: 'kamiyama', role: 'closer' } }
  };
  const p = { ...emptyPennant(), postseason: ps };
  const over = Object.fromEntries(teams.map((t) => [t.id, { w: 72, l: 71, t: 0, rs: 0, ra: 0, innings: 9 * 143 }]));
  const html = pennantHtml({ ...p, teams: over }, teams, tab, 'kanbu');
  assert.ok(html.includes('第1戦') && html.includes('<th>R</th><th>H</th>'));
  assert.ok(html.includes('<td>X</td>'), '後攻が勝って9回裏が無ければ X');
  assert.ok(html.includes('打者甲') && html.includes('.500'));
  assert.ok(html.includes('<summary>各打者の成績</summary>') && html.includes('打者甲</td><td>4</td><td>4</td><td>2</td><td>1</td><td>2</td>'), '試合ごとの打者の成績');
  assert.ok(html.includes('投手乙</td><td class="role">先発') && html.includes('投手丙</td><td class="role">抑え'));
});
