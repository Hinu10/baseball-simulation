// 打球・送球後のボールの物理。重力・簡易な空気抵抗・地面のバウンドと転がり・フェンスを扱う。
// 固定時間刻みで積分し、守備AIの予測（predictPath）も同じ関数で先読みするので、予測と実際が一致する。

import { FENCE, fenceDistance, inFoulStands, isFair, onDirt, sprayAngle } from './field.ts';
import { copy, lenXZ, type Vec3 } from './math.ts';

export const GRAVITY = 9.81;
/** 空気抵抗 a = -k|v|v の k（1/m）。省くと飛距離が現実の倍以上になるので入れている。 */
export const DRAG = 0.0042;
export const BALL_RADIUS = 0.037;
export const PHYSICS_DT = 1 / 120;

const GROUND = {
  grass: { restitution: 0.4, keep: 0.7, roll: 3.6 },
  dirt: { restitution: 0.46, keep: 0.8, roll: 2.6 }
};
/** これより弱い跳ね返りは転がりに移る（m/s）。 */
const ROLL_THRESHOLD = 1.4;
const FENCE_RESTITUTION = 0.3;

export interface BallState {
  pos: Vec3;
  vel: Vec3;
  /** 地面に触れた回数。0 ならまだノーバウンド。 */
  bounces: number;
  rolling: boolean;
  stopped: boolean;
}

/** homerun / ground-rule / foul-stands が出たらボールはそこで止まる（デッド）。 */
export type BallEvent = 'bounce' | 'fence' | 'homerun' | 'ground-rule' | 'foul-stands';

export function createBall(pos: Vec3, vel: Vec3): BallState {
  return { pos: copy(pos), vel: copy(vel), bounces: 0, rolling: false, stopped: false };
}

export function cloneBall(b: BallState): BallState {
  return { pos: copy(b.pos), vel: copy(b.vel), bounces: b.bounces, rolling: b.rolling, stopped: b.stopped };
}

export const isTerminal = (e: BallEvent | null) => e === 'homerun' || e === 'ground-rule' || e === 'foul-stands';

export function stepBall(b: BallState, dt = PHYSICS_DT): BallEvent | null {
  if (b.stopped) return null;
  const p = b.pos;
  const v = b.vel;
  let event: BallEvent | null = null;

  if (b.rolling) {
    const speed = lenXZ(v);
    const decel = (onDirt(p) ? GROUND.dirt : GROUND.grass).roll * dt;
    if (speed <= decel) {
      v.x = 0;
      v.z = 0;
      b.stopped = true;
    } else {
      v.x -= (v.x / speed) * decel;
      v.z -= (v.z / speed) * decel;
    }
    v.y = 0;
    p.x += v.x * dt;
    p.z += v.z * dt;
    p.y = BALL_RADIUS;
  } else {
    const speed = Math.hypot(v.x, v.y, v.z);
    v.x -= DRAG * speed * v.x * dt;
    v.y -= (DRAG * speed * v.y + GRAVITY) * dt;
    v.z -= DRAG * speed * v.z * dt;
    p.x += v.x * dt;
    p.y += v.y * dt;
    p.z += v.z * dt;
    if (p.y <= BALL_RADIUS && v.y < 0) {
      const g = onDirt(p) ? GROUND.dirt : GROUND.grass;
      p.y = BALL_RADIUS;
      v.y = -v.y * g.restitution;
      v.x *= g.keep;
      v.z *= g.keep;
      b.bounces += 1;
      if (v.y < ROLL_THRESHOLD) {
        v.y = 0;
        b.rolling = true;
      }
      event = 'bounce';
    }
  }

  // フェンス：越えれば本塁打（ワンバウンド以降ならエンタイトルツーベース）、低ければ跳ね返る。
  const r = lenXZ(p);
  if (isFair(p) && r >= fenceDistance(sprayAngle(p))) {
    if (p.y > FENCE.height) {
      b.stopped = true;
      return b.bounces === 0 ? 'homerun' : 'ground-rule';
    }
    const nx = p.x / r;
    const nz = p.z / r;
    const radial = v.x * nx + v.z * nz;
    if (radial > 0) {
      v.x -= (1 + FENCE_RESTITUTION) * radial * nx;
      v.z -= (1 + FENCE_RESTITUTION) * radial * nz;
      const back = fenceDistance(sprayAngle(p)) - 0.05;
      p.x = nx * back;
      p.z = nz * back;
      event = 'fence';
    }
  }
  if (inFoulStands(p)) {
    b.stopped = true;
    return 'foul-stands';
  }
  return event;
}

export interface PathSample {
  t: number;
  pos: Vec3;
  /** この時点でまだノーバウンドか。 */
  airborne: boolean;
}

export interface PredictedPath {
  samples: PathSample[];
  /** 最初に地面に着く時刻と位置（ノーバウンドでスタンドに入るなら null）。 */
  landing: { t: number; pos: Vec3 } | null;
  /** 予測の終わりで起きたこと（本塁打など）。 */
  end: BallEvent | 'stopped' | 'timeout';
}

/** 今の状態から先の軌道を予測する。sampleEvery ステップごとに記録する。 */
export function predictPath(b: BallState, maxTime = 8, sampleEvery = 4): PredictedPath {
  const sim = cloneBall(b);
  const samples: PathSample[] = [{ t: 0, pos: copy(sim.pos), airborne: sim.bounces === 0 }];
  let landing: PredictedPath['landing'] = null;
  const steps = Math.ceil(maxTime / PHYSICS_DT);
  for (let i = 1; i <= steps; i++) {
    const wasAir = sim.bounces === 0;
    const e = stepBall(sim);
    const t = i * PHYSICS_DT;
    if (wasAir && sim.bounces > 0 && !landing) landing = { t, pos: copy(sim.pos) };
    if (i % sampleEvery === 0 || e) samples.push({ t, pos: copy(sim.pos), airborne: sim.bounces === 0 });
    if (isTerminal(e)) return { samples, landing, end: e! };
    if (sim.stopped) return { samples, landing, end: 'stopped' };
  }
  return { samples, landing, end: 'timeout' };
}
