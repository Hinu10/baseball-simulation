import assert from 'node:assert/strict';
import { test } from 'node:test';
import raw from '../data/teams.json' with { type: 'json' };
import { createGameState, currentBatter, score, type GameState } from './gameState.ts';
import { applyPlay, pitchCall, type PlayResult } from './rules.ts';
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
