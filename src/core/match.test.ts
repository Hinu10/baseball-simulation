import assert from 'node:assert/strict';
import { test } from 'node:test';
import raw from '../data/teams.json' with { type: 'json' };
import { battingTeam, fieldingTeam, score } from './gameState.ts';
import { Match } from './match.ts';
import { NO_INPUT, type PlayInput } from './play.ts';
import { parseTeams } from './teams.ts';

const [away, home] = parseTeams(raw);
const press = (k: Partial<PlayInput>): PlayInput => ({ ...NO_INPUT, ...k });

const snapshot = (m: Match) => {
  const s = m.state;
  return JSON.stringify({
    inning: s.inning,
    half: s.half,
    outs: s.outs,
    balls: s.balls,
    strikes: s.strikes,
    bases: s.bases,
    runs: s.teams.map((t) => t.runsByInning),
    order: s.teams.map((t) => t.battingIndex),
    pitches: s.teams.map((t) => t.pitchCount),
    log: s.log.length
  });
};

const until = (m: Match, cond: () => boolean, input: PlayInput = NO_INPUT, max = 200000) => {
  for (let i = 0; i < max && !cond(); i++) m.tick(1 / 60, input);
};

test('モード切替後も試合状態は変わらず、切替は次の投球前に反映される', () => {
  const m = new Match({ away, home, mode: 'auto', seed: 5 });
  // 2回まで自動で進める。
  until(m, () => m.state.inning >= 2 && m.phase === 'pitch');
  assert.equal(m.phase, 'pitch');
  m.requestMode('manager');
  assert.equal(m.mode, 'auto', '投球中はまだ切り替わらない');
  assert.equal(m.nextMode, 'manager');
  until(m, () => m.phase === 'pre-pitch');
  assert.equal(m.mode, 'manager');
  const before = snapshot(m);
  // 投球前の切替はすぐ反映され、状態は変わらない。
  m.requestMode('manual');
  assert.equal(m.mode, 'manual');
  assert.equal(snapshot(m), before);
  m.requestMode('auto');
  assert.equal(snapshot(m), before);
  m.skipToEnd();
  assert.equal(m.phase, 'over');
  assert.ok(m.state.over);
});

test('手動モード：人の投手が J で投げるまで投球は始まらず、L で球種が変わる', () => {
  const m = new Match({ away, home, mode: 'manual', humanTeam: 1, seed: 2 });
  // 1回表は後攻（人）が守備。
  assert.equal(fieldingTeam(m.state), 1);
  assert.ok(m.humanPitching);
  until(m, () => m.phase !== 'pre-pitch', NO_INPUT, 600);
  assert.equal(m.phase, 'pre-pitch', '入力がなければ投げない');
  m.tick(1 / 60, press({ switch: true }));
  assert.equal(m.pitchType, home.pitchers[0].pitches[1]);
  // 右下へコースを動かす。
  for (let i = 0; i < 30; i++) m.tick(1 / 60, press({ move: { x: 1, y: -1 } }));
  assert.ok(m.aim.x > 0.2 && m.aim.y < 0.6);
  m.tick(1 / 60, press({ primary: true }));
  assert.equal(m.phase, 'windup');
  until(m, () => m.phase === 'pitch');
  assert.equal(m.pitch!.type, home.pitchers[0].pitches[1]);
  assert.ok(m.pitch!.target.x > 0.2);
});

test('手動モード：人の打者がタイミングよく J を押すとスイングし、押さなければ見送る', () => {
  const m = new Match({ away, home, mode: 'manual', humanTeam: 0, seed: 4 });
  assert.ok(m.humanBatting);
  let swings = 0;
  let contacts = 0;
  let pitches = 0;
  while (pitches < 40 && m.phase !== 'over') {
    until(m, () => m.phase === 'pitch' || m.phase === 'over' || !m.humanBatting);
    if (!m.humanBatting) {
      // 攻守交代したら自動で守備を進める。
      m.requestMode('auto');
      until(m, () => m.phase === 'pre-pitch' && battingTeam(m.state) === 0);
      m.requestMode('manual');
      continue;
    }
    if (m.phase !== 'pitch') break;
    pitches++;
    const p = m.pitch!;
    // 球の通過点にカーソルを合わせ、ちょうどよい時刻に振る。
    m.batCursor = { ...p.plate };
    const swing = pitches % 2 === 0;
    until(m, () => m.phase !== 'pitch' || (swing && m.pitchTime >= p.flightTime - 0.16));
    if (m.phase === 'pitch' && swing) {
      m.tick(1 / 60, press({ primary: true }));
      swings++;
    }
    until(m, () => m.phase !== 'pitch');
    if ((m.phase as string) === 'play' || (swing && !m.lastSwingMissed)) contacts++;
    until(m, () => m.phase === 'pre-pitch' || m.phase === 'over', NO_INPUT);
  }
  assert.ok(swings >= 10);
  assert.ok(contacts >= swings * 0.6, `contacts=${contacts} swings=${swings}`);
});

test('監督モードの方針：積極的な攻撃は慎重な攻撃より多く振る', () => {
  const swingRate = (offense: 'aggressive' | 'careful') => {
    let swings = 0;
    let pitches = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const m = new Match({ away, home, mode: 'manager', humanTeam: 0, seed });
      m.setStrategy({ offense });
      while (m.phase !== 'over' && m.state.inning <= 3) {
        until(m, () => m.phase === 'pitch' || m.phase === 'over');
        if ((m.phase as string) === 'over') break;
        if (battingTeam(m.state) === 0) {
          pitches++;
          if (m.swing) swings++;
        }
        until(m, () => m.phase !== 'pitch');
      }
    }
    return swings / pitches;
  };
  const aggressive = swingRate('aggressive');
  const careful = swingRate('careful');
  assert.ok(aggressive > careful + 0.1, `aggressive=${aggressive} careful=${careful}`);
});

