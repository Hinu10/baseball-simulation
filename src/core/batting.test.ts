import assert from 'node:assert/strict';
import { test } from 'node:test';
import raw from '../data/teams.json' with { type: 'json' };
import { createBall, predictPath } from './ballPhysics.ts';
import { battedBallType, cursorSize, EASY_TIMING_SCALE, evaluateSwing, SWING_DURATION, timingWindow, type SwingCommand, type SwingOutcome } from './batting.ts';
import { isFair } from './field.ts';
import { createPitch, type Pitch } from './pitching.ts';
import { Rng } from './rng.ts';
import { parseTeams, type Batter } from './teams.ts';

const [comets] = parseTeams(raw);
const slugger: Batter = { ...comets.batters[3], bats: 'R', meet: 70, power: 85 };
const pitch = (x = 0, y = 0.8): Pitch => ({
  ...createPitch(comets.pitchers[0], { type: 'fastball', target: { x, y } }, 0, new Rng(1)),
  plate: { x, y }
});
const swingAt = (p: Pitch, dt = 0, cursor = p.plate, mode: SwingCommand['mode'] = 'meet'): SwingCommand => ({
  mode,
  cursor: { ...cursor },
  time: p.flightTime - SWING_DURATION + dt
});
const contact = (o: SwingOutcome) => {
  assert.equal(o.kind, 'contact');
  return o as Extract<SwingOutcome, { kind: 'contact' }>;
};

test('タイミングが合い芯で捉えると、速い打球がセンター方向へ飛ぶ', () => {
  const p = pitch();
  const o = contact(evaluateSwing(slugger, p, swingAt(p), new Rng(2)));
  assert.ok(o.sweet);
  assert.ok(o.exitSpeed > 38, `exit=${o.exitSpeed}`);
  assert.ok(Math.abs(o.spray) < 15);
});

test('タイミングが大きくずれたり、カーソルが外れると空振り', () => {
  const p = pitch();
  const w = timingWindow(slugger, 'meet');
  assert.equal(evaluateSwing(slugger, p, swingAt(p, w + 0.01), new Rng(1)).kind, 'miss');
  assert.equal(evaluateSwing(slugger, p, swingAt(p, -(w + 0.01)), new Rng(1)).kind, 'miss');
  assert.equal(evaluateSwing(slugger, p, swingAt(p, 0, { x: 0.4, y: 0.8 }), new Rng(1)).kind, 'miss');
});

test('右打者は早く振ると三塁側へ引っ張り、遅れると一塁側へ流す', () => {
  const p = pitch();
  const w = timingWindow(slugger, 'meet');
  const early = contact(evaluateSwing(slugger, p, swingAt(p, -w * 0.6), new Rng(3)));
  const late = contact(evaluateSwing(slugger, p, swingAt(p, w * 0.6), new Rng(3)));
  assert.ok(early.spray < -15, `early=${early.spray}`);
  assert.ok(late.spray > 15, `late=${late.spray}`);
  const lefty = contact(evaluateSwing({ ...slugger, bats: 'L' }, p, swingAt(p, -w * 0.6), new Rng(3)));
  assert.ok(lefty.spray > 15, `lefty=${lefty.spray}`);
});

test('カーソルが球より上ならゴロ、下ならフライになる', () => {
  const p = pitch();
  const h = cursorSize(slugger, 'meet').halfH;
  const over = contact(evaluateSwing(slugger, p, swingAt(p, 0, { x: 0, y: p.plate.y + h * 0.6 }), new Rng(4)));
  const under = contact(evaluateSwing(slugger, p, swingAt(p, 0, { x: 0, y: p.plate.y - h * 0.6 }), new Rng(4)));
  assert.equal(battedBallType(over.launch), 'ground');
  assert.ok(['fly', 'popup'].includes(battedBallType(under.launch)), `under=${under.launch}`);
});

