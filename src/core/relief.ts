// 投手交代の場面：監督がベンチからマウンドへ歩き、内野手と捕手が集まる。リリーフはブルペンの出口から走ってきて、
// 監督からボールを受け取る。代わった投手と監督はベンチへ、内野手は守備位置へ戻る。
// 時刻から全員の位置・向き・動作を決めるだけで、試合の記録には関わらない（交代は場面の前に済んでいる）。
import { DEFAULT_FIELD_POSITIONS, MOUND } from './field.ts';
import { v3, type Vec3 } from './math.ts';
import { along, facingTo, pathDuration } from './scene.ts';
import type { Position } from './types.ts';

export type ReliefAnim = 'run' | 'walk' | 'idle' | 'highfive';

export interface ReliefFigure {
  pos: Vec3;
  facing: number;
  anim: ReliefAnim;
  t: number;
}

/** マウンドに集まる守備の選手。 */
export const GATHER: readonly Position[] = ['C', '1B', '2B', 'SS', '3B'];
/** 監督の歩く速さ・リリーフの走る速さ・選手が戻る速さ（m/s）。 */
const MANAGER_SPEED = 4.2;
const RELIEVER_SPEED = 8;
const WALK_SPEED = 4;
const RETURN_SPEED = 7.5;
const LEAVE_SPEED = 4.5;
/** マウンドに集まる輪の半径（m）。監督はマウンドのベンチ側に立つ。 */
const RING = 2.6;
const TALK = 1.4;
/** ボールを渡すしぐさの長さの半分。渡してから場面を終えるまで。 */
const HANDOFF = 0.35;
const TAIL = 3.4;

export class PitchingChange {
  /** 場面の長さ（秒）。 */
  readonly duration: number;
  /** 監督がリリーフにボールを渡す時刻。 */
  readonly handoff: number;
  private readonly rate: number;
  private readonly dugout: Vec3;
  private readonly gate: Vec3;
  private readonly talk: Vec3;
  private readonly arrive: number;

  /** dugout は守備側のベンチの前、gate はブルペンの出口（field.ts の bullpenGate）。rate を上げると早回しになる。 */
  constructor(dugout: Vec3, gate: Vec3, rate = 1) {
    this.rate = rate;
    this.dugout = dugout;
    this.gate = gate;
    const d = Math.hypot(dugout.x - MOUND.x, dugout.z - MOUND.z);
    this.talk = v3(MOUND.x + ((dugout.x - MOUND.x) / d) * TALK, 0, MOUND.z + ((dugout.z - MOUND.z) / d) * TALK);
    const manager = pathDuration([dugout, this.talk], MANAGER_SPEED);
    this.arrive = pathDuration([gate, this.mound], RELIEVER_SPEED);
    this.handoff = Math.max(manager, this.arrive) + 0.6;
    this.duration = (this.handoff + TAIL) / rate;
  }

  /** リリーフが立つところ（マウンドの少し前）。 */
  private get mound(): Vec3 {
    return v3(MOUND.x, 0, MOUND.z - 0.6);
  }

  /** 監督：マウンドへ歩き、リリーフにボールを渡してベンチへ戻る。 */
  manager(time: number): ReliefFigure {
    const t = time * this.rate;
    const h = this.handoff;
    if (t >= h - HANDOFF && t < h + HANDOFF) return { pos: this.talk, facing: facingTo(this.talk, this.mound), anim: 'highfive', t: t - h + HANDOFF };
    if (t >= h + HANDOFF) {
      const a = along([this.talk, this.dugout], MANAGER_SPEED, t - h - HANDOFF);
      return { pos: a.pos, facing: a.facing, anim: a.moving ? 'walk' : 'idle', t };
    }
    const a = along([this.dugout, this.talk], MANAGER_SPEED, t);
    return { pos: a.pos, facing: a.moving ? a.facing : facingTo(this.talk, MOUND), anim: a.moving ? 'walk' : 'idle', t };
  }

  /** リリーフ：ブルペンの出口からマウンドへ走り、ボールを受け取ってそのまま立つ。 */
  reliever(time: number): ReliefFigure {
    const t = time * this.rate;
    const h = this.handoff;
    if (t >= h - HANDOFF && t < h + HANDOFF) return { pos: this.mound, facing: facingTo(this.mound, this.talk), anim: 'highfive', t: t - h + HANDOFF };
    if (t >= h + HANDOFF) return { pos: this.mound, facing: Math.PI, anim: 'idle', t };
    const a = along([this.gate, this.mound], RELIEVER_SPEED, t);
    return { pos: a.pos, facing: a.moving ? a.facing : facingTo(this.mound, this.talk), anim: a.moving ? 'run' : 'idle', t };
  }

  /** 代わった投手：マウンドで待ち、交代が告げられたらベンチへ小走りで戻る（場面のうちに着かなくてもよい）。 */
  leaving(time: number): ReliefFigure {
    const t = time * this.rate;
    const start = this.handoff - 0.4;
    const from = v3(MOUND.x - 0.8, 0, MOUND.z + 0.3);
    const a = along([from, this.dugout], LEAVE_SPEED, t - start);
    return { pos: a.pos, facing: a.moving ? a.facing : facingTo(from, this.talk), anim: a.moving ? 'run' : 'idle', t };
  }

  /** 集まる選手（GATHER の順）：監督が着くころにマウンドの輪へ歩き、ボールを渡したら守備位置へ小走りで戻る。 */
  gathering(time: number): ReliefFigure[] {
    const t = time * this.rate;
    const go = Math.max(0, this.handoff - 5.5);
    return GATHER.map((p, i) => {
      const home = DEFAULT_FIELD_POSITIONS[p];
      // 輪は本塁側を空けて、捕手は本塁側、内野手はそれぞれの守備位置の側に立つ。
      const a0 = Math.atan2(home.x - MOUND.x, home.z - MOUND.z);
      const spot = v3(MOUND.x + Math.sin(a0) * RING, 0, MOUND.z + Math.cos(a0) * RING);
      const back = this.handoff + HANDOFF + 0.2 + i * 0.1;
      if (t >= back) {
        const a = along([spot, home], RETURN_SPEED, t - back);
        return { pos: a.pos, facing: a.moving ? a.facing : facingTo(home, v3(0, 0, 0)), anim: a.moving ? 'run' : 'idle', t };
      }
      const a = along([home, spot], WALK_SPEED, t - go - i * 0.15);
      return { pos: a.pos, facing: a.moving ? a.facing : facingTo(spot, MOUND), anim: a.moving ? 'walk' : 'idle', t };
    });
  }
}
