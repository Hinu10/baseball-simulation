import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BENCH_PLAYERS, Brawl } from './brawl.ts';
import { basePos, batterBox, DEFAULT_FIELD_POSITIONS, DEFAULT_PARK, dugoutPos } from './field.ts';
import { distXZ, v3 } from './math.ts';

const setup = (bases: (1 | 2 | 3)[]) =>
  new Brawl({ batter: batterBox('R'), pitcher: DEFAULT_FIELD_POSITIONS.P, bases, offenseDugout: dugoutPos(DEFAULT_PARK, 1), defenseDugout: dugoutPos(DEFAULT_PARK, -1), seed: 3 });

test('死球の直後、打者は打席でうずくまり、やがて両軍のベンチと監督が飛び出して真ん中でもみ合う', () => {
  const b = setup([1]);
  assert.equal(b.offense(0.3)[0]!.anim, 'hurt');
  const mid = 8;
  const center = v3(0, 0, 8);
  const off = b.bench('offense', mid);
  const def = b.bench('defense', mid);
  assert.equal(off.length, BENCH_PLAYERS + 1);
  for (const f of [...off, ...def, b.offense(mid)[0]!]) assert.ok(distXZ(f.pos, center) < 7, 'もみ合いの輪にいない');
  assert.ok([...off, ...def].slice(0, BENCH_PLAYERS).some((f) => f.anim === 'shove'));
  // 監督は押し合わず、相手の監督に抗議する。
  assert.equal(off[BENCH_PLAYERS].anim, 'point');
  assert.equal(def[BENCH_PLAYERS].anim, 'point');
  // 内野手も駆けつける。
  const fielders = b.fielders(mid);
  assert.ok(distXZ(fielders[1].pos, center) < 7);
});

test('乱闘が収まると、打者は一塁へ、押し出された走者は次の塁へ、ベンチの選手はベンチへ戻る', () => {
  const b = setup([1, 3]);
  const end = b.duration;
  const [batter, r1, r2, r3] = b.offense(end);
  assert.ok(distXZ(batter!.pos, basePos(1)) < 0.1);
  assert.ok(distXZ(r1!.pos, basePos(2)) < 0.1);
  assert.equal(r2, null);
  // 三塁の走者は押し出されない（二塁が空いている）。
  assert.ok(distXZ(r3!.pos, basePos(3)) < 0.1);
  for (const f of b.bench('offense', end)) assert.ok(distXZ(f.pos, dugoutPos(DEFAULT_PARK, 1)) < 4);
});
