import assert from 'node:assert/strict';
import { test } from 'node:test';
import raw from '../data/teams.json' with { type: 'json' };
import { createPitch, DEFAULT_ZONE, previewPath, fatigue, isStrike, missChance, pitchPosition, PITCHES, staminaLeft } from './pitching.ts';
import { Rng } from './rng.ts';
import { parseTeams, type Pitcher } from './teams.ts';
import { PITCH_TYPES } from './types.ts';

const [maikai] = parseTeams(raw);
const ace = maikai.pitchers[0];
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

test('制球の乱れはたまに起こり、コントロールが低いほど・疲れているほど多い', () => {
  assert.ok(missChance(withControl(30), 0) > missChance(withControl(90), 0));
  assert.ok(missChance(ace, 1) > missChance(ace, 0));
  const rate = (control: number) => {
    const rng = new Rng(11);
    let missed = 0;
    for (let i = 0; i < 4000; i++) if (createPitch(withControl(control), { type: 'fastball', target: { x: 0, y: 0.8 } }, 0, rng).missed) missed++;
    return missed / 4000;
  };
  const good = rate(90);
  const poor = rate(30);
  assert.ok(good > 0.005 && good < 0.04, `コントロール90で ${good}`);
  assert.ok(poor > good && poor < 0.1, `コントロール30で ${poor}`);
});

test('軌道の予告は、プレートの位置からのリリースで始まり、狙ったコースに着く', () => {
  const target = { x: 0.15, y: 0.7 };
  const base = previewPath(ace, { type: 'slider', target });
  const shifted = previewPath(ace, { type: 'slider', target, shift: 0.2 });
  assert.ok(Math.abs(shifted[0].x - base[0].x - 0.2) < 1e-9);
  for (const path of [base, shifted]) {
    const end = path.at(-1)!;
    assert.ok(Math.abs(end.x - target.x) < 1e-9 && Math.abs(end.y - target.y) < 1e-9 && Math.abs(end.z) < 1e-9);
  }
  // 変化球は途中で曲がるので、まっすぐの線からずれる。
  const mid = base[16];
  const straightX = base[0].x + (target.x - base[0].x) * 0.5;
  assert.ok(Math.abs(mid.x - straightX) > 0.05);
});

test('増やした球種：スローボールは一番遅く、シュート・ツーシームはスライダーと逆に曲がる', () => {
  for (const t of PITCH_TYPES) assert.ok(PITCHES[t].label, t);
  assert.equal(Math.min(...PITCH_TYPES.map((t) => PITCHES[t].speed)), PITCHES.slowball.speed);
  for (const t of ['shoot', 'twoseam'] as const) assert.ok(Math.sign(PITCHES[t].breakX) === -Math.sign(PITCHES.slider.breakX), t);
  assert.ok(PITCHES.knucklecurve.breakY < PITCHES.curve.breakY, 'ナックルカーブはカーブより落ちる');
  // 182km/h のストレートも投げられる。
  const fast = { ...ace, velocity: 182 };
  const p = createPitch(fast, { type: 'fastball', target: { x: 0, y: 0.8 } }, 0, new Rng(1));
  assert.ok(p.speedKmh > 175);
});

test('スタミナ：1球目から減り、先発（スタミナ80）は100球前後で疲れきる', () => {
  const sp = { ...ace, stamina: 80 };
  assert.ok(staminaLeft(sp, 1) < 1);
  assert.equal(fatigue(sp, 40), 0, '前半は球に出ない');
  assert.ok(fatigue(sp, 75) > 0.3);
  assert.equal(fatigue(sp, 100), 1);
  assert.equal(staminaLeft(sp, 100), 0);
});
