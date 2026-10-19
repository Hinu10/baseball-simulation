import assert from 'node:assert/strict';
import { test } from 'node:test';
import raw from '../data/teams.json' with { type: 'json' };
import { benchBatters, benchPitchers, createGameState, currentBatter, currentBatterPosition, score, type GameState } from './gameState.ts';
import { applyPlay, applySteal, pitchCall, substitute, substitutionError, type PlayResult } from './rules.ts';
import { parseTeams } from './teams.ts';

const [away, home] = parseTeams(raw);
const newGame = () => createGameState(away, home, 3);

const strikeout = (s: GameState) => {
  for (let i = 0; i < 3; i++) pitchCall(s, 'swinging-strike');
};
const walk = (s: GameState) => {
  for (let i = 0; i < 4; i++) pitchCall(s, 'ball');
};
const threeOuts = (s: GameState) => {
  for (let i = 0; i < 3; i++) strikeout(s);
};
/** 打者が n 塁打。塁上の走者はそれぞれ n 個進む（本塁を越えたら得点）。 */
const hit = (s: GameState, n: 1 | 2 | 3 | 4) => {
  const runs: PlayResult['runs'] = [];
  const bases: PlayResult['bases'] = [null, null, null, null];
  for (const b of [3, 2, 1] as const) {
    const id = s.bases[b];
    if (!id) continue;
    if (b + n >= 4) runs.push({ playerId: id, time: 1 });
    else bases[(b + n) as 1 | 2 | 3] = id;
  }
  if (n === 4) runs.push({ playerId: currentBatter(s).id, time: 1 });
  else bases[n] = currentBatter(s).id;
  applyPlay(s, { outs: [], runs, bases, hit: n, text: 'hit' });
};

test('3ストライクで三振になり、アウトが1つ増える', () => {
  const s = newGame();
  const first = currentBatter(s);
  pitchCall(s, 'called-strike');
  pitchCall(s, 'swinging-strike');
  assert.equal(s.strikes, 2);
  assert.equal(pitchCall(s, 'swinging-strike'), 'strikeout');
  assert.equal(s.outs, 1);
  assert.equal(s.strikes, 0);
  assert.notEqual(currentBatter(s).id, first.id);
});

test('2ストライク後のファウルではカウントが増えない', () => {
  const s = newGame();
  pitchCall(s, 'foul');
  pitchCall(s, 'foul');
  assert.equal(s.strikes, 2);
  for (let i = 0; i < 5; i++) assert.equal(pitchCall(s, 'foul'), null);
  assert.equal(s.strikes, 2);
  assert.equal(s.outs, 0);
});

test('2ストライク後のバントファウルは三振', () => {
  const s = newGame();
  pitchCall(s, 'foul');
  pitchCall(s, 'foul');
  assert.equal(pitchCall(s, 'foul-bunt'), 'strikeout');
  assert.equal(s.outs, 1);
});

test('4ボールで四球になり、打者が一塁へ', () => {
  const s = newGame();
  const batter = currentBatter(s).id;
  for (let i = 0; i < 3; i++) assert.equal(pitchCall(s, 'ball'), null);
  assert.equal(pitchCall(s, 'ball'), 'walk');
  assert.equal(s.bases[1], batter);
  assert.equal(s.balls, 0);
});

test('四球は詰まった走者だけ進め、満塁なら押し出しで1点', () => {
  const s = newGame();
  walk(s);
  walk(s);
  const r1 = s.bases[1];
  const r2 = s.bases[2];
  assert.ok(r1 && r2);
  // 一塁・二塁が空いていなければ三塁が空いていても二塁走者は三塁へ（押し出される）。
  walk(s);
  assert.equal(s.bases[3], r2);
  assert.equal(s.bases[2], r1);
  assert.equal(score(s, 0), 0);
  walk(s);
  assert.equal(score(s, 0), 1);
  assert.ok(s.bases[1] && s.bases[2] && s.bases[3]);
});

test('二塁走者だけのとき四球では二塁走者は進まない', () => {
  const s = newGame();
  hit(s, 2);
  const r2 = s.bases[2];
  walk(s);
  assert.equal(s.bases[2], r2);
  assert.equal(s.bases[3], null);
});

