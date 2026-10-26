import assert from 'node:assert/strict';
import { test } from 'node:test';
import { basePos, DEFAULT_PARK, dugoutPos } from './field.ts';
import { GREETERS, HomeRunTrot } from './homerunTrot.ts';
import { distXZ } from './math.ts';

test('本塁打の後、打者は一塁・二塁・三塁を回って本塁を踏み、ベンチのほうへ歩いていく', () => {
  const trot = new HomeRunTrot([0.2, null, null, null], dugoutPos(DEFAULT_PARK, 1));
  const seen = new Set<number>();
  for (let t = 0; t < trot.batterHome; t += 0.05) {
    const p = trot.batterPos(t);
    for (const b of [1, 2, 3]) if (distXZ(p, basePos(b)) < 0.5) seen.add(b);
  }
  assert.deepEqual([...seen].sort(), [1, 2, 3]);
  assert.ok(distXZ(trot.batterPos(trot.batterHome), basePos(4)) < 0.1);
  // 一塁側のベンチへ向かう。
  assert.ok(trot.batterPos(trot.duration).x > 3);
  assert.ok(trot.duration > trot.batterHome + 2 && trot.duration < 25);
});

test('先に生還した走者は本塁で、仲間はベンチの前に並んで待ち、打者と一人ずつハイタッチする', () => {
  // 一塁・三塁に走者がいるスリーランで、攻撃側は三塁側のベンチ。
  const dugout = dugoutPos(DEFAULT_PARK, -1);
  const trot = new HomeRunTrot([0.1, 1.2, null, 3.05], dugout);
  // 打者が着く少し前には、生還した走者は本塁の近く、仲間はベンチの前で待っている。
  const wait = trot.batterHome - 0.2;
  const runners = trot.runners(wait);
  assert.equal(runners[2], null);
  for (const i of [1, 3]) assert.ok(distXZ(runners[i]!.pos, basePos(4)) < 5, `走者 ${i} が本塁の近くにいない`);
  const greeters = trot.greeters(wait);
  assert.equal(greeters.length, GREETERS);
  for (const g of greeters) {
    assert.ok(distXZ(g.pos, dugout) < 6, 'ベンチの前にいない');
    assert.equal(g.anim, 'idle');
  }
  // 本塁を踏んだ後、走者 2 人と仲間の全員がいずれかの時刻でハイタッチする。仲間とはベンチの前で。
  const fived = new Set<string>();
  for (let t = trot.batterHome; t < trot.duration; t += 0.02) {
    trot.runners(t).forEach((r, i) => i > 0 && r?.anim === 'highfive' && fived.add(`r${i}`));
    trot.greeters(t).forEach((g, k) => {
      if (g.anim !== 'highfive') return;
      fived.add(`g${k}`);
      assert.ok(distXZ(trot.batterPos(t), dugout) < 7, '打者がベンチの前にいない');
    });
  }
  assert.equal(fived.size, 2 + GREETERS);
  // 最後は打者も走者もベンチの前にいる。
  for (const r of trot.runners(trot.duration)) if (r) assert.ok(distXZ(r.pos, dugout) < 8);
});

test('ソロ本塁打でも、次の打者が本塁で待っていて打者とハイタッチし、そのまま本塁の近くに残る', () => {
  const trot = new HomeRunTrot([0.2, null, null, null], dugoutPos(DEFAULT_PARK, 1));
  const wait = trot.nextBatter(trot.batterHome - 0.2);
  assert.ok(distXZ(wait.pos, basePos(4)) < 3, '次の打者が本塁の近くにいない');
  assert.equal(wait.anim, 'idle');
  let fived = -1;
  for (let t = trot.batterHome; t < trot.duration && fived < 0; t += 0.02) if (trot.nextBatter(t).anim === 'highfive') fived = t;
  assert.ok(fived > 0 && distXZ(trot.batterPos(fived), basePos(4)) < 3, '本塁の近くでハイタッチしていない');
  assert.ok(distXZ(trot.nextBatter(trot.duration).pos, basePos(4)) < 3);
});
