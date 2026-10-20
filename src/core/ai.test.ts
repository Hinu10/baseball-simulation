import assert from 'node:assert/strict';
import { test } from 'node:test';
import raw from '../data/teams.json' with { type: 'json' };
import { choosePitch, DIFFICULTY_ERROR, pitchStuff, planSwing } from './ai.ts';
import { evaluateSwing } from './batting.ts';
import { score } from './gameState.ts';
import { Match } from './match.ts';
import { createPitch, DEFAULT_ZONE, isStrike } from './pitching.ts';
import { Rng } from './rng.ts';
import { parseTeams } from './teams.ts';

const [away, home] = parseTeams(raw);

const runToEnd = (m: Match) => {
  for (let i = 0; i < 300000 && m.phase !== 'over'; i++) m.tick(1 / 60);
  return m;
};

test('CPU 同士の試合は3イニング（延長1回まで）を最後まで進み、正しい形で終わる', () => {
  for (let seed = 1; seed <= 25; seed++) {
    const m = runToEnd(new Match({ away, home, mode: 'auto', seed }));
    const s = m.state;
    assert.equal(m.phase, 'over', `seed ${seed} が終わらない`);
    assert.ok(s.over);
    const a = score(s, 0);
    const h = score(s, 1);
    if (s.endReason === 'skip-bottom') {
      assert.ok(h > a);
      assert.equal(s.teams[1].runsByInning.length, s.inning - 1);
    } else if (s.endReason === 'walkoff') {
      assert.ok(h > a && s.half === 'bottom' && s.inning >= 3);
    } else {
      assert.equal(s.endReason, 'regulation');
      assert.equal(s.teams[1].runsByInning.length, s.inning);
      // 3回で同点なら延長に入り、延長は1回まで。
      assert.ok(s.inning === 3 ? a !== h : s.inning === 4);
    }
    assert.ok(s.inning <= 4);
    assert.equal(s.winner, a === h ? null : a > h ? 0 : 1);
    assert.equal(s.teams[0].runsByInning.length, s.inning);
    assert.ok(s.teams[0].pitchCount > 0 && s.teams[1].pitchCount > 0);
  }
});

test('同じ seed なら同じ試合になる', () => {
  const a = runToEnd(new Match({ away, home, mode: 'auto', seed: 99 }));
  const b = runToEnd(new Match({ away, home, mode: 'auto', seed: 99 }));
  assert.deepEqual(
    a.state.log.map((e) => e.text),
    b.state.log.map((e) => e.text)
  );
});

test('CPU 投手は持ち球だけを投げ、3ボールではストライクを多く狙う', () => {
  const rng = new Rng(3);
  const p = home.pitchers[1];
  let strikes3 = 0;
  let strikes0 = 0;
  for (let i = 0; i < 2000; i++) {
    const c0 = choosePitch(p, { balls: 0, strikes: 1 }, 'normal', rng);
    const c3 = choosePitch(p, { balls: 3, strikes: 1 }, 'normal', rng);
    assert.ok(p.pitches.includes(c0.type) && p.pitches.includes(c3.type));
    if (isStrike(DEFAULT_ZONE, c0.target)) strikes0++;
    if (isStrike(DEFAULT_ZONE, c3.target)) strikes3++;
  }
  assert.ok(strikes3 > strikes0 * 1.2, `${strikes3} vs ${strikes0}`);
});

test('難易度が上がるほど CPU 打者がよく当てる', () => {
  const contact = (scale: number) => {
    const rng = new Rng(8);
    let hits = 0;
    for (let i = 0; i < 3000; i++) {
      const b = away.batters[i % 9];
      const pitch = createPitch(home.pitchers[0], { type: 'fastball', target: { x: 0, y: 0.75 } }, 0, rng);
      const sw = planSwing(b, pitch, { balls: 0, strikes: 2, outs: 0, runnerOnFirst: false, runnerOnSecond: false, pitcherVelocity: 152 }, 'normal', scale, rng);
      if (sw && evaluateSwing(b, pitch, sw, rng).kind === 'contact') hits++;
    }
    return hits;
  };
  const easy = contact(DIFFICULTY_ERROR.easy);
  const hard = contact(DIFFICULTY_ERROR.hard);
  assert.ok(hard > easy * 1.15, `hard=${hard} easy=${easy}`);
});

test('たくさんの試合で、得点・安打・三振・四球が野球らしい範囲に収まる', () => {
  let runs = 0;
  let pa = 0;
  let k = 0;
  let bb = 0;
  let hits = 0;
  const games = 40;
  for (let seed = 100; seed < 100 + games; seed++) {
    const m = runToEnd(new Match({ away, home, mode: 'auto', seed }));
    runs += score(m.state, 0) + score(m.state, 1);
    hits += m.state.teams[0].hits + m.state.teams[1].hits;
    for (const e of m.state.log) {
      pa++;
      if (e.text.includes('三振')) k++;
      if (e.text.startsWith('四球')) bb++;
    }
  }
  const perGame = runs / games;
  assert.ok(perGame > 1 && perGame < 6, `1試合（3イニング）の両軍の得点 ${perGame}`);
  assert.ok(hits / pa > 0.15 && hits / pa < 0.4, `安打率 ${hits / pa}`);
  assert.ok(k / pa > 0.05 && k / pa < 0.3, `三振率 ${k / pa}`);
  assert.ok(bb / pa > 0.01 && bb / pa < 0.15, `四球率 ${bb / pa}`);
});

test('球の力：速球派で変化球の能力が高い投手ほど、打者のタイミング・狙いがずれる', () => {
  const avg = pitchStuff({ breakX: 0.15, breakY: 0.16 });
  assert.ok(Math.abs(avg.timing - 1) < 0.05 && Math.abs(avg.aim - 1) < 0.05, '平均的な投手は 1 前後');
  const ace = pitchStuff({ breakX: 0.3, breakY: 0.4 }, 182, 95);
  assert.ok(ace.timing > 1.5 && ace.aim > 1.5);
  const soft = pitchStuff({ breakX: 0.05, breakY: 0.05 }, 132, 40);
  assert.ok(soft.timing < 1 && soft.aim < 1);
});
