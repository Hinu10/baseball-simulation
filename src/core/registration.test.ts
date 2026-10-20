import assert from 'node:assert/strict';
import { test } from 'node:test';
import raw from '../data/teams.json' with { type: 'json' };
import { FRAGILITY, initialRegistration, injuryChance, INJURY_DAYS, REREGISTER_DAYS, registeredTeam, rosterMoves } from './registration.ts';
import { parseTeams, roleOf } from './teams.ts';

const teams = parseTeams(raw);
const t = teams[0];
/** 入れ替え・支配下登録は必ず起き、ふつうの選手は故障しない乱数。 */
const always = () => 0.002;

test('開幕時の登録は teams.json のとおり', () => {
  const r = registeredTeam(t, initialRegistration(t));
  assert.deepEqual(r.batters.map((b) => b.id), t.batters.map((b) => b.id));
  assert.deepEqual(r.farm!.pitchers.map((p) => p.id), t.farm!.pitchers.map((p) => p.id));
  assert.deepEqual(r.lineup, t.lineup);
});

test('ひどい不調の1軍の選手を抹消し、同じ守備位置の2軍の選手を登録する。打順の穴もその選手で埋める', () => {
  const out = t.batters.find((b) => b.id === t.lineup[0])!;
  const conditions = { [out.id]: -1 };
  const { registrations, notices } = rosterMoves({}, [t], conditions, 5, always);
  const kinds = notices.filter((n) => n.kind !== 'sign');
  assert.equal(kinds.length, 2);
  const up = t.farm!.batters.find((b) => b.id === kinds.find((n) => n.kind === 'up')!.id)!;
  assert.equal(up.position, out.position);
  assert.equal(kinds.find((n) => n.kind === 'down')!.id, out.id);
  const r = registeredTeam(t, registrations[t.id]);
  assert.ok(!r.batters.some((b) => b.id === out.id) && r.farm!.batters.some((b) => b.id === out.id));
  assert.equal(r.lineup[0], up.id);
  assert.equal(r.batters.length, t.batters.length, '1軍の人数は変わらない');
});

test('抹消された選手は10日たつまで再登録できない', () => {
  const out = t.pitchers.find((p) => roleOf(p) === 'starter' && p.id !== t.startingPitcher)!;
  const first = rosterMoves({}, [t], { [out.id]: -1 }, 1, always);
  const up = first.notices.find((n) => n.kind === 'up')!;
  // 上がった投手が不調になっても、2軍に落ちた投手はまだ戻れない（ほかの2軍の先発が上がる）。
  for (const day of [2, 1 + REREGISTER_DAYS]) {
    const again = rosterMoves(first.registrations, [t], { [up.id]: -1, [out.id]: 1 }, day, always);
    const back = again.notices.find((n) => n.kind === 'up')!;
    assert.equal(back.id === out.id, day >= 1 + REREGISTER_DAYS, `${day}日目`);
  }
});

test('育成選手の支配下登録で、背番号が2桁になって2軍に入る', () => {
  const { registrations, notices } = rosterMoves({}, [t], {}, 3, always);
  const sign = notices.find((n) => n.kind === 'sign')!;
  assert.ok(sign.number < 70);
  const r = registeredTeam(t, registrations[t.id]);
  const p = [...r.farm!.batters, ...r.farm!.pitchers].find((x) => x.id === sign.id)!;
  assert.equal(p.number, sign.number);
  assert.ok(![...r.development!.batters, ...r.development!.pitchers].some((x) => x.id === sign.id));
});

test('入れ替えはたまにしか起きない', () => {
  const never = () => 0.99;
  const { notices } = rosterMoves({}, teams, Object.fromEntries(teams.flatMap((x) => x.batters.map((b) => [b.id, -1]))), 1, never);
  assert.equal(notices.length, 0);
});

test('故障しやすい選手ほど故障しやすく、故障すると抹消されて代わりが上がり、治ると戻る', () => {
  assert.ok(injuryChance({ fragility: 95 }) > 15 * injuryChance({}));
  assert.equal(injuryChance({}), FRAGILITY.perDay);
  const ace = t.pitchers.find((p) => p.id === t.startingPitcher)!;
  const fragile = { ...t, pitchers: t.pitchers.map((p) => (p.id === ace.id ? { ...p, fragility: 100 } : p)) };
  // 故障しやすさ 100 の投手だけが故障する乱数（ほかの選手の確率よりは大きく、その投手の確率よりは小さい）。
  const hurt = rosterMoves({}, [fragile], {}, 1, () => injuryChance({ fragility: 60 }));
  const down = hurt.notices.find((n) => n.kind === 'down')!;
  assert.equal(down.id, ace.id);
  assert.equal(down.reason, '故障');
  const up = hurt.notices.find((n) => n.kind === 'up')!;
  const r = registeredTeam(fragile, hurt.registrations[t.id], 2);
  const inFarm = r.farm!.pitchers.find((p) => p.id === ace.id)!;
  assert.ok(inFarm.injured! >= INJURY_DAYS.min - 1, '2軍で故障の残り日数を持つ');
  assert.notEqual(r.startingPitcher, ace.id);
  // 治るまでは戻らず、治ったら代わりの選手と入れ替わって1軍に戻る。
  const until = hurt.registrations[t.id].injuredUntil![ace.id];
  const never = () => 0.99;
  const still = rosterMoves(hurt.registrations, [fragile], {}, until - 1, never);
  assert.ok(!still.registrations[t.id].active.includes(ace.id));
  const back = rosterMoves(hurt.registrations, [fragile], {}, until, never);
  assert.ok(back.registrations[t.id].active.includes(ace.id));
  assert.ok(!back.registrations[t.id].active.includes(up.id));
});