test('強振はカーソルが小さく、芯で捉えたときの打球が速い', () => {
  assert.ok(cursorSize(slugger, 'power').halfW < cursorSize(slugger, 'meet').halfW);
  const p = pitch();
  const meet = contact(evaluateSwing(slugger, p, swingAt(p, 0, p.plate, 'meet'), new Rng(5)));
  const power = contact(evaluateSwing(slugger, p, swingAt(p, 0, p.plate, 'power'), new Rng(5)));
  assert.ok(power.exitSpeed > meet.exitSpeed + 3);
});

test('バントは遅い打球になる', () => {
  const p = pitch();
  const o = contact(evaluateSwing(slugger, p, { mode: 'meet', cursor: { x: 0, y: 0.82 }, time: 0, bunt: true }, new Rng(6)));
  assert.ok(o.exitSpeed < 15);
  assert.equal(battedBallType(o.launch), 'ground');
});

test('ばらついたスイングからゴロ・ライナー・フライ・ファウル・本塁打がすべて生じる', () => {
  const rng = new Rng(77);
  const seen = new Set<string>();
  for (let i = 0; i < 600; i++) {
    const p = pitch(rng.range(-0.25, 0.25), rng.range(0.5, 1.0));
    const w = timingWindow(slugger, 'power');
    const s = swingAt(p, rng.range(-w, w), { x: p.plate.x + rng.gauss(0, 0.05), y: p.plate.y + rng.gauss(0, 0.05) }, 'power');
    const o = evaluateSwing(slugger, p, s, rng);
    if (o.kind !== 'contact') continue;
    const path = predictPath(createBall(o.origin, o.velocity), 10);
    if (path.end === 'homerun') seen.add('homerun');
    else if (path.end === 'foul-stands' || (path.landing && !isFair(path.landing.pos) && Math.hypot(path.landing.pos.x, path.landing.pos.z) > 25)) seen.add('foul');
    else seen.add(battedBallType(o.launch));
  }
  for (const k of ['ground', 'liner', 'fly', 'foul', 'homerun']) assert.ok(seen.has(k), `${k} がない：${[...seen].join()}`);
});

test('かんたん打撃：カーソルがずれていてもタイミングが合えば当たり、幅も広い', () => {
  const p = pitch(0.15, 0.6);
  const far = { x: -0.4, y: 1.2 };
  const easy = (dt: number, lift = 0): SwingCommand => ({ ...swingAt(p, dt, far), easy: { lift } });
  assert.equal(evaluateSwing(slugger, p, swingAt(p, 0, far), new Rng(1)).kind, 'miss', '標準ではカーソルが外れると空振り');
  assert.equal(evaluateSwing(slugger, p, easy(0), new Rng(1)).kind, 'contact');
  const w = timingWindow(slugger, 'meet');
  assert.equal(evaluateSwing(slugger, p, easy(w * 1.2), new Rng(1)).kind, 'contact', '標準の幅を少し超えても当たる');
  assert.equal(evaluateSwing(slugger, p, easy(w * EASY_TIMING_SCALE + 0.01), new Rng(1)).kind, 'miss');
});

test('かんたん打撃：W でフライ、S でゴロ。大きく外れた球には届かない', () => {
  const p = pitch();
  const launch = (lift: number) => {
    let sum = 0;
    for (let i = 0; i < 20; i++) sum += contact(evaluateSwing(slugger, p, { ...swingAt(p), easy: { lift } }, new Rng(i + 1))).launch;
    return sum / 20;
  };
  assert.equal(battedBallType(launch(-1)), 'ground');
  assert.equal(battedBallType(launch(1)), 'fly');
  assert.ok(launch(-1) < launch(0) && launch(0) < launch(1));
  const wild = pitch(0.7, 0.8);
  assert.equal(evaluateSwing(slugger, wild, { ...swingAt(wild), easy: { lift: 0 } }, new Rng(1)).kind, 'miss');
});