test('3アウトで攻守交代し、塁とカウントが空になる', () => {
  const s = newGame();
  walk(s);
  threeOuts(s);
  assert.equal(s.half, 'bottom');
  assert.equal(s.inning, 1);
  assert.equal(s.outs, 0);
  assert.deepEqual(s.bases, [null, null, null, null]);
  threeOuts(s);
  assert.equal(s.half, 'top');
  assert.equal(s.inning, 2);
  assert.deepEqual(s.teams[0].runsByInning, [0]);
  assert.deepEqual(s.teams[1].runsByInning, [0]);
});

test('安打で走者が進塁し、本塁に着いた走者が得点する', () => {
  const s = newGame();
  hit(s, 1);
  const r1 = s.bases[1];
  hit(s, 2);
  // 一塁走者は2つ進んで三塁、打者は二塁。
  assert.equal(s.bases[3], r1);
  assert.ok(s.bases[2]);
  assert.equal(score(s, 0), 0);
  hit(s, 1);
  assert.equal(score(s, 0), 1);
  assert.equal(s.teams[0].hits, 3);
});

test('本塁打で打者と走者全員が得点する', () => {
  const s = newGame();
  walk(s);
  hit(s, 1);
  hit(s, 4);
  assert.equal(score(s, 0), 3);
  assert.deepEqual(s.bases, [null, null, null, null]);
});

test('一塁のフォースアウト：打者がアウト、走者は進む', () => {
  const s = newGame();
  walk(s);
  const r1 = s.bases[1]!;
  const batter = currentBatter(s).id;
  applyPlay(s, {
    outs: [{ playerId: batter, kind: 'force', time: 3, batterBeforeFirst: true }],
    runs: [],
    bases: [null, null, r1, null],
    hit: 0,
    text: 'ゴロ'
  });
  assert.equal(s.outs, 1);
  assert.equal(s.bases[1], null);
  assert.equal(s.bases[2], r1);
});

test('第3アウトがフォースアウトならそのプレーの得点は入らない', () => {
  const s = newGame();
  strikeout(s);
  strikeout(s);
  walk(s);
  hit(s, 2); // 二・三塁
  const batter = currentBatter(s).id;
  applyPlay(s, {
    outs: [{ playerId: batter, kind: 'force', time: 3.5, batterBeforeFirst: true }],
    runs: [{ playerId: 'x', time: 2.0 }],
    bases: [null, null, null, null],
    hit: 0,
    text: 'ゴロ'
  });
  assert.equal(score(s, 0), 0);
  assert.equal(s.half, 'bottom');
});

test('第3アウトがタッチアウトなら、それより前の生還は得点になる', () => {
  const s = newGame();
  strikeout(s);
  strikeout(s);
  hit(s, 3);
  const runner = s.bases[3]!;
  const batter = currentBatter(s).id;
  applyPlay(s, {
    outs: [{ playerId: batter, kind: 'tag', time: 6 }],
    runs: [{ playerId: runner, time: 3 }],
    bases: [null, null, null, null],
    hit: 1,
    text: '二塁でタッチアウト'
  });
  assert.equal(score(s, 0), 1);
  assert.equal(s.half, 'bottom');
});

const playTo = (s: GameState, inning: number, half: 'top' | 'bottom') => {
  while (!s.over && (s.inning < inning || (s.inning === inning && s.half !== half))) threeOuts(s);
};

test('3回裏が終われば試合終了。同点なら引き分け', () => {
  const s = newGame();
  playTo(s, 3, 'bottom');
  assert.equal(s.over, false);
  threeOuts(s);
  assert.equal(s.over, true);
  assert.equal(s.endReason, 'regulation');
  assert.equal(s.winner, null);
});

test('同点なら延長に入り、延長の上限まで同点なら引き分け', () => {
  const s = createGameState(away, home, 3, 'manual', 1);
  playTo(s, 3, 'bottom');
  threeOuts(s);
  assert.equal(s.over, false);
  assert.equal(s.inning, 4);
  assert.equal(s.half, 'top');
  threeOuts(s);
  threeOuts(s);
  assert.equal(s.over, true);
  assert.equal(s.endReason, 'regulation');
  assert.equal(s.winner, null);
  assert.equal(s.teams[1].runsByInning.length, 4);
});

