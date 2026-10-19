import assert from 'node:assert/strict';
import { test } from 'node:test';
import raw from '../data/teams.json' with { type: 'json' };
import { conditionedTeam, conditionLevel, initialConditions, nextConditions, type Conditions } from './condition.ts';
import { Rng } from './rng.ts';
import { parseTeams } from './teams.ts';

const teams = parseTeams(raw);
const [team] = teams;

test('調子で打者・投手の能力が上下し、0〜100 におさまる', () => {
  const b = team.batters[0];
  const p = team.pitchers[0];
  const hot = conditionedTeam(team, { [b.id]: 1, [p.id]: 1 });
  const cold = conditionedTeam(team, { [b.id]: -1, [p.id]: -1 });
  assert.ok(hot.batters[0].meet > b.meet || b.meet === 100);
  assert.ok(cold.batters[0].meet < b.meet);
  assert.equal(hot.pitchers[0].velocity, p.velocity + 3);
  assert.equal(cold.pitchers[0].stamina, p.stamina);
  for (const t of [hot, cold]) for (const x of t.batters) assert.ok(x.meet >= 0 && x.meet <= 100 && x.power >= 0 && x.power <= 100);
  assert.equal(hot.batters[0].condition, 1);
  // 元の球団データは書き換えない。
  assert.equal(team.batters[0].condition, undefined);
});

test('調子の段階', () => {
  assert.equal(conditionLevel(0.8).label, '絶好調');
  assert.equal(conditionLevel(0.3).label, '好調');
  assert.equal(conditionLevel(0).label, '普通');
  assert.equal(conditionLevel(-0.3).label, '不調');
  assert.equal(conditionLevel(-0.9).label, '絶不調');
});

test('好調・不調は数試合続き、長い目で見ると普通の日が多い', () => {
  const rng = new Rng(7);
  const random = () => rng.next();
  let c: Conditions = initialConditions(teams, random);
  const ids = Object.keys(c);
  const series: number[][] = ids.map(() => []);
  for (let day = 0; day < 300; day++) {
    c = nextConditions(c, teams, {}, {}, random);
    ids.forEach((id, i) => series[i].push(c[id]));
  }
  const all = series.flat();
  // 次の日の調子との相関（自己相関）。好不調が続くなら正に大きい。
  let num = 0;
  let den = 0;
  for (const s of series) for (let i = 1; i < s.length; i++) num += s[i] * s[i - 1];
  for (const v of all) den += v * v;
  const corr = num / den;
  assert.ok(corr > 0.6 && corr < 0.9, `自己相関 ${corr}`);
  const share = (label: string) => all.filter((v) => conditionLevel(v).label === label).length / all.length;
  assert.ok(share('普通') > 0.25 && share('普通') < 0.45, `普通 ${share('普通')}`);
  assert.ok(share('絶好調') > 0.03 && share('絶好調') < 0.2, `絶好調 ${share('絶好調')}`);
  assert.ok(share('絶不調') > 0.03 && share('絶不調') < 0.2, `絶不調 ${share('絶不調')}`);
});

test('よく打った選手は調子が上がりやすく、打たれた投手は下がりやすい', () => {
  const b = team.batters[0].id;
  const p = team.pitchers[0].id;
  // ゆらぎを同じにして、成績の分だけ比べる。
  const fixed = () => 0.5;
  const base = nextConditions({ [b]: 0, [p]: 0 }, teams, {}, {}, fixed);
  const after = nextConditions({ [b]: 0, [p]: 0 }, teams, { [b]: { pa: 4, ab: 4, h: 3, hr: 1, rbi: 3 } }, { [p]: { outs: 9, r: 6, h: 8, so: 1, bb: 2, w: 0, l: 1 } }, fixed);
  assert.ok(after[b] > base[b]);
  assert.ok(after[p] < base[p]);
});
