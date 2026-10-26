// 投球練習の場面：投手が捕手へ数球投げ、捕手は返球する。最後の1球のあと、捕手が二塁へ送球し、二塁手がベースに入って捕る。
// 攻守交代の後と、投手交代で出てきたリリーフに見せる。時刻から投手・捕手・二塁手・ボールを決めるだけで、試合には関わらない。
import { basePos, DEFAULT_FIELD_POSITIONS, RELEASE_POINT } from './field.ts';
import { lerp, v3, type Vec3 } from './math.ts';
import { WINDUP_TIME } from './pitching.ts';
import { along, facingTo } from './scene.ts';

/** 投げる球数と、1球ごとの間隔（秒）。 */
export const WARMUP_PITCHES = 2;
const PITCH_GAP = 1.9;
/** 投球が捕手のミットに届くまで・捕手の返球・二塁への送球の時間（秒）。 */
const FLIGHT = 0.5;
const RETURN = 0.9;
const THROW_DOWN = 0.8;
/** 二塁手がベースに入る速さ（m/s）と、捕ってから場面を終えるまで。 */
const COVER_SPEED = 5;
const TAIL = 1.1;

const MITT = v3(0, 0.8, -1.0);
const CATCHER_HAND = v3(0.2, 1.7, -1.2);
const PITCHER_GLOVE = v3(0, 1.4, 17.6);

export type WarmupAnim = 'pitch' | 'idle' | 'crouch' | 'throw' | 'catch' | 'run';

export interface WarmupFigure {
  pos: Vec3;
  facing: number;
  anim: WarmupAnim;
  t: number;
}

/** 放物線（高さ arc m の山なり）で a から b へ、u は 0〜1。 */
const arcPos = (a: Vec3, b: Vec3, u: number, arc: number): Vec3 => {
  const p = lerp(a, b, u);
  return v3(p.x, p.y + 4 * arc * u * (1 - u), p.z);
};

export class Warmup {
  /** 場面の長さ（秒）。 */
  readonly duration: number;
  private readonly rate: number;
  private readonly pitches: number;
  /** 最後の投球を捕手が捕る時刻と、二塁への送球を始める時刻。 */
  private readonly lastCatch: number;
  private readonly throwAt: number;

  constructor(rate = 1, pitches = WARMUP_PITCHES) {
    this.rate = rate;
    this.pitches = pitches;
    this.lastCatch = this.startOf(pitches - 1) + WINDUP_TIME + FLIGHT;
    this.throwAt = this.lastCatch + 0.45;
    this.duration = (this.throwAt + THROW_DOWN + TAIL) / rate;
  }

  /** k 球目の投球動作を始める時刻。 */
  private startOf(k: number) {
    return 0.4 + k * PITCH_GAP;
  }

  /** いま何球目の投球の中か（投球動作の始まりから次の球まで）。 */
  private current(t: number): number {
    return Math.max(0, Math.min(this.pitches - 1, Math.floor((t - 0.4) / PITCH_GAP)));
  }

  pitcher(time: number): WarmupFigure {
    const t = time * this.rate;
    const pos = DEFAULT_FIELD_POSITIONS.P;
    const since = t - this.startOf(this.current(t));
    // 二塁への送球は振り向いて見送る。
    if (t > this.throwAt) return { pos, facing: 0, anim: 'idle', t };
    return { pos, facing: Math.PI, anim: since >= 0 ? 'pitch' : 'idle', t: Math.max(0, since) };
  }

  catcher(time: number): WarmupFigure {
    const t = time * this.rate;
    const pos = DEFAULT_FIELD_POSITIONS.C;
    if (t >= this.throwAt) return { pos, facing: 0, anim: 'throw', t: t - this.throwAt };
    // 最後の球を捕ったら立ち上がって送球の構え。
    if (t >= this.lastCatch) return { pos, facing: 0, anim: 'idle', t };
    return { pos, facing: 0, anim: 'crouch', t };
  }

  /** 二塁手：最後の投球のあいだに二塁へ入り、捕手の送球を捕る。 */
  cover(time: number): WarmupFigure {
    const t = time * this.rate;
    const home = DEFAULT_FIELD_POSITIONS['2B'];
    const base = v3(basePos(2).x + 0.4, 0, basePos(2).z - 0.4);
    const catchAt = this.throwAt + THROW_DOWN;
    if (t >= catchAt) return { pos: base, facing: facingTo(base, basePos(0)), anim: 'catch', t: t - catchAt };
    const a = along([home, base], COVER_SPEED, t - (this.lastCatch - 1.2));
    return { pos: a.pos, facing: a.moving ? a.facing : facingTo(base, basePos(0)), anim: a.moving ? 'run' : 'idle', t };
  }

  /** ボールの位置（投球・返球・二塁への送球）。 */
  ball(time: number): Vec3 {
    const t = time * this.rate;
    if (t >= this.throwAt) {
      const u = Math.min(1, (t - this.throwAt) / THROW_DOWN);
      return arcPos(CATCHER_HAND, v3(basePos(2).x, 1.3, basePos(2).z), u, 1.2);
    }
    const k = this.current(t);
    const release = this.startOf(k) + WINDUP_TIME;
    if (t < release) return PITCHER_GLOVE;
    const caught = release + FLIGHT;
    if (t < caught) return arcPos(RELEASE_POINT, MITT, (t - release) / FLIGHT, 0.25);
    if (k === this.pitches - 1) return t < this.lastCatch + 0.3 ? MITT : CATCHER_HAND;
    const back = caught + 0.35;
    if (t < back) return MITT;
    return arcPos(MITT, PITCHER_GLOVE, Math.min(1, (t - back) / RETURN), 1.6);
  }
}
