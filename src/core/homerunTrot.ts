// 本塁打の後の場面：打者と走者がダイヤモンドを1周し、本塁で次の打者と先に生還した走者と、ベンチの前に並んだ仲間とハイタッチする（プロ野球と同じ）。
// 時刻から全員の位置・向き・動作を決めるだけで、試合の記録には関わらない（得点は本塁打が決まった時点で入っている）。
import { basePos, onDeckPos } from './field.ts';
import { distXZ, lerp, v3, type Vec3 } from './math.ts';
import { along, facingTo, pathDuration } from './scene.ts';

export type TrotAnim = 'run' | 'walk' | 'idle' | 'highfive';

export interface TrotFigure {
  pos: Vec3;
  facing: number;
  anim: TrotAnim;
  /** その動作を始めてからの秒（走る・歩く足の運びにも使う）。 */
  t: number;
}

/** ベンチから出迎える仲間の数。 */
export const GREETERS = 5;
/** ダイヤモンドを回る速さ・本塁からベンチへ小走りする速さ・ベンチの前の列に沿って歩く速さ（m/s）。 */
const TROT_SPEED = 7.5;
const JOG_SPEED = 4.5;
const WALK_SPEED = 2.8;
/** 打球を見届けてから走り出すまで（打者・走者）。 */
const TROT_DELAY = [0.6, 0.3];
/** 本塁で待つ走者の列：本塁から1人目までと、その間隔（m）。打者が通る道の少し後ろ（バックネット側）に並ぶ。 */
const FIRST_SLOT = 1.8;
const SLOT_GAP = 1.2;
const ROW_OFFSET = 1.1;
/**
 * ベンチの前の列：ベンチの前（dugoutPos）から見て本塁側へ BENCH_FIRST m のところから、ファウルラインに沿って BENCH_GAP m おきに並ぶ。
 * 打者は列の BENCH_PASS m グラウンド側を歩く。生還した走者は、ハイタッチの後で列の先に加わる。
 */
const BENCH_FIRST = -4.5;
const BENCH_GAP = 1.2;
const BENCH_PASS = 1.0;
/** 走者がベンチへ戻るときに通る、列からグラウンド側への距離（打者の道とぶつからないように）。 */
const RUNNER_PASS = 2.5;
/** ハイタッチの動作の長さの半分（すれ違う時刻の前後）。 */
const HIGHFIVE = 0.35;
/** 最後のハイタッチの後、場面を終えるまで。 */
const TAIL = 1.5;

/** 塁間の道（u は本塁 0 から 一塁 1 … 本塁 4 までの進み）。 */
const pathPos = (u: number): Vec3 => {
  const a = Math.min(3, Math.max(0, Math.floor(u)));
  return lerp(basePos(a), basePos(a + 1), Math.min(1, Math.max(0, u - a)));
};

export class HomeRunTrot {
  /** 場面の長さ（秒）。 */
  readonly duration: number;
  /** 打者が本塁を踏む時刻。 */
  readonly batterHome: number;
  /** 各走者（0 が打者）がたどる道。null はもう塁上にいない走者。 */
  private readonly routes: (Vec3[] | null)[];
  private readonly arrive: (number | null)[];
  /** 本塁の列（先頭が次の打者、続いて先に生還した走者）の位置と、打者とすれ違う（ハイタッチする）時刻。走者の番号から k 番目を引く。 */
  private readonly homeSlots: Vec3[];
  private readonly homePass: number[];
  private readonly homeSlotOf = new Map<number, number>();
  /** ベンチの前の列（GREETERS 人の仲間）の位置と、打者とすれ違う時刻。 */
  private readonly benchSlots: Vec3[];
  private readonly benchPass: number[];
  /** 打者が本塁からたどる道（本塁 → 列の手前 → 列の先）と、列の手前に着く時刻。 */
  private readonly walk: Vec3[];
  private readonly reachRow: number;
  private readonly dugout: Vec3;
  /** 本塁からベンチの列の手前へ向かう向き。 */
  private readonly dir: Vec3;
  /** ファウルラインに沿って外野へ向かう向きと、ベンチからグラウンドへ向かう向き。 */
  private readonly line: Vec3;
  private readonly field: Vec3;