test('延長の表に勝ち越して裏を抑えれば先攻の勝ち、裏に勝ち越せばサヨナラ', () => {
  const a = createGameState(away, home, 7, 'manual', 2);
  playTo(a, 8, 'top');
  hit(a, 4);
  threeOuts(a);
  threeOuts(a);
  assert.equal(a.over, true);
  assert.equal(a.winner, 0);
  assert.equal(a.inning, 8);

  const b = createGameState(away, home, 9, 'manual', 3);
  playTo(b, 12, 'bottom');
  hit(b, 4);
  assert.equal(b.over, true);
  assert.equal(b.endReason, 'walkoff');
  assert.equal(b.winner, 1);
});

test('3回裏終了時に先攻がリードしていれば先攻の勝ち', () => {
  const s = newGame();
  hit(s, 4);
  playTo(s, 3, 'bottom');
  threeOuts(s);
  assert.equal(s.over, true);
  assert.equal(s.winner, 0);
});

test('3回表終了時に後攻がリードしていれば3回裏は行わない', () => {
  const s = newGame();
  threeOuts(s);
  hit(s, 4); // 1回裏に後攻が1点
  playTo(s, 3, 'top');
  assert.equal(s.over, false);
  threeOuts(s);
  assert.equal(s.over, true);
  assert.equal(s.endReason, 'skip-bottom');
  assert.equal(s.winner, 1);
  assert.equal(s.half, 'top');
});

test('3回裏に後攻が勝ち越した時点でサヨナラ終了', () => {
  const s = newGame();
  hit(s, 4); // 1回表に先攻が1点
  playTo(s, 3, 'bottom');
  hit(s, 1);
  hit(s, 4); // 2点で逆転
  assert.equal(s.over, true);
  assert.equal(s.endReason, 'walkoff');
  assert.equal(s.winner, 1);
  assert.equal(score(s, 1), 2);
  // 試合終了後の入力は無視される。
  pitchCall(s, 'ball');
  assert.equal(s.balls, 0);
});

test('3回裏の押し出し四球でもサヨナラ', () => {
  const s = newGame();
  playTo(s, 3, 'bottom');
  walk(s);
  walk(s);
  walk(s);
  walk(s);
  assert.equal(s.over, true);
  assert.equal(s.endReason, 'walkoff');
});

test('同点で迎えた2回裏の勝ち越しはサヨナラにならない', () => {
  const s = newGame();
  playTo(s, 2, 'bottom');
  hit(s, 4);
  assert.equal(s.over, false);
});

test('投球数は判定とインプレーの両方で数える', () => {
  const s = newGame();
  pitchCall(s, 'ball');
  pitchCall(s, 'foul');
  hit(s, 1);
  assert.equal(s.teams[1].pitchCount, 3);
});

test('打順は9人目の次に1番へ戻る', () => {
  const s = newGame();
  for (let i = 0; i < 9; i++) walk(s);
  assert.equal(currentBatter(s).id, s.teams[0].lineup[0].id);
});

test('代打：控えの野手が打順と守備位置を引き継ぎ、下がった選手は再出場できない', () => {
  const s = newGame();
  const out = currentBatter(s);
  const pos = currentBatterPosition(s);
  const pinch = benchBatters(s.teams[0])[0];
  substitute(s, 0, { kind: 'batter', slot: 0, playerId: pinch.id });
  assert.equal(currentBatter(s).id, pinch.id);
  assert.equal(currentBatterPosition(s), pos);
  assert.ok(!benchBatters(s.teams[0]).includes(out), '下がった選手は控えに戻らない');
  assert.ok(substitutionError(s, 0, { kind: 'batter', slot: 1, playerId: out.id }));
  assert.ok(substitutionError(s, 0, { kind: 'batter', slot: 1, playerId: pinch.id }), '出場中の選手は入れられない');
});

test('代走：塁上の選手を代えると、塁の走者も代わる', () => {
  const s = newGame();
  walk(s);
  const runner = s.bases[1]!;
  const slot = s.teams[0].lineup.findIndex((b) => b.id === runner);
  const sub = benchBatters(s.teams[0])[0];
  substitute(s, 0, { kind: 'batter', slot, playerId: sub.id });
  assert.equal(s.bases[1], sub.id);
});

