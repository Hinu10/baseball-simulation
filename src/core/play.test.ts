import assert from 'node:assert/strict';
import { test } from 'node:test';
import raw from '../data/teams.json' with { type: 'json' };
import { createGameState, currentBatter, type GameState } from './gameState.ts';
import { rad, v3 } from './math.ts';
import { NO_INPUT, PlaySim, type RunningStrategy } from './play.ts';
import { Rng } from './rng.ts';
import { applyPlay } from './rules.ts';
import { parseTeams } from './teams.ts';

const [away, home] = parseTeams(raw);

interface Setup {
  speed: number;
  launch: number;
  spray: number;
  bases?: (1 | 2 | 3)[];
  outs?: number;
  running?: RunningStrategy;
  humanDefense?: boolean;
  seed?: number;
}

function play(o: Setup) {
  const s = createGameState(away, home, 3);
  s.outs = o.outs ?? 0;
  // 塁には先攻の下位打線を置く。
  for (const b of o.bases ?? []) s.bases[b] = s.teams[0].lineup[9 - b].id;
  const v = v3(
    o.speed * Math.cos(rad(o.launch)) * Math.sin(rad(o.spray)),
    o.speed * Math.sin(rad(o.launch)),
    o.speed * Math.cos(rad(o.launch)) * Math.cos(rad(o.spray))
  );
  const sim = new PlaySim({
    state: s,
    batter: currentBatter(s),
    fielding: s.teams[1],
    origin: v3(0, 0.8, 0.45),
    velocity: v,
    launch: o.launch,
    bunt: false,
    running: o.running ?? 'normal',
    humanDefense: o.humanDefense ?? false,
    humanOffense: false,
    rng: new Rng(o.seed ?? 1)
  });
  const events: string[] = [];
  while (!sim.done) {
    sim.tick(1 / 60, NO_INPUT);
    for (const e of sim.events) events.push(e.type);
    sim.events.length = 0;
  }
  return { sim, state: s, result: sim.result(), events };
}

const applied = (s: GameState, r: ReturnType<typeof play>['result']) => {
  applyPlay(s, r);
  return s;
};

test('ショートへのゴロを捕って一塁へ送球し、打者走者がアウトになる', () => {
  const { result, events } = play({ speed: 30, launch: -6, spray: -18 });
  assert.equal(result.outs.length, 1, result.text);
  assert.equal(result.outs[0].kind, 'force');
  assert.ok(result.outs[0].batterBeforeFirst);
  assert.ok(events.includes('catch') && events.includes('throw'), events.join());
  assert.match(result.text, /ゴロ/);
  assert.equal(result.hit, 0);
});

test('一塁走者がいるゴロは二塁でフォースアウトを取る（併殺もありうる）', () => {
  const { result, state } = play({ speed: 32, launch: -5, spray: -14, bases: [1] });
  assert.ok(result.outs.length >= 1, result.text);
  const runnerOut = result.outs.find((o) => o.playerId === state.bases[1]);
  assert.ok(runnerOut, `一塁走者がアウトになっていない：${result.text}`);
  assert.equal(runnerOut!.kind, 'force');
});

test('外野へのフライを捕るとアウト（飛球）', () => {
  const { result } = play({ speed: 36, launch: 38, spray: 0 });
  assert.equal(result.outs.length, 1, result.text);
  assert.equal(result.outs[0].kind, 'fly');
  assert.match(result.text, /センターフライ/);
});

test('外野の間を抜ける打球で走者が進塁し、二塁走者は生還する', () => {
  const { result, state } = play({ speed: 44, launch: 20, spray: 14, bases: [2] });
  const runner = state.bases[2]!;
  assert.equal(result.outs.length, 0, result.text);
  assert.ok(result.runs.some((r) => r.playerId === runner), `二塁走者が生還していない：${result.text}`);
  assert.ok(result.hit >= 1);
  const s = applied(state, result);
  assert.equal(s.teams[0].runsByInning[0], 1);
});

test('外野前ヒットで一塁走者は少なくとも二塁へ、打者は一塁へ', () => {
  const { result, state } = play({ speed: 38, launch: 12, spray: 14, bases: [1] });
  const runner = state.bases[1]!;
  assert.equal(result.outs.length, 0, result.text);
  assert.ok(result.bases[1] === currentBatter(state).id || result.bases[2] === currentBatter(state).id);
  assert.ok(result.bases[2] === runner || result.bases[3] === runner || result.runs.some((r) => r.playerId === runner));
});

test('フェンス越えは本塁打で、走者と打者が全員生還', () => {
  const { result } = play({ speed: 48, launch: 28, spray: 5, bases: [1, 3] });
  assert.equal(result.hit, 4);
  assert.equal(result.runs.length, 3);
});

test('ファウル地域に落ちた打球はファウル', () => {
  const { result, sim } = play({ speed: 30, launch: 25, spray: 60 });
  assert.ok(sim.foul, result.text);
  assert.equal(result.foul, true);
});

test('三塁走者がいて2アウトなら、打った瞬間にスタートする', () => {
  const { result, state } = play({ speed: 38, launch: 16, spray: 25, bases: [3], outs: 2 });
  const runner = state.bases[3]!;
  if (result.outs.length === 0) assert.ok(result.runs.some((r) => r.playerId === runner));
});

test('外野フライで三塁走者がタッチアップして生還できる（犠牲フライ）', () => {
  const { result, state } = play({ speed: 40, launch: 34, spray: 0, bases: [3], running: 'aggressive' });
  const runner = state.bases[3]!;
  assert.equal(result.outs[0]?.kind, 'fly', result.text);
  assert.ok(result.runs.some((r) => r.playerId === runner), `タッチアップしていない：${result.text}`);
  // 捕球の後に生還したので得点が入る。
  assert.ok(result.runs[0].time > result.outs[0].time);
});

test('人が守備を操作して何もしなくても、プレーは止まらずに終わる', () => {
  const { sim, result } = play({ speed: 28, launch: -4, spray: 10, humanDefense: true });
  assert.ok(sim.done);
  assert.ok(sim.time < 45, `time=${sim.time} ${result.text}`);
});

test('さまざまな打球でプレーが必ず終わり、塁が重ならない', () => {
  const rng = new Rng(2024);
  for (let i = 0; i < 300; i++) {
    const bases = ([1, 2, 3] as const).filter(() => rng.chance(0.4));
    const { sim, result } = play({
      speed: rng.range(8, 50),
      launch: rng.range(-25, 70),
      spray: rng.range(-60, 60),
      bases,
      outs: Math.floor(rng.range(0, 3)),
      seed: i
    });
    assert.ok(sim.time < 45, `時間切れ：${result.text}`);
    const ids = result.bases.filter(Boolean);
    assert.equal(new Set(ids).size, ids.length, `同じ走者が2つの塁に：${result.text}`);
    // 生還・アウト・塁上の合計は、打者＋プレー前の走者の人数と一致する。
    if (!result.foul) {
      const accounted = ids.length + result.runs.length + result.outs.length;
      const total = 1 + bases.length;
      assert.equal(accounted, total, result.text);
    }
  }
});
