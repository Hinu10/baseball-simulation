import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bullpenGate, DEFAULT_FIELD_POSITIONS, DEFAULT_PARK, dugoutPos, MOUND } from './field.ts';
import { distXZ } from './math.ts';
import { GATHER, PitchingChange } from './relief.ts';

test('監督がマウンドへ歩き、ブルペンから走ってきたリリーフにボールを渡してベンチへ戻る', () => {
  const dugout = dugoutPos(DEFAULT_PARK, 1);
  const r = new PitchingChange(dugout, bullpenGate(1));
  assert.ok(distXZ(r.manager(0).pos, dugout) < 0.1);
  assert.ok(distXZ(r.reliever(0).pos, bullpenGate(1)) < 0.1);
  // 渡すときは、監督もリリーフもマウンドのそばで、同じしぐさをしている。
  const h = r.handoff;
  assert.equal(r.manager(h).anim, 'highfive');
  assert.equal(r.reliever(h).anim, 'highfive');
  assert.ok(distXZ(r.manager(h).pos, MOUND) < 2 && distXZ(r.reliever(h).pos, MOUND) < 1);
  // 内野手と捕手はマウンドに集まり、終わるころには守備位置へ戻っている。
  r.gathering(h).forEach((f) => assert.ok(distXZ(f.pos, MOUND) < 3.5));
  r.gathering(r.duration).forEach((f, i) => assert.ok(distXZ(f.pos, DEFAULT_FIELD_POSITIONS[GATHER[i]]) < 1, `${GATHER[i]} が戻っていない`));
  // 監督と代わった投手はベンチのほうへ向かう。
  assert.ok(distXZ(r.manager(r.duration).pos, dugout) < distXZ(r.manager(h).pos, dugout));
  assert.ok(distXZ(r.leaving(r.duration).pos, dugout) < distXZ(MOUND, dugout));
});

test('自動モードの早回しでは、同じ動きを短い時間で見せる', () => {
  const slow = new PitchingChange(dugoutPos(DEFAULT_PARK, -1), bullpenGate(-1));
  const fast = new PitchingChange(dugoutPos(DEFAULT_PARK, -1), bullpenGate(-1), 2);
  assert.ok(Math.abs(fast.duration * 2 - slow.duration) < 1e-9);
  assert.deepEqual(fast.reliever(1).pos, slow.reliever(2).pos);
});
