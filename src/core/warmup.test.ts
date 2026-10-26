import assert from 'node:assert/strict';
import { test } from 'node:test';
import { basePos } from './field.ts';
import { distXZ } from './math.ts';
import { Warmup } from './warmup.ts';

test('投球練習：投手が投げ、最後に捕手が二塁へ送球して二塁手が捕る', () => {
  const w = new Warmup();
  let pitched = false;
  let atCatcher = false;
  for (let t = 0; t < w.duration; t += 0.02) {
    if (w.pitcher(t).anim === 'pitch') pitched = true;
    if (w.ball(t).z < 0) atCatcher = true;
  }
  assert.ok(pitched && atCatcher);
  const end = w.duration;
  assert.equal(w.catcher(end).anim, 'throw');
  assert.equal(w.cover(end).anim, 'catch');
  assert.ok(distXZ(w.ball(end), basePos(2)) < 0.5, 'ボールが二塁に届いていない');
  assert.ok(distXZ(w.cover(end).pos, basePos(2)) < 1);
});
