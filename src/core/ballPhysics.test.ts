import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBall, predictPath, stepBall, type BallEvent } from './ballPhysics.ts';
import { fenceDistance, HOME_PARKS, isFair, parkOf, sprayAngle } from './field.ts';
import { lenXZ, rad, v3 } from './math.ts';

/** 速さ speed（m/s）、角度 launch（度）、方向 spray（度、一塁側が +）の打球。 */
const hit = (speed: number, launch: number, spray = 0) =>
  createBall(
    v3(0, 1.0, 0.5),
    v3(speed * Math.cos(rad(launch)) * Math.sin(rad(spray)), speed * Math.sin(rad(launch)), speed * Math.cos(rad(launch)) * Math.cos(rad(spray)))
  );

const run = (b: ReturnType<typeof hit>, maxT = 15) => {
  const events: BallEvent[] = [];
  for (let t = 0; t < maxT && !b.stopped; t += 1 / 120) {
    const e = stepBall(b);
    if (e) events.push(e);
  }
  return events;
};

test('打球の飛距離が現実的な範囲になる', () => {
  const carry = (speed: number, launch: number) => predictPath(hit(speed, launch), 10).landing?.pos.z ?? Infinity;
  // 時速 160km（44m/s）・28度で 105〜130m、時速 115km（32m/s）・28度で 60〜85m。
  const strong = carry(44, 28);
  const medium = carry(32, 28);
  assert.ok(strong > 105 && strong < 130, `strong=${strong}`);
  assert.ok(medium > 60 && medium < 85, `medium=${medium}`);
});

test('強い打球がフェンスを越えると本塁打', () => {
  const events = run(hit(46, 27, 10));
  assert.equal(events.at(-1), 'homerun');
});

test('低いライナーはフェンスに当たって跳ね返る', () => {
  const b = hit(44, 11, -30);
  const events = run(b);
  assert.ok(events.includes('fence'), events.join());
  assert.ok(!events.includes('homerun'));
  assert.ok(lenXZ(b.pos) < fenceDistance(sprayAngle(b.pos)));
});

test('ゴロはバウンドして転がり、止まる', () => {
  const b = hit(30, -8, 20);
  const events = run(b);
  assert.ok(events.filter((e) => e === 'bounce').length >= 1);
  assert.ok(b.rolling && b.stopped);
  assert.ok(isFair(b.pos));
});

test('ライン外に落ちる打球はファウル地域に着地する', () => {
  const p = predictPath(hit(35, 30, 55));
  assert.ok(p.landing);
  assert.ok(!isFair(p.landing!.pos));
});

test('予測した着地点と実際の着地点が一致する', () => {
  const b = hit(38, 22, -15);
  const predicted = predictPath(b).landing!;
  let t = 0;
  while (b.bounces === 0) {
    stepBall(b);
    t += 1 / 120;
  }
  assert.ok(Math.abs(t - predicted.t) < 1e-6);
  assert.ok(Math.hypot(b.pos.x - predicted.pos.x, b.pos.z - predicted.pos.z) < 1e-6);
});

test('球場ごとにフェンスの距離が違い、狭い球場ほど本塁打が出やすい', () => {
  const smarlins = HOME_PARKS.smarlins;
  // 左右非対称：左翼（三塁側）が浅く、右翼が深い。
  assert.ok(fenceDistance(rad(-45), smarlins) < fenceDistance(rad(45), smarlins));
  assert.equal(fenceDistance(0, smarlins), smarlins.fence.center);
  assert.equal(parkOf('no-such-team').id, 'skypark');
  // 同じ打球が、狭い球場では本塁打、広い球場ではフェンス手前。
  const fly = (park: string) => {
    for (let speed = 30; speed < 60; speed += 0.25) {
      const b = createBall(v3(0, 1.0, 0.5), v3(0, speed * Math.sin(rad(30)), speed * Math.cos(rad(30))), HOME_PARKS[park]);
      if (run(b).includes('homerun')) return speed;
    }
    return Infinity;
  };
  assert.ok(fly('facrom') < fly('jogawa'));
});
