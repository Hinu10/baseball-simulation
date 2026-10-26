// 死球の後の乱闘の場面：当てられた打者がマウンドへ詰め寄り、捕手が追いかけ、両軍のベンチから選手と監督が飛び出して
// 本塁とマウンドの間でもみ合う。しばらくして引き上げ、打者は一塁へ、走者は押し出された塁へ戻る。
// 時刻から全員の位置・向き・動作を決めるだけで、試合の記録には関わらない（死球は rules.ts で記録済み）。
import { basePos, DEFAULT_FIELD_POSITIONS } from './field.ts';
import { distXZ, lerp, v3, type Vec3 } from './math.ts';
import { Rng } from './rng.ts';
import { FIELD_POSITIONS, type Position } from './types.ts';

export type BrawlAnim = 'hurt' | 'run' | 'walk' | 'idle' | 'shove' | 'point';

export interface BrawlFigure {
  pos: Vec3;
  facing: number;
  anim: BrawlAnim;
  t: number;
}

/** ベンチから飛び出す選手の数（チームごと、監督は別）。 */
export const BENCH_PLAYERS = 8;
/** もみ合いの中心（本塁とマウンドの間）。 */
const CENTER = v3(0, 0, 8);
/** 当てられた打者がうずくまっている時間、詰め寄り始める時刻、もみ合いが解ける時刻、場面の長さ。 */
const HURT = 1.3;
const BENCHES_CLEAR = 2.0;
const BREAK_UP = 10.5;
const END = 16;
const RUN = 6.5;
const WALK = 3.5;
/** 引き上げは、監督は歩き、選手は駆け足でベンチ・守備位置・次の塁へ戻る。 */
const JOG = 6.5;

const facingTo = (from: Vec3, to: Vec3) => Math.atan2(to.x - from.x, to.z - from.z);

/** from から to へ speed で、start 秒に出発したときの t 秒の位置。 */
function travel(from: Vec3, to: Vec3, speed: number, start: number, t: number): { pos: Vec3; facing: number; moving: boolean } {
  const d = distXZ(from, to);
  const k = d < 1e-6 ? 1 : Math.min(1, Math.max(0, ((t - start) * speed) / d));
  return { pos: lerp(from, to, k), facing: facingTo(from, to), moving: t > start && k < 1 };
}

interface Member {
  from: Vec3;
  /** もみ合いでの立ち位置と、引き上げ先。 */
  slot: Vec3;
  home: Vec3;
  start: number;
  speed: number;
  /** もみ合いで向かい合う相手のほう。 */
  foe: Vec3;
  /** 監督は押し合わず、相手の監督に詰め寄って指をさす。 */
  manager?: boolean;
}

export interface BrawlSetup {
  /** 当てられた打者の立ち位置。 */
  batter: Vec3;
  /** 投手の立ち位置（プレートのずらしを含む）。 */
  pitcher: Vec3;
  /** 死球の前に走者がいた塁（1〜3）。 */
  bases: (1 | 2 | 3)[];
  /** 攻撃側・守備側のベンチの前（field.ts の dugoutPos）。 */
  offenseDugout: Vec3;
  defenseDugout: Vec3;
  seed?: number;
}

export class Brawl {
  readonly duration = END;
  private readonly setup: BrawlSetup;
  private readonly members = new Map<string, Member>();