test('投手交代：球数は 0 から、降板した投手は再登板できない', () => {
  const s = newGame();
  strikeout(s);
  const starter = s.teams[1].pitcher;
  assert.equal(s.teams[1].pitchCount, 3);
  const relief = benchPitchers(s.teams[1])[0];
  substitute(s, 1, { kind: 'pitcher', playerId: relief.id });
  assert.equal(s.teams[1].pitcher.id, relief.id);
  assert.equal(s.teams[1].pitchCount, 0);
  assert.ok(substitutionError(s, 1, { kind: 'pitcher', playerId: starter.id }));
  assert.throws(() => substitute(s, 1, { kind: 'pitcher', playerId: starter.id }));
});

test('打席ごとに打数・安打・本塁打・打点・四球・三振を記録する（四球・犠飛は打数に数えない）', () => {
  const s = newGame();
  const lineOf = (id: string) => s.batting[id];
  const first = currentBatter(s).id;
  strikeout(s);
  assert.deepEqual(lineOf(first), { pa: 1, ab: 1, h: 0, hr: 0, rbi: 0, bb: 0, so: 1, sb: 0, g: 0 });

  walk(s);
  const third = currentBatter(s).id;
  hit(s, 4); // 2点本塁打
  assert.deepEqual(lineOf(third), { pa: 1, ab: 1, h: 1, hr: 1, rbi: 2, bb: 0, so: 0, sb: 0, g: 0 });

  // 満塁で押し出し：打点1、打数0。
  walk(s);
  walk(s);
  walk(s);
  const loaded = currentBatter(s).id;
  walk(s);
  assert.deepEqual(lineOf(loaded), { pa: 1, ab: 0, h: 0, hr: 0, rbi: 1, bb: 1, so: 0, sb: 0, g: 0 });

  // 犠飛：三塁走者が生還、打者はフライでアウト。
  const fly = currentBatter(s).id;
  const runner = s.bases[3]!;
  applyPlay(s, { outs: [{ playerId: fly, kind: 'fly', time: 1 }], runs: [{ playerId: runner, time: 3 }], bases: [null, s.bases[1], s.bases[2], null], hit: 0, text: 'センターフライ' });
  assert.deepEqual(lineOf(fly), { pa: 1, ab: 0, h: 0, hr: 0, rbi: 1, bb: 0, so: 0, sb: 0, g: 0 });
});

test('投手成績：アウト・奪三振・与四球・被安打・失点を記録し、試合終了で勝敗をつける', () => {
  const s = newGame();
  const homeStarter = s.teams[1].pitcher.id;
  // 1回表：先攻が本塁打で先制。
  strikeout(s);
  walk(s);
  hit(s, 4);
  threeOuts(s);
  assert.deepEqual(s.pitching[homeStarter], { outs: 3, r: 2, h: 1, so: 3, bb: 1, w: 0, l: 0, g: 0 });
  // 1回裏：後攻が3点本塁打で逆転し、そのまま逃げ切る。
  const awayStarter = s.teams[0].pitcher.id;
  walk(s);
  walk(s);
  hit(s, 4);
  playTo(s, 3, 'bottom');
  assert.equal(s.over, true);
  assert.equal(s.winner, 1);
  assert.equal(s.pitching[homeStarter].w, 1);
  assert.equal(s.pitching[awayStarter].l, 1);
  assert.equal(s.pitching[awayStarter].r, 3);
});

test('盗塁：成功なら次の塁へ、失敗ならアウト。3つ目のアウトで攻守交代', () => {
  const s = newGame();
  walk(s);
  applySteal(s, [{ from: 1, safe: true }]);
  assert.deepEqual([s.bases[1], s.bases[2]], [null, away.lineup[0]]);
  walk(s);
  // ダブルスチールで先の走者だけアウト。
  applySteal(s, [{ from: 2, safe: false }, { from: 1, safe: true }]);
  assert.equal(s.outs, 1);
  assert.equal(s.bases[2], away.lineup[1]);
  strikeout(s);
  applySteal(s, [{ from: 2, safe: false }]);
  assert.equal(s.half, 'bottom');
  assert.deepEqual(s.bases, [null, null, null, null]);
});