  /**
   * starts は本塁打が決まったときの各走者の進み（0 が打者、PlaySim.runners と同じ順）。生還済み・アウトの走者は null。
   * dugout は攻撃側のベンチの前（field.ts の dugoutPos）。
   */
  constructor(starts: (number | null)[], dugout: Vec3) {
    this.dugout = dugout;
    const side = Math.sign(dugout.x) || 1;
    this.line = v3(side * Math.SQRT1_2, 0, Math.SQRT1_2);
    this.field = v3(-side * Math.SQRT1_2, 0, Math.SQRT1_2);
    const rowStart = this.benchPoint(BENCH_FIRST - 1, BENCH_PASS);
    this.walk = [basePos(4), rowStart, this.benchPoint(BENCH_FIRST + GREETERS * BENCH_GAP, BENCH_PASS)];
    const l = Math.hypot(rowStart.x, rowStart.z);
    this.dir = v3(rowStart.x / l, 0, rowStart.z / l);
    this.routes = starts.map((u) => {
      if (u === null) return null;
      const pts = [pathPos(u)];
      for (let b = Math.floor(u) + 1; b <= 4; b++) pts.push(basePos(b));
      return pts;
    });
    this.arrive = this.routes.map((r, i) => (r ? TROT_DELAY[i ? 1 : 0] + pathDuration(r, TROT_SPEED) : null));
    this.batterHome = this.arrive[0] ?? 0;
    // 本塁：次の打者が本塁にいちばん近いところで待ち、その先に生還した走者が着いた順に並ぶ。
    const scored = starts
      .map((_, i) => i)
      .filter((i) => i > 0 && this.arrive[i] !== null)
      .sort((a, b) => this.arrive[a]! - this.arrive[b]!);
    scored.forEach((i, k) => this.homeSlotOf.set(i, k + 1));
    const leave = this.batterHome + 0.3;
    this.homeSlots = Array.from({ length: scored.length + 1 }, (_, k) => this.rowPoint(FIRST_SLOT + k * SLOT_GAP, -ROW_OFFSET));
    this.homePass = this.homeSlots.map((_, k) => leave + (FIRST_SLOT + k * SLOT_GAP) / JOG_SPEED);
    // ベンチの前：打者は小走りで列の手前まで来て、列に沿って歩きながら一人ずつハイタッチする。
    this.reachRow = leave + distXZ(this.walk[0], this.walk[1]) / JOG_SPEED;
    this.benchSlots = Array.from({ length: GREETERS }, (_, g) => this.benchPoint(BENCH_FIRST + g * BENCH_GAP, 0));
    this.benchPass = this.benchSlots.map((_, g) => this.reachRow + (1 + g * BENCH_GAP) / WALK_SPEED);
    this.duration = this.benchPass[GREETERS - 1] + TAIL;
  }

  /** 本塁からベンチへ向かう道の s m 先から、横（+ は外野側、- はバックネット側）へ side m ずれた点。 */
  private rowPoint(s: number, side: number): Vec3 {
    return v3(this.dir.x * s - this.dir.z * side * Math.sign(this.dir.x), 0, this.dir.z * s + Math.abs(this.dir.x) * side);
  }

  /** ベンチの前から、ファウルラインに沿って along m（+ が外野側）、グラウンド側へ out m の点。 */
  private benchPoint(along: number, out: number): Vec3 {
    return v3(this.dugout.x + this.line.x * along + this.field.x * out, 0, this.dugout.z + this.line.z * along + this.field.z * out);
  }

  /** 打者の位置（カメラが追う）。 */
  batterPos(time: number): Vec3 {
    return this.batter(time).pos;
  }

  /** 攻撃側のベンチが一塁側なら 1、三塁側なら -1。 */
  get dugoutSide(): 1 | -1 {
    return this.line.x > 0 ? 1 : -1;
  }

  /**
   * ハイタッチの場面でカメラが見る点（center）と、カメラを置く向き（from、center から見た水平の単位ベクトル）。
   * 本塁で走者が待つあいだは本塁の横を、ベンチに近づいたらベンチの前の列をグラウンド側から。どちらでもなければ null（打者を追う）。
   */
  greeting(time: number): { center: Vec3; from: Vec3 } | null {
    if (time > this.reachRow - 1.5) return { center: this.benchPoint(BENCH_FIRST + ((GREETERS - 1) * BENCH_GAP) / 2, BENCH_PASS / 2), from: this.field };
    const n = this.homeSlots.length;
    if (time > this.batterHome - 1.2 && time < this.homePass[n - 1] + HIGHFIVE) {
      return { center: this.rowPoint(FIRST_SLOT + ((n - 1) * SLOT_GAP) / 2, -ROW_OFFSET / 2), from: v3(0, 0, 1) };
    }
    return null;
  }