  constructor(setup: BrawlSetup) {
    this.setup = setup;
    const rng = new Rng(setup.seed ?? 1);
    // 攻撃側は本塁側、守備側はマウンド側に半円で並び、真ん中でぶつかる。
    const ring = (side: 1 | -1, k: number, count: number, r: number) => {
      const a = ((k + 0.5) / count - 0.5) * Math.PI * 0.95;
      return v3(CENTER.x + Math.sin(a) * r * 1.3 + rng.range(-0.3, 0.3), 0, CENTER.z + side * (0.5 + Math.cos(a) * r * 0.6) + rng.range(-0.3, 0.3));
    };
    const toward = (side: 1 | -1) => v3(CENTER.x, 0, CENTER.z - side * 2);
    // 打者と投手が真ん中、捕手は打者の後ろから追いかける。
    this.members.set('batter', { from: setup.batter, slot: v3(-0.3, 0, CENTER.z - 0.6), home: basePos(1), start: HURT + 0.3, speed: 4.5, foe: setup.pitcher });
    this.members.set('P', { from: setup.pitcher, slot: v3(0.3, 0, CENTER.z + 0.6), home: setup.pitcher, start: HURT + 0.5, speed: 3, foe: setup.batter });
    // 守備の選手：内野はすぐ、外野は遅れて駆けつける。
    FIELD_POSITIONS.forEach((pos, k) => {
      if (pos === 'P') return;
      const at = DEFAULT_FIELD_POSITIONS[pos as Position];
      const outfield = pos === 'LF' || pos === 'CF' || pos === 'RF';
      this.members.set(pos, { from: at, slot: ring(1, k, 9, 1.6 + rng.range(0, 1.4)), home: at, start: (pos === 'C' ? HURT : BENCHES_CLEAR - 0.4) + rng.range(0, 0.4), speed: outfield ? 8.5 : RUN, foe: toward(1) });
    });
    // 走者：いた塁から駆けつけ、終わったら押し出された塁へ。
    const after = new Set<number>();
    for (const b of [1, 2, 3] as const) {
      const forced = b === 1 || (b === 2 && setup.bases.includes(1)) || (b === 3 && setup.bases.includes(1) && setup.bases.includes(2));
      if (!setup.bases.includes(b)) continue;
      const to = forced ? b + 1 : b;
      after.add(to);
      this.members.set(`r${b}`, { from: basePos(b), slot: ring(-1, b, 4, 1.8 + rng.range(0, 1)), home: to >= 4 ? setup.offenseDugout : basePos(to), start: BENCHES_CLEAR + rng.range(0, 0.5), speed: RUN, foe: toward(-1) });
    }
    // ベンチの選手と監督。
    for (const [team, dugout, side] of [
      ['o', setup.offenseDugout, -1],
      ['d', setup.defenseDugout, 1]
    ] as const) {
      for (let k = 0; k < BENCH_PLAYERS; k++) {
        const from = v3(dugout.x + rng.range(-3, 3), 0, dugout.z + rng.range(-1, 1));
        this.members.set(`${team}${k}`, { from, slot: ring(side, k, BENCH_PLAYERS, 2.4 + rng.range(0, 2.2)), home: from, start: BENCHES_CLEAR + k * 0.12 + rng.range(0, 0.3), speed: RUN + rng.range(-0.5, 0.8), foe: toward(side) });
      }
      // 監督は少し遅れて出てきて、真ん中で相手の監督に詰め寄る。
      this.members.set(`${team}m`, { from: dugout, slot: v3(side * -1.2, 0, CENTER.z + side * 0.9), home: dugout, start: BENCHES_CLEAR + 0.9, speed: 4.2, foe: v3(side * 1.2, 0, CENTER.z - side * 0.9), manager: true });
    }
  }

  /** カメラが見る点：はじめは打者、もみ合いが始まったら真ん中。 */
  focus(time: number): Vec3 {
    const k = Math.min(1, Math.max(0, (time - HURT) / 2));
    return lerp(this.setup.batter, CENTER, k * k * (3 - 2 * k));
  }

  /** いま乱闘になっているか（画面の見出し）。 */
  brawling(time: number): boolean {
    return time >= BENCHES_CLEAR && time < BREAK_UP + 1;
  }

  private figure(key: string, time: number): BrawlFigure | null {
    const m = this.members.get(key);
    if (!m) return null;
    if (key === 'batter' && time < HURT) return { pos: m.from, facing: facingTo(m.from, this.setup.pitcher), anim: 'hurt', t: time };
    if (time < BREAK_UP) {
      const a = travel(m.from, m.slot, m.speed, m.start, time);
      if (a.moving) return { pos: a.pos, facing: a.facing, anim: 'run', t: time };
      if (time < m.start) return { pos: m.from, facing: key === 'P' ? facingTo(m.from, this.setup.batter) : facingTo(m.from, CENTER), anim: 'idle', t: time };
      // 着いたら、相手のほうへ押し合う（少し前後に揺れる）。監督は指をさして抗議する。
      const sway = Math.sin(time * 5 + m.slot.x * 3) * 0.25;
      const dir = facingTo(m.slot, m.foe);
      const pos = v3(m.slot.x + Math.sin(dir) * sway, 0, m.slot.z + Math.cos(dir) * sway);
      return { pos, facing: dir, anim: m.manager ? 'point' : 'shove', t: time };
    }
    // 引き上げ：ベンチ・守備位置・塁へ戻る。
    const jog = !m.manager;
    const a = travel(m.slot, m.home, jog ? JOG : WALK, BREAK_UP + (jog ? 0 : 0.6), time);
    return { pos: a.pos, facing: a.moving ? a.facing : facingTo(m.home, CENTER), anim: a.moving ? (jog ? 'run' : 'walk') : 'idle', t: time };
  }

  /** 打者（攻撃側の 0 番）と、走者（いた塁の番号）。 */
  offense(time: number): (BrawlFigure | null)[] {
    return [this.figure('batter', time), this.figure('r1', time), this.figure('r2', time), this.figure('r3', time)];
  }

  /** 守備の選手（FIELD_POSITIONS の順）。 */
  fielders(time: number): BrawlFigure[] {
    return FIELD_POSITIONS.map((pos) => this.figure(pos, time)!);
  }

  /** ベンチの選手（BENCH_PLAYERS 人）と、最後に監督。team は 'offense' か 'defense'。 */
  bench(team: 'offense' | 'defense', time: number): BrawlFigure[] {
    const t = team === 'offense' ? 'o' : 'd';
    return [...Array.from({ length: BENCH_PLAYERS }, (_, k) => this.figure(`${t}${k}`, time)!), this.figure(`${t}m`, time)!];
  }
}
