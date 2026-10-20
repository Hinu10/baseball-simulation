import assert from 'node:assert/strict';
import { test } from 'node:test';
import raw from '../data/teams.json' with { type: 'json' };
import { emptyPennant } from '../core/pennant.ts';
import type { Notice } from '../core/registration.ts';
import { parseTeams } from '../core/teams.ts';
import { pennantHtml, PENNANT_TABS } from './pennant.ts';

const teams = parseTeams(raw);

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
