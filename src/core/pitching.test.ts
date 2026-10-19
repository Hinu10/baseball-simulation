import assert from 'node:assert/strict';
import { test } from 'node:test';
import raw from '../data/teams.json' with { type: 'json' };
import { createPitch, DEFAULT_ZONE, fatigue, isStrike, pitchPosition, PITCHES } from './pitching.ts';
import { Rng } from './rng.ts';
import { parseTeams, type Pitcher } from './teams.ts';
import { PITCH_TYPES } from './types.ts';

const [comets] = parseTeams(raw);
const ace = comets.pitchers[0];
const withControl = (control: number): Pitcher => ({ ...ace, control });

test('ゾーンにかかればストライク、外れればボール', () => {
  assert.ok(isStrike(DEFAULT_ZONE, { x: 0, y: 0.8 }));
  assert.ok(isStrike(DEFAULT_ZONE, { x: 0.25, y: 0.8 })); // ボールの端がかかる
  assert.ok(!isStrike(DEFAULT_ZONE, { x: 0.27, y: 0.8 }));
  assert.ok(!isStrike(DEFAULT_ZONE, { x: 0, y: 0.4 }));
  assert.ok(!isStrike(DEFAULT_ZONE, { x: 0, y: 1.12 }));
});

test('軌道はリリース点から始まり、本塁上でちょうど通過点に着く', () => {
  const rng = new Rng(3);
  for (const type of PITCH_TYPES) {
    const p = createPitch(ace, { type, target: { x: 0.1, y: 0.7 } }, 0, rng);
    const start = pitchPosition(p, 0);
    const end = pitchPosition(p, p.flightTime);
    assert.ok(Math.abs(start.z - p.release.z) < 1e-9);
    assert.ok(Math.abs(end.z) < 1e-9);
    assert.ok(Math.abs(end.x - p.plate.x) < 1e-9 && Math.abs(end.y - p.plate.y) < 1e-9);
  }
});

test('変化球は途中の軌道が直線から外れ、ストレートより遅い', () => {
  const rng = new Rng(4);
  const fast = createPitch(ace, { type: 'fastball', target: { x: 0, y: 0.8 } }, 0, rng);
  const fork = createPitch(ace, { type: 'fork', target: { x: 0, y: 0.8 } }, 0, rng);
  assert.ok(fork.speedKmh < fast.speedKmh);
  assert.ok(fork.flightTime > fast.flightTime);
  // フォークは途中では高く見え、最後に落ちる：中間点が「リリースと到達点を結ぶ直線」より上にある。
  const mid = pitchPosition(fork, fork.flightTime / 2);
  const straightMid = (fork.release.y + fork.plate.y) / 2;
  assert.ok(mid.y - straightMid > 0.1, `${mid.y} vs ${straightMid}`);
  assert.ok(PITCHES.curve.speed < PITCHES.slider.speed);
});

test('コントロールが高い投手ほど狙ったコースに近い', () => {
  const spread = (control: number) => {
    const rng = new Rng(11);
    let sum = 0;
    for (let i = 0; i < 2000; i++) {
      const p = createPitch(withControl(control), { type: 'fastball', target: { x: 0, y: 0.8 } }, 0, rng);
      sum += Math.hypot(p.plate.x - p.target.x, p.plate.y - p.target.y);
    }
    return sum / 2000;
  };
  const good = spread(95);
  const bad = spread(30);
  assert.ok(good < 0.07, `good=${good}`);
  assert.ok(bad > good * 2, `bad=${bad} good=${good}`);
});

test('投球数が増えると疲れ、球速が落ちる', () => {
  assert.equal(fatigue(ace, 10), 0);
  assert.ok(fatigue(ace, 120) > 0.5);
  const rng = new Rng(5);
  const fresh = createPitch(ace, { type: 'fastball', target: { x: 0, y: 0.8 } }, 0, rng);
  const tired = createPitch(ace, { type: 'fastball', target: { x: 0, y: 0.8 } }, 1, new Rng(5));
  assert.ok(tired.speedKmh < fresh.speedKmh);
});