test('自動モードは試合終了まで一気に進められ、結果が残る', () => {
  const m = new Match({ away, home, mode: 'auto', seed: 77 });
  m.skipToEnd();
  assert.equal(m.phase, 'over');
  const total = score(m.state, 0) + score(m.state, 1);
  assert.equal(
    total,
    m.state.log.reduce((s, e) => s + e.runs, 0)
  );
});

test('手動モードで操作しないまま守備になっても、プレーは止まらない', () => {
  const m = new Match({ away, home, mode: 'manual', humanTeam: 1, seed: 11 });
  // 人の投手が投げ続け、打球が飛んだら何も操作しない（3秒で AI が代わる）。攻撃中は見送り続ける。
  let plays = 0;
  for (let i = 0; i < 200000 && plays < 5 && m.phase !== 'over'; i++) {
    const input = m.phase === 'pre-pitch' && m.humanPitching ? press({ primary: true }) : NO_INPUT;
    const before = m.phase;
    m.tick(1 / 60, input);
    if (before === 'play' && m.phase === 'result') plays++;
  }
  assert.ok(plays >= 5, `plays=${plays}`);
});

test('守備オート：投球は人が操作し、打球が飛んだら野手は CPU が動かす', () => {
  const run = (fielding: 'manual' | 'auto') => {
    const m = new Match({ away, home, mode: 'manual', humanTeam: 1, fielding, seed: 11 });
    let controlled = -1;
    for (let i = 0; i < 200000 && m.phase !== 'play'; i++) {
      // 投球は人が J を押すまで始まらない（守備オートでも同じ）。
      m.tick(1 / 60, m.phase === 'pre-pitch' && m.humanPitching ? press({ primary: true }) : NO_INPUT);
    }
    assert.equal(m.phase, 'play');
    assert.equal(fieldingTeam(m.state), 1);
    controlled = m.play!.controlled;
    until(m, () => m.phase !== 'play', press({ move: { x: 1, y: 0 } }));
    return { controlled, phase: m.phase };
  };
  assert.ok(run('manual').controlled >= 0, '守備手動では操作する選手が決まる');
  const auto = run('auto');
  assert.equal(auto.controlled, -1, '守備オートでは操作する選手がいない');
  assert.equal(auto.phase, 'result', '入力を送り続けてもプレーは CPU で終わる');
});

test('守備の切り替えは次の打球から反映される', () => {
  const m = new Match({ away, home, mode: 'manual', humanTeam: 1, seed: 11 });
  until(m, () => m.phase === 'play', press({ primary: true }));
  assert.ok(m.play!.controlled >= 0);
  m.fielding = 'auto';
  assert.ok(m.play!.controlled >= 0, 'プレー中は変わらない');
  until(m, () => m.phase === 'pre-pitch');
  assert.ok(m.humanPitching, '投球はそのまま人が操作する');
  until(m, () => m.phase === 'play' || (m.phase === 'pre-pitch' && fieldingTeam(m.state) !== 1), press({ primary: true }));
  assert.equal(m.phase, 'play');
  assert.equal(m.play!.controlled, -1);
});

test('選手交代は投球前だけ。タイムをかけると次の投球前に止まれる', () => {
  const m = new Match({ away, home, mode: 'auto', humanTeam: 1, seed: 8 });
  until(m, () => m.phase === 'pitch');
  const relief = home.pitchers[1];
  assert.ok(!m.canSubstitute);
  assert.ok(m.substitute({ kind: 'pitcher', playerId: relief.id }), '投球中は交代できない');
  m.requestTimeout();
  until(m, () => m.canSubstitute);
  assert.ok(m.timeoutRequested);
  assert.equal(m.substitute({ kind: 'pitcher', playerId: relief.id }), null);
  assert.equal(m.state.teams[1].pitcher.id, relief.id);
  assert.match(m.notice!.text, /投手交代/);
});

test('CPU チームは疲れた投手を打席の合間に代える', () => {
  const m = new Match({ away, home, mode: 'auto', humanTeam: 1, seed: 2 });
  const starter = away.pitchers.find((p) => p.id === away.startingPitcher)!;
  // 先攻（CPU）の先発に、たくさん投げさせたことにする。
  until(m, () => m.state.half === 'bottom' && m.phase === 'pitch');
  m.state.teams[0].pitchCount = 500;
  until(m, () => m.state.teams[0].pitcher !== starter || m.phase === 'over');
  assert.notEqual(m.state.teams[0].pitcher, starter);
  assert.equal(m.state.teams[0].removed.includes(starter.id), true);
});

test('かんたん打撃：人が打つとき、カーソルを動かさずタイミングよく J を押すだけで当たる', () => {
  let hits = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const m = new Match({ away, home, mode: 'manual', humanTeam: 0, batting: 'easy', difficulty: 'easy', seed });
    for (let pa = 0; pa < 3 && !m.state.over; pa++) {
      until(m, () => m.phase === 'pitch' && m.humanBatting);
      if (!m.easyBatting) break;
      const p = m.pitch!;
      // ゾーンの近くに来る球だけ振る。
      if (Math.abs(p.plate.x) > 0.3 || p.plate.y < 0.35 || p.plate.y > 1.2) {
        until(m, () => m.phase === 'pre-pitch');
        continue;
      }
      until(m, () => m.pitchTime >= p.flightTime - 0.16);
      m.tick(1 / 60, press({ primary: true }));
      until(m, () => m.phase !== 'pitch');
      if (m.phase === 'play') hits++;
      until(m, () => m.phase === 'pre-pitch');
    }
  }
  assert.ok(hits >= 4, `当たり ${hits} 回`);
});