  /** 各走者（0 が打者）。null の走者は描かない。 */
  runners(time: number): (TrotFigure | null)[] {
    return this.routes.map((route, i) => {
      if (!route) return null;
      if (i === 0) return this.batter(time);
      const arrive = this.arrive[i]!;
      if (time < arrive) {
        const a = along(route, TROT_SPEED, time - TROT_DELAY[1]);
        return { pos: a.pos, facing: a.facing, anim: a.moving ? 'run' : 'idle', t: time };
      }
      const k = this.homeSlotOf.get(i)!;
      const slot = this.homeSlots[k];
      const pass = this.homePass[k];
      if (time < pass - HIGHFIVE) {
        // 本塁を踏んだら列へ歩き、打者のほうを向いて待つ。
        const a = along([basePos(4), slot], WALK_SPEED, time - arrive);
        return { pos: a.pos, facing: a.moving ? a.facing : facingTo(slot, this.batterPos(time)), anim: a.moving ? 'walk' : 'idle', t: time };
      }
      if (time < pass + HIGHFIVE) return { pos: slot, facing: facingTo(slot, this.batterPos(time)), anim: 'highfive', t: time - pass + HIGHFIVE };
      // ハイタッチの後は打者の後ろからベンチへ戻り、列の先に加わる。
      const end = this.benchPoint(BENCH_FIRST + (GREETERS + k) * BENCH_GAP, 0);
      const a = along([slot, this.benchPoint(BENCH_FIRST - 1, RUNNER_PASS), this.benchPoint(BENCH_FIRST + (GREETERS + k) * BENCH_GAP, RUNNER_PASS), end], JOG_SPEED, time - pass - HIGHFIVE);
      return { pos: a.pos, facing: a.moving ? a.facing : facingTo(end, this.batterPos(time)), anim: a.moving ? 'run' : 'idle', t: time };
    });
  }

  /** 次の打者：打者が三塁を回るころに本塁の列の先頭へ歩いてきて、ハイタッチの後はそこで打席を待つ。 */
  nextBatter(time: number): TrotFigure {
    const slot = this.homeSlots[0];
    const pass = this.homePass[0];
    if (time >= pass - HIGHFIVE && time < pass + HIGHFIVE) return { pos: slot, facing: facingTo(slot, this.batterPos(time)), anim: 'highfive', t: time - pass + HIGHFIVE };
    if (time >= pass + HIGHFIVE) return { pos: slot, facing: facingTo(slot, basePos(4)), anim: 'idle', t: time };
    // ネクストバッターズサークルから来る。
    const a = along([onDeckPos(this.dugoutSide), slot], WALK_SPEED, time - (this.batterHome - 4));
    return { pos: a.pos, facing: a.moving ? a.facing : facingTo(slot, this.batterPos(time)), anim: a.moving ? 'walk' : 'idle', t: time };
  }

  /** ベンチの前に並んで打者を迎える仲間。打者が三塁を回るころにベンチから一歩出て、列に並ぶ。 */
  greeters(time: number): TrotFigure[] {
    const out = Math.max(0, this.batterHome - 3);
    return this.benchSlots.map((slot, g) => {
      const pass = this.benchPass[g];
      if (time >= pass - HIGHFIVE && time < pass + HIGHFIVE) return { pos: slot, facing: facingTo(slot, this.batterPos(time)), anim: 'highfive', t: time - pass + HIGHFIVE };
      const inside = this.benchPoint(BENCH_FIRST + g * BENCH_GAP, -1.2);
      const a = along([inside, slot], WALK_SPEED, time - out - g * 0.15);
      // 列に着いたら、来る打者のほうを向いて待つ（ハイタッチの後もそのまま）。
      return { pos: a.pos, facing: a.moving ? a.facing : facingTo(slot, this.batterPos(time)), anim: a.moving ? 'walk' : 'idle', t: time };
    });
  }

  private batter(time: number): TrotFigure {
    const route = this.routes[0];
    if (!route || time < this.batterHome) {
      const a = along(route ?? [basePos(0)], TROT_SPEED, time - TROT_DELAY[0]);
      return { pos: a.pos, facing: a.facing, anim: a.moving ? 'run' : 'idle', t: time };
    }
    // 本塁を踏んだら、本塁で待つ走者とハイタッチしながらベンチの前まで小走りし、列に沿って歩きながら一人ずつハイタッチする。
    const jog = time < this.reachRow;
    const a = jog ? along(this.walk.slice(0, 2), JOG_SPEED, time - this.batterHome - 0.3) : along(this.walk.slice(1), WALK_SPEED, time - this.reachRow);
    const near = [...this.homePass, ...this.benchPass].find((p) => Math.abs(time - p) < HIGHFIVE);
    if (near !== undefined) return { pos: a.pos, facing: a.facing, anim: 'highfive', t: time - near + HIGHFIVE };
    const anim = !a.moving ? 'idle' : jog ? 'run' : 'walk';
    return { pos: a.pos, facing: a.moving ? a.facing : facingTo(a.pos, this.benchPoint(0, 0)), anim, t: time };
  }
}
