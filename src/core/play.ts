// インプレーの打球1つを、守備と走塁ごとに時間で進めるシミュレーション。
// アウト・セーフはボール（送球を含む）と走者の実際の到達順で決まり、結果を PlayResult にまとめて rules.ts に渡す。

import { cloneBall, createBall, PHYSICS_DT, predictPath, stepBall, type BallState, type PredictedPath } from './ballPhysics.ts';
import { battedBallType } from './batting.ts';
import { BASE_DISTANCE, basePos, DEFAULT_FIELD_POSITIONS, isFair } from './field.ts';
import type { GameState, TeamGameState } from './gameState.ts';
import { add, clamp, copy, distXZ, lenXZ, lerp, moveTowardXZ, scale, v3, type Vec3 } from './math.ts';
import type { Rng } from './rng.ts';
import type { PlayOut, PlayResult, PlayRun } from './rules.ts';
import type { Batter } from './teams.ts';
import type { Position } from './types.ts';

export type RunningStrategy = 'aggressive' | 'normal' | 'careful';

export const POSITION_NAME: Record<Position, string> = {
  P: 'ピッチャー',
  C: 'キャッチャー',
  '1B': 'ファースト',
  '2B': 'セカンド',
  '3B': 'サード',
  SS: 'ショート',
  LF: 'レフト',
  CF: 'センター',
  RF: 'ライト'
};

const REACTION = 0.35;
/** ゴロは体勢を整えて捕るので、横への動きは全力疾走より遅い。 */
const GROUND_BALL_PACE = 0.55;
/** これより本塁から遠い場所（外野）では全力で追う。 */
const INFIELD_EDGE = 42;
const BATTER_START = 0.35;
const CATCH_REACH = 0.75;
const DIVE_REACH = 1.9;
const FORCE_RADIUS = 1.0;
const TAG_RADIUS = 1.2;
const OUTFIELD = new Set<Position>(['LF', 'CF', 'RF']);
const RUN_MARGIN: Record<RunningStrategy, number> = { aggressive: -0.1, normal: 0.35, careful: 0.8 };
/** 塁上の走者のリード（塁間に対する割合、約3.3m）。 */
const LEAD = 0.12;
/** ベースカバーの候補（先頭から、打球を追っていない選手を選ぶ）。 */
const COVER: Record<number, Position[]> = { 1: ['1B', 'P', '2B'], 2: ['SS', '2B', 'CF'], 3: ['3B', 'SS', 'LF'], 4: ['C', 'P'] };

export type FielderAnim = 'idle' | 'run' | 'catch' | 'throw' | 'dive';

export interface PlayFielder {
  position: Position;
  playerId: string;
  name: string;
  pos: Vec3;
  home: Vec3;
  speed: number;
  throwSpeed: number;
  fielding: number;
  role: 'chase' | 'cover' | 'backup' | 'idle';
  coverBase: number | null;
  target: Vec3 | null;
  hasBall: boolean;
  /** 捕球してから送球できるまでの残り秒。 */
  holdTimer: number;
  /** 捕り損ね・ダイビング後の動けない残り秒。 */
  recover: number;
  dive: number;
  diveDir: { x: number; z: number };
  /** ボールを持ったときの方針。'hold' ならこれ以上送球しない。 */
  plan: 'none' | 'hold' | 'run';
  runBase: number;
  anim: FielderAnim;
  animTime: number;
  facing: number;
}

export interface PlayRunner {
  playerId: string;
  name: string;
  /** プレー開始時の塁（打者は 0）。 */
  origin: number;
  /** 塁上の位置。0 = 本塁、1 = 一塁 … 4 = 生還。小数は塁間。 */
  u: number;
  target: number;
  speed: number;
  state: 'active' | 'out' | 'scored';
  startDelay: number;
  /** 飛球が捕られたので元の塁に戻らなければならない。 */
  mustReturn: boolean;
  /** プレイヤーの指示で動いている（目標に着くまで AI は変えない）。 */
  human: boolean;
  isBatter: boolean;
}

export interface ThrowState {
  from: Vec3;
  to: Vec3;
  base: number;
  t: number;
  duration: number;
  arc: number;
  thrower: number;
}

export type PlayEventType = 'catch' | 'drop' | 'throw' | 'out' | 'safe' | 'score' | 'bounce' | 'fence' | 'homerun' | 'foul' | 'ground-rule';
export interface PlayEvent {
  type: PlayEventType;
  text?: string;
  pos: Vec3;
}

/** 人が操作する側の入力。守備なら移動・送球・ダイビング・選手切替、攻撃なら進塁・帰塁・走者切替。 */
export interface PlayInput {
  move: { x: number; y: number };
  primary: boolean;
  secondary: boolean;
  switch: boolean;
}
export const NO_INPUT: PlayInput = { move: { x: 0, y: 0 }, primary: false, secondary: false, switch: false };

export interface PlayOptions {
  state: GameState;
  batter: Batter;
  fielding: TeamGameState;
  origin: Vec3;
  velocity: Vec3;
  launch: number;
  bunt: boolean;
  running: RunningStrategy;
  humanDefense: boolean;
  humanOffense: boolean;
  rng: Rng;
}

const runnerSpeed = (speed: number) => 6.0 + 2.8 * (speed / 100);
const fielderSpeed = (speed: number) => 5.6 + 2.6 * (speed / 100);
const throwSpeed = (arm: number) => 24 + 14 * (arm / 100);
const ON_BASE = 0.02;
/** 送球にかかる時間。40m を越える遠投は山なり・ワンバウンドになるぶん遅くなる。 */
const throwTime = (f: { throwSpeed: number }, dist: number) => dist / f.throwSpeed + Math.max(0, dist - 40) * 0.022;
const BASE_NAME = ['本塁', '一塁', '二塁', '三塁', '本塁'];

export class PlaySim {
  time = 0;
  ball: BallState;
  ballMode: 'live' | 'held' | 'thrown' | 'dead' = 'live';
  holder = -1;
  throw: ThrowState | null = null;
  fielders: PlayFielder[];
  runners: PlayRunner[];
  outs: PlayOut[] = [];
  runs: PlayRun[] = [];
  events: PlayEvent[] = [];
  done = false;
  foul = false;
  homeRun = false;
  groundRule = false;
  /** 人が操作している守備選手（守備側が人のとき）。 */
  controlled = -1;
  /** 人が指示する走者（-1 = 全員）。 */
  selectedRunner = -1;
  path: PredictedPath;
  pathStart = 0;

  private readonly outsBefore: number;
  private readonly launch: number;
  private readonly bunt: boolean;
  private readonly rng: Rng;
  private readonly running: RunningStrategy;
  private readonly humanDefense: boolean;
  private readonly humanOffense: boolean;
  private touched = false;
  private settledFair = false;
  private firstFielder: Position | null = null;
  private caughtFly = false;
  /** 飛んでいる打球をノーバウンドで捕れる守備選手がいるか（走者の判断に使う）。 */
  private flyCatchable = false;
  private settleTime = 0;
  private assignTimer = 0;
  private humanIdle = 0;
  private runnerDecision = 0;

  constructor(o: PlayOptions) {
    this.outsBefore = o.state.outs;
    this.launch = o.launch;
    this.bunt = o.bunt;
    this.rng = o.rng;
    this.running = o.running;
    this.humanDefense = o.humanDefense;
    this.humanOffense = o.humanOffense;
    this.ball = createBall(o.origin, o.velocity);
    this.path = predictPath(this.ball);

    const players: { position: Position; id: string; name: string; speed: number; arm: number; fielding: number }[] = o.fielding.lineup
      .filter((b) => b.position !== 'DH')
      .map((b) => ({ position: b.position as Position, id: b.id, name: b.name, speed: b.speed, arm: b.arm, fielding: b.fielding }));
    const p = o.fielding.pitcher;
    players.push({ position: 'P', id: p.id, name: p.name, speed: p.speed, arm: p.arm, fielding: p.fielding });
    this.fielders = players.map((x) => {
      const home = copy(DEFAULT_FIELD_POSITIONS[x.position]);
      if (x.position === 'P') home.z = 17.4;
      return {
        position: x.position,
        playerId: x.id,
        name: x.name,
        pos: copy(home),
        home,
        speed: fielderSpeed(x.speed),
        throwSpeed: throwSpeed(x.arm),
        fielding: x.fielding,
        role: 'idle',
        coverBase: null,
        target: null,
        hasBall: false,
        holdTimer: 0,
        recover: 0,
        dive: 0,
        diveDir: { x: 0, z: 0 },
        plan: 'none',
        runBase: 0,
        anim: 'idle',
        animTime: 0,
        facing: Math.PI
      };
    });

    const batterRunner: PlayRunner = {
      playerId: o.batter.id,
      name: o.batter.name,
      origin: 0,
      u: 0,
      target: 1,
      speed: runnerSpeed(o.batter.speed),
      state: 'active',
      startDelay: BATTER_START,
      mustReturn: false,
      human: false,
      isBatter: true
    };
    this.runners = [batterRunner];
    for (const b of [1, 2, 3] as const) {
      const id = o.state.bases[b];
      if (!id) continue;
      const data = o.state.teams.flatMap((t) => t.team.batters).find((x) => x.id === id)!;
      this.runners.push({
        playerId: id,
        name: data.name,
        origin: b,
        u: b + LEAD,
        target: b + LEAD,
        speed: runnerSpeed(data.speed),
        state: 'active',
        startDelay: 0,
        mustReturn: false,
        human: false,
        isBatter: false
      });
    }
    this.assignFielders();
    if (this.humanDefense) this.controlled = this.fielders.findIndex((f) => f.role === 'chase');
  }

  get batterRunner(): PlayRunner {
    return this.runners[0];
  }

  /** 塁上の位置 u を座標にする。 */
  static runnerPos(u: number): Vec3 {
    const a = Math.floor(clamp(u, 0, 3.999));
    return lerp(basePos(a), basePos(a + 1), clamp(u - a, 0, 1));
  }

  private emit(type: PlayEventType, pos: Vec3, text?: string) {
    this.events.push({ type, pos: copy(pos), text });
  }

  private outCount() {
    return this.outsBefore + this.outs.length;
  }

  // ---- 予測 ----------------------------------------------------------------

  private repredict() {
    this.path = predictPath(this.ball);
    this.pathStart = this.time;
  }

  /** 守備選手 f が転がっている（飛んでいる）ボールに追いつける最も早い時刻と場所。 */
  intercept(f: PlayFielder): { t: number; point: Vec3; air: boolean } {
    const reaction = Math.max(0, REACTION - this.time) + f.recover;
    const samples = this.path.samples;
    for (const s of samples) {
      const t = this.pathStart + s.t;
      if (t < this.time) continue;
      if (s.pos.y > 2.2) continue;
      const pace = s.airborne || lenXZ(s.pos) > INFIELD_EDGE ? 1 : GROUND_BALL_PACE;
      const need = Math.max(0, distXZ(f.pos, s.pos) - CATCH_REACH) / (f.speed * pace) + reaction;
      if (need <= t - this.time) return { t, point: v3(s.pos.x, 0, s.pos.z), air: s.airborne };
    }
    const last = samples[samples.length - 1];
    const need = Math.max(0, distXZ(f.pos, last.pos) - CATCH_REACH) / f.speed + reaction;
    return { t: Math.max(this.pathStart + last.t, this.time + need), point: v3(last.pos.x, 0, last.pos.z), air: false };
  }

  /** 捕球担当・ベースカバー・バックアップを決める。 */
  private assignFielders() {
    const live = this.ballMode === 'live';
    let chaser = -1;
    if (live) {
      let best = Infinity;
      this.fielders.forEach((f, i) => {
        // 人が操作しているときは、人の選手が追う（AI は追わない）。放置されたら AI が代わる。
        if (this.humanDefense && this.controlled >= 0 && this.humanIdle < 3 && i !== this.controlled) return;
        const t = this.intercept(f).t;
        if (t < best) {
          best = t;
          chaser = i;
        }
      });
    }
    // 一度「捕られそう」と読んだら、着地するまでその読みを変えない（境目で走者が飛び出さないように）。
    if (live && this.ball.bounces === 0 && !this.flyCatchable) this.flyCatchable = this.fielders.some((f) => this.intercept(f).air);
    const taken = new Set<number>();
    if (chaser >= 0) taken.add(chaser);
    if (this.holder >= 0) taken.add(this.holder);
    const covers = new Map<number, number>();
    for (const base of [1, 2, 3, 4]) {
      for (const pos of COVER[base]) {
        const i = this.fielders.findIndex((f) => f.position === pos);
        if (!taken.has(i)) {
          covers.set(i, base);
          taken.add(i);
          break;
        }
      }
    }
    const landing = this.path.landing?.pos ?? this.path.samples[this.path.samples.length - 1].pos;
    this.fielders.forEach((f, i) => {
      if (i === this.holder) return;
      if (i === chaser) {
        f.role = 'chase';
        f.coverBase = null;
        f.target = this.intercept(f).point;
      } else if (covers.has(i)) {
        f.role = 'cover';
        f.coverBase = covers.get(i)!;
        f.target = copy(basePos(f.coverBase));
      } else if (OUTFIELD.has(f.position) && live) {
        f.role = 'backup';
        f.coverBase = null;
        f.target = lerp(f.home, v3(landing.x, 0, landing.z), 0.55);
      } else {
        f.role = 'idle';
        f.coverBase = null;
        f.target = null;
      }
    });
  }

  // ---- 走者 ------------------------------------------------------------------

  private runnerByOrigin(origin: number) {
    return this.runners.find((r) => r.origin === origin);
  }

  /** 打者走者から続くフォースの連鎖が生きているか。 */
  private chainForced(origin: number): boolean {
    const r = this.runnerByOrigin(origin);
    if (!r || r.state === 'out') return false;
    if (origin === 0) return !this.caughtFly;
    return this.chainForced(origin - 1);
  }

  /** 走者がフォースで進まなければならない塁（まだ着いていなければ）。 */
  forcedTo(r: PlayRunner): number | null {
    if (r.state !== 'active' || r.mustReturn || this.caughtFly) return null;
    const to = r.origin + 1;
    if (r.u >= to) return null;
    return this.chainForced(r.origin) ? to : null;
  }

  private onBase(r: PlayRunner): boolean {
    const b = Math.round(r.u);
    return b >= 1 && Math.abs(r.u - b) < ON_BASE;
  }

  private isMoving(r: PlayRunner) {
    return r.state === 'active' && (Math.abs(r.u - r.target) > ON_BASE || !this.onBase(r));
  }

  /** 先を走る走者。 */
  private leadOf(r: PlayRunner): PlayRunner | undefined {
    return this.runners
      .filter((x) => x !== r && x.state === 'active' && x.origin > r.origin)
      .sort((a, b) => a.origin - b.origin)[0];
  }

  /** 守備側がボールを base に届けるまでの見込み時間。 */
  private ballEtaTo(base: number): number {
    const dest = basePos(base);
    if (this.ballMode === 'held') {
      const f = this.fielders[this.holder];
      const d = distXZ(f.pos, dest);
      if (d < 3) return 0;
      return Math.max(0, f.holdTimer) + 0.15 + Math.min(throwTime(f, d), d / f.speed);
    }
    if (this.ballMode === 'thrown' && this.throw) {
      const left = this.throw.duration - this.throw.t;
      return left + distXZ(this.throw.to, dest) / 30 + (this.throw.base === base ? 0 : 0.4);
    }
    let best = Infinity;
    for (const f of this.fielders) {
      const ic = this.intercept(f);
      const eta = ic.t - this.time + this.transferTime(f) + 0.15 + throwTime(f, distXZ(ic.point, dest));
      best = Math.min(best, eta);
    }
    return best;
  }

  private runnerEta(r: PlayRunner, base: number) {
    return Math.max(0, r.startDelay) + (Math.abs(base - r.u) * BASE_DISTANCE) / r.speed;
  }

  private baseTaken(r: PlayRunner, base: number): boolean {
    if (base >= 4) return false;
    return this.runners.some((x) => x !== r && x.state === 'active' && x.origin > r.origin && (Math.round(x.target) <= base || x.u <= base));
  }

  private decideRunner(r: PlayRunner) {
    if (r.state !== 'active') return;
    if (r.mustReturn) {
      r.target = r.origin;
      r.human = false;
      return;
    }
    if (r.human) {
      if (Math.abs(r.u - r.target) < ON_BASE) r.human = false;
      else return;
    }
    const forced = this.forcedTo(r);
    const flyInAir = this.ballMode === 'live' && this.ball.bounces === 0 && !this.touched && this.launch >= 4;
    if (flyInAir && this.flyCatchable && this.outCount() < 2 && !r.isBatter) {
      // 捕られそうな飛球は塁で待ち、捕球後にタッチアップを考える（2アウトなら打った瞬間に走る）。
      // 落ちる打球だと読めたら、ふつうの打球と同じく走る。
      r.target = r.origin;
      return;
    }
    if (forced !== null) {
      r.target = Math.max(r.target, forced);
      return;
    }
    const margin = RUN_MARGIN[this.running];
    if (Math.abs(r.u - r.target) < ON_BASE) {
      // 止まっている（塁上かリードの位置）：次の塁へ行けるなら行き、行けないならリードから塁へ戻る。
      const last = Math.floor(r.u + ON_BASE);
      const next = last + 1;
      if (next <= 4 && !this.baseTaken(r, next) && this.ballEtaTo(next) - this.runnerEta(r, next) > margin) r.target = next;
      else if (!this.onBase(r)) r.target = Math.max(last, r.isBatter ? 1 : r.origin);
      return;
    }
    if (r.target > r.u && r.target < 4 && r.target - r.u < 0.3 && Number.isInteger(r.target)) {
      // 塁の手前（約8m）で、止まらずに次の塁を狙うか決める。
      const next = r.target + 1;
      if (!this.baseTaken(r, next) && this.ballEtaTo(next) - this.runnerEta(r, next) > margin + 0.2) {
        r.target = next;
        return;
      }
    }
    if (r.target > r.u) {
      // 次の塁が間に合わないなら、半分より手前なら戻る。
      const back = Math.floor(r.u + 1e-9);
      const progress = r.u - back;
      if (back >= Math.max(1, r.origin) && progress < 0.5 && this.ballEtaTo(r.target) < this.runnerEta(r, r.target) - 0.15) r.target = back;
    }
  }

  private moveRunners(dt: number) {
    for (const r of this.runners) {
      if (r.state !== 'active') continue;
      if (r.startDelay > 0) {
        r.startDelay -= dt;
        continue;
      }
      const minTarget = r.isBatter ? 1 : r.mustReturn ? r.origin : Math.min(r.origin, Math.floor(r.u));
      r.target = clamp(r.target, minTarget, 4);
      const step = (r.speed / BASE_DISTANCE) * dt;
      const before = r.u;
      if (r.u < r.target) r.u = Math.min(r.target, r.u + step);
      else if (r.u > r.target) r.u = Math.max(r.target, r.u - step);
      const lead = this.leadOf(r);
      if (lead && lead.u < 4 && r.u > lead.u - 0.04 && lead.u > r.origin) r.u = Math.max(r.origin, lead.u - 0.04);
      if (r.mustReturn && Math.abs(r.u - r.origin) < ON_BASE) r.mustReturn = false;
      // 送球が向かっている塁に先に着いたらセーフ。
      const arrived = Math.floor(r.u + 1e-9);
      if (arrived > Math.floor(before + 1e-9) && arrived < 4 && this.ballMode === 'thrown' && this.throw?.base === arrived) {
        this.emit('safe', basePos(arrived), 'セーフ');
      }
      if (r.u >= 4) {
        r.u = 4;
        r.state = 'scored';
        this.runs.push({ playerId: r.playerId, time: this.time });
        this.emit('score', basePos(4), `${r.name} 生還`);
      }
    }
  }

  private commandRunners(input: PlayInput) {
    const active = this.runners.map((r, i) => ({ r, i })).filter((x) => x.r.state === 'active');
    if (input.switch) {
      const ids = [-1, ...active.map((x) => x.i)];
      const at = ids.indexOf(this.selectedRunner);
      this.selectedRunner = ids[(at + 1) % ids.length];
    }
    if (this.selectedRunner >= 0 && this.runners[this.selectedRunner].state !== 'active') this.selectedRunner = -1;
    const chosen = active.filter((x) => this.selectedRunner < 0 || x.i === this.selectedRunner).map((x) => x.r);
    // 先の走者から順に指示する（後ろの走者が先の走者を追い越さないように）。
    chosen.sort((a, b) => b.origin - a.origin);
    for (const r of chosen) {
      if (input.primary && !r.mustReturn) {
        const next = Math.min(4, Math.floor(r.u + ON_BASE) + 1);
        if (!this.baseTaken(r, next)) {
          r.target = next;
          r.human = true;
        }
      }
      if (input.secondary && this.forcedTo(r) === null) {
        r.target = Math.max(r.isBatter ? 1 : r.origin, Math.floor(r.u - ON_BASE));
        r.human = true;
      }
    }
  }

  private recordOut(r: PlayRunner, kind: PlayOut['kind'], text: string) {
    r.state = 'out';
    this.outs.push({ playerId: r.playerId, kind, time: this.time, batterBeforeFirst: r.isBatter && r.u < 1 && kind !== 'fly' });
    this.emit('out', PlaySim.runnerPos(r.u), text);
  }

  /** ボールを持った守備選手による、フォースアウト・タッチアウト。 */
  private checkOuts() {
    if (this.ballMode !== 'held') return;
    const f = this.fielders[this.holder];
    for (const r of this.runners) {
      if (r.state !== 'active') continue;
      const forced = this.forcedTo(r);
      if (forced !== null && distXZ(f.pos, basePos(forced)) < FORCE_RADIUS) {
        this.recordOut(r, 'force', forced === 1 ? '一塁アウト' : `${BASE_NAME[forced]}フォースアウト`);
        continue;
      }
      if (r.mustReturn && distXZ(f.pos, basePos(r.origin)) < FORCE_RADIUS && Math.abs(r.u - r.origin) > ON_BASE) {
        this.recordOut(r, 'tag', '帰塁できずアウト');
        continue;
      }
      if (r.startDelay <= 0 && !this.onBase(r) && distXZ(f.pos, PlaySim.runnerPos(r.u)) < TAG_RADIUS) {
        this.recordOut(r, 'tag', 'タッチアウト');
      }
    }
  }

  // ---- 守備 ------------------------------------------------------------------

  private catchChance(f: PlayFielder, diving: boolean): number {
    const v = this.ball.vel;
    const speed = Math.hypot(v.x, v.y, v.z);
    const base = this.ball.bounces === 0 ? 0.985 : 0.975;
    const penalty = Math.max(0, speed - 20) * 0.013 * (1.25 - f.fielding / 100);
    return clamp(base - penalty - (diving ? 0.25 : 0), 0.35, 0.995);
  }

  private tryCatch() {
    if (this.ballMode !== 'live') return;
    const b = this.ball;
    const air = b.bounces === 0 && !b.rolling;
    if (b.pos.y > (air ? 2.3 : 1.2)) return;
    for (let i = 0; i < this.fielders.length; i++) {
      const f = this.fielders[i];
      if (f.recover > 0) continue;
      const diving = f.dive > 0;
      const reach = (diving ? DIVE_REACH : CATCH_REACH) + f.fielding * 0.002;
      if (distXZ(f.pos, b.pos) > reach) continue;
      // 打球が投手・捕手の手前でまだ速いうちは捕れない（打った直後の自打球などを除く）。
      if (this.time < 0.15) continue;
      if (!this.touched && !this.settledFair && !isFair(b.pos) && b.bounces > 0) return;
      const ok = this.rng.chance(this.catchChance(f, diving));
      this.touch(f, b.pos);
      if (this.done) return;
      if (ok) {
        this.giveBall(i);
        f.anim = 'catch';
        f.animTime = 0;
        if (air) {
          this.caughtFly = true;
          const batter = this.batterRunner;
          const kind = battedBallType(this.launch);
          this.recordOut(batter, 'fly', `${POSITION_NAME[f.position]}${kind === 'liner' ? 'ライナー' : 'フライ'}`);
          for (const r of this.runners) if (r.state === 'active' && !r.isBatter && r.u > r.origin + ON_BASE) r.mustReturn = true;
        } else {
          this.emit('catch', b.pos);
        }
      } else {
        // はじいた：勢いを殺して少し転がす。
        const sp = 2 + this.rng.next() * 3;
        const ang = this.rng.range(0, Math.PI * 2);
        b.vel = v3(Math.sin(ang) * sp, air ? 1.5 : 0, Math.cos(ang) * sp);
        b.rolling = !air;
        f.recover = 0.55;
        this.emit('drop', b.pos, 'はじいた');
        this.repredict();
        this.assignFielders();
      }
      return;
    }
  }

  /** 守備選手がボールに触れた。フェア／ファウルが決まる。 */
  private touch(f: PlayFielder, at: Vec3) {
    if (!this.touched && !this.settledFair && !isFair(at) && this.ball.bounces > 0) {
      this.markFoul();
      return;
    }
    if (!this.touched && isFair(at)) this.settledFair = true;
    this.touched = true;
    this.firstFielder ??= f.position;
  }

  private giveBall(i: number) {
    const f = this.fielders[i];
    this.ballMode = 'held';
    this.holder = i;
    this.throw = null;
    f.hasBall = true;
    f.plan = 'none';
    f.role = 'idle';
    f.target = null;
    f.holdTimer = this.transferTime(f);
    if (this.humanDefense) this.controlled = i;
    this.assignFielders();
  }

  /** 捕球から送球までの持ち替え時間。外野手は体勢を整えるぶん長い。 */
  private transferTime(f: PlayFielder) {
    return (OUTFIELD.has(f.position) ? 0.6 : 0.25) + (1 - f.fielding / 100) * (OUTFIELD.has(f.position) ? 0.4 : 0.25);
  }

  private markFoul() {
    this.foul = true;
    this.ballMode = 'dead';
    this.done = true;
    this.emit('foul', this.ball.pos, 'ファウル');
  }

  /** ボールを持った選手の送球先を決める。 */
  chooseThrow(f: PlayFielder): { kind: 'throw' | 'run'; base: number } | { kind: 'hold' } {
    let best: { kind: 'throw' | 'run'; base: number; score: number } | null = null;
    for (const r of this.runners) {
      if (r.state !== 'active' || r.startDelay > 0.2) continue;
      if (!this.isMoving(r) && !r.mustReturn) continue;
      const base = r.mustReturn ? r.origin : Math.round(r.target);
      if (base < 1 || base === Math.round(r.u) && this.onBase(r)) continue;
      const dest = basePos(base);
      const runnerEta = this.runnerEta(r, base);
      const dist = distXZ(f.pos, dest);
      const selfEta = dist / f.speed;
      let coverEta = Infinity;
      for (const c of this.fielders) if (c !== f) coverEta = Math.min(coverEta, distXZ(c.pos, dest) / c.speed);
      const throwEta = Math.max(0.12 + throwTime(f, dist), coverEta + 0.1);
      const useRun = dist < 18 && selfEta <= throwEta;
      const eta = useRun ? selfEta : throwEta;
      const margin = runnerEta - eta;
      if (margin <= 0.08) continue;
      const score = base * 10 + margin;
      if (!best || score > best.score) best = { kind: useRun ? 'run' : 'throw', base, score };
    }
    if (best) return { kind: best.kind, base: best.base };
    // アウトが取れないとき、外野手は走者の先の塁（なければ二塁）へ返球して進塁を止める。
    if (OUTFIELD.has(f.position) || lenXZ(f.pos) > 45) {
      const moving = this.runners.filter((r) => r.state === 'active' && this.isMoving(r));
      if (moving.length) {
        const lead = Math.max(...moving.map((r) => r.target));
        return { kind: 'throw', base: clamp(lead, 2, 4) };
      }
    }
    return { kind: 'hold' };
  }

  private throwTo(i: number, base: number) {
    const f = this.fielders[i];
    const to = add(basePos(base), v3(0, 1.2, 0));
    const from = add(f.pos, v3(0, 1.6, 0));
    const dist = distXZ(from, to);
    if (dist < 2) return;
    f.hasBall = false;
    f.plan = 'none';
    f.anim = 'throw';
    f.animTime = 0;
    this.ballMode = 'thrown';
    this.holder = -1;
    this.throw = { from, to, base, t: 0, duration: throwTime(f, dist), arc: Math.min(5, dist * 0.05), thrower: i };
    this.emit('throw', from, `${BASE_NAME[base]}へ送球`);
    this.assignFielders();
  }

  private updateThrow(dt: number) {
    const th = this.throw!;
    th.t += dt;
    const s = Math.min(1, th.t / th.duration);
    const p = lerp(th.from, th.to, s);
    p.y += th.arc * 4 * s * (1 - s);
    this.ball.pos = p;
    if (s < 1) return;
    let best = -1;
    let bestD = 1.8;
    this.fielders.forEach((f, i) => {
      if (i === th.thrower || f.recover > 0) return;
      const d = distXZ(f.pos, th.to);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best >= 0) {
      this.giveBall(best);
      this.fielders[best].holdTimer = 0.12;
      this.fielders[best].anim = 'catch';
      this.fielders[best].animTime = 0;
      return;
    }
    // 受け手がいない：ボールはベース付近を転がる。
    const dir = scale(v3(th.to.x - th.from.x, 0, th.to.z - th.from.z), 1 / Math.max(1, distXZ(th.from, th.to)));
    this.ball = createBall(v3(th.to.x, 0.4, th.to.z), v3(dir.x * 4, 0, dir.z * 4));
    this.ball.bounces = 1;
    this.ball.rolling = true;
    this.ballMode = 'live';
    this.throw = null;
    this.repredict();
    this.assignFielders();
  }

  private moveFielder(f: PlayFielder, dt: number, dir: { x: number; z: number } | null) {
    f.animTime += dt;
    if (f.recover > 0) {
      f.recover -= dt;
      return;
    }
    if (f.dive > 0) {
      f.dive -= dt;
      f.pos.x += f.diveDir.x * 7 * dt;
      f.pos.z += f.diveDir.z * 7 * dt;
      if (f.dive <= 0) f.recover = 0.7;
      return;
    }
    if (this.time < REACTION) return;
    let moving = false;
    if (dir) {
      const l = Math.hypot(dir.x, dir.z);
      if (l > 0.1) {
        f.pos.x += (dir.x / Math.max(1, l)) * f.speed * dt;
        f.pos.z += (dir.z / Math.max(1, l)) * f.speed * dt;
        f.facing = Math.atan2(dir.x, dir.z);
        moving = true;
      }
    } else if (f.target) {
      const d = distXZ(f.pos, f.target);
      if (d > 0.05) {
        f.facing = Math.atan2(f.target.x - f.pos.x, f.target.z - f.pos.z);
        const pace = f.role === 'chase' && this.ballMode === 'live' && this.ball.bounces > 0 && lenXZ(f.target) < INFIELD_EDGE ? GROUND_BALL_PACE : 1;
        moveTowardXZ(f.pos, f.target, f.speed * pace * dt);
        moving = d > 0.3;
      }
    }
    if (f.anim === 'catch' || f.anim === 'throw') {
      if (f.animTime > 0.45) {
        f.anim = moving ? 'run' : 'idle';
        f.animTime = 0;
      }
    } else if (f.anim === 'dive') {
      f.anim = 'idle';
    } else {
      const next: FielderAnim = moving ? 'run' : 'idle';
      if (next !== f.anim) {
        f.anim = next;
        f.animTime = 0;
      }
    }
  }

  private updateHolderAI(i: number, dt: number) {
    const f = this.fielders[i];
    f.holdTimer -= dt;
    if (f.holdTimer > 0) return;
    if (f.plan === 'run') {
      f.target = copy(basePos(f.runBase));
      if (distXZ(f.pos, f.target) < 0.5) {
        f.plan = 'none';
        f.holdTimer = 0.1;
      }
      return;
    }
    const plan = this.chooseThrow(f);
    if (plan.kind === 'throw') this.throwTo(i, plan.base);
    else if (plan.kind === 'run') {
      f.plan = 'run';
      f.runBase = plan.base;
      f.target = copy(basePos(plan.base));
    } else {
      f.plan = 'hold';
      f.target = null;
    }
  }

  private updateHumanFielder(input: PlayInput, dt: number) {
    const i = this.controlled;
    const f = this.fielders[i];
    const moving = Math.hypot(input.move.x, input.move.y) > 0.1;
    this.humanIdle = moving || input.primary || input.secondary ? 0 : this.humanIdle + dt;
    if (input.switch && this.ballMode !== 'held') {
      // いちばんボールに近い選手へ。すでにその選手なら2番目に近い選手へ。
      const order = this.fielders
        .map((x, j) => ({ j, d: distXZ(x.pos, this.ball.pos) }))
        .sort((a, b) => a.d - b.d)
        .map((x) => x.j);
      this.controlled = order[0] === i ? order[1] : order[0];
      this.assignFielders();
      return;
    }
    const assist = this.humanIdle > 3;
    if (f.hasBall) {
      f.holdTimer -= dt;
      if ((input.primary || assist) && f.holdTimer <= 0) {
        let base: number | null = null;
        const m = input.move;
        if (m.y > 0.5) base = 2;
        else if (m.x > 0.5) base = 1;
        else if (m.x < -0.5) base = 3;
        else if (m.y < -0.5) base = 4;
        if (base === null) {
          const plan = this.chooseThrow(f);
          base = plan.kind === 'hold' ? null : plan.base;
          if (base === null) {
            f.plan = 'hold';
            return;
          }
        }
        if (distXZ(f.pos, basePos(base)) < 2) {
          f.plan = 'hold';
          return;
        }
        this.throwTo(i, base);
        return;
      }
      f.plan = 'hold';
      this.moveFielder(f, dt, input.primary ? null : { x: input.move.x, z: input.move.y });
      return;
    }
    if (input.secondary && f.dive <= 0 && f.recover <= 0) {
      const l = Math.hypot(input.move.x, input.move.y);
      const toBall = { x: this.ball.pos.x - f.pos.x, z: this.ball.pos.z - f.pos.z };
      const tl = Math.hypot(toBall.x, toBall.z) || 1;
      f.diveDir = l > 0.1 ? { x: input.move.x / l, z: input.move.y / l } : { x: toBall.x / tl, z: toBall.z / tl };
      f.dive = 0.45;
      f.anim = 'dive';
      f.animTime = 0;
      return;
    }
    if (assist) {
      f.target = this.ballMode === 'live' ? this.intercept(f).point : f.target;
      this.moveFielder(f, dt, null);
    } else {
      this.moveFielder(f, dt, { x: input.move.x, z: input.move.y });
    }
  }

  // ---- 進行 ------------------------------------------------------------------

  private updateBall(dt: number) {
    if (this.ballMode === 'held') {
      const f = this.fielders[this.holder];
      this.ball.pos = add(f.pos, v3(0, 1.1, 0));
      return;
    }
    if (this.ballMode === 'thrown') {
      this.updateThrow(dt);
      return;
    }
    if (this.ballMode !== 'live') return;
    const wasAir = this.ball.bounces === 0;
    const e = stepBall(this.ball, dt);
    if (e === 'bounce' && wasAir) this.emit('bounce', this.ball.pos);
    if (e === 'fence') this.emit('fence', this.ball.pos);
    if (wasAir && this.ball.bounces > 0 && !this.touched) {
      // 最初の着地：ファウル地域ならファウル。内野を越えてフェア地域に落ちたらフェアが確定。
      if (!isFair(this.ball.pos)) {
        this.markFoul();
        return;
      }
      if (lenXZ(this.ball.pos) > BASE_DISTANCE + 1) this.settledFair = true;
    }
    if (!this.touched && !this.settledFair && this.ball.bounces > 0) {
      // 塁を越える前にファウル地域へ転がり出たらファウル。塁を越えたらフェア。
      if (!isFair(this.ball.pos)) {
        this.markFoul();
        return;
      }
      if (this.ball.pos.z > BASE_DISTANCE / Math.SQRT2 + 0.5 || lenXZ(this.ball.pos) > BASE_DISTANCE + 1) this.settledFair = true;
    }
    if (e === 'homerun') {
      this.homeRun = true;
      this.ballMode = 'dead';
      this.done = true;
      this.emit('homerun', this.ball.pos, 'ホームラン！');
    } else if (e === 'ground-rule') {
      this.groundRule = true;
      this.ballMode = 'dead';
      this.done = true;
      this.emit('ground-rule', this.ball.pos, 'エンタイトルツーベース');
    } else if (e === 'foul-stands') {
      if (this.settledFair) {
        this.groundRule = true;
        this.ballMode = 'dead';
        this.done = true;
        this.emit('ground-rule', this.ball.pos, 'エンタイトルツーベース');
      } else {
        this.markFoul();
      }
    }
  }

  /** dt 秒進める（内部では PHYSICS_DT 刻み）。 */
  tick(dt: number, input: PlayInput = NO_INPUT) {
    let left = dt;
    let first = true;
    while (left > 1e-9 && !this.done) {
      const h = Math.min(PHYSICS_DT, left);
      // 押した瞬間の入力は最初の刻みだけに渡し、移動はすべての刻みに渡す。
      this.step(h, first ? input : { ...NO_INPUT, move: input.move });
      first = false;
      left -= h;
    }
  }

  private step(dt: number, input: PlayInput) {
    this.time += dt;
    this.updateBall(dt);
    if (this.done) return;

    this.assignTimer -= dt;
    if (this.assignTimer <= 0 && this.ballMode === 'live') {
      this.assignTimer = 0.1;
      this.assignFielders();
    }
    this.fielders.forEach((f, i) => {
      if (this.humanDefense && i === this.controlled) return;
      if (i === this.holder) {
        this.updateHolderAI(i, dt);
        if (this.ballMode === 'held' && this.holder === i) this.moveFielder(f, dt, null);
        return;
      }
      this.moveFielder(f, dt, null);
    });
    if (this.humanDefense && this.controlled >= 0) this.updateHumanFielder(input, dt);
    this.tryCatch();
    if (this.done) return;

    if (this.humanOffense) this.commandRunners(input);
    this.runnerDecision -= dt;
    if (this.runnerDecision <= 0) {
      this.runnerDecision = 0.1;
      for (const r of this.runners) this.decideRunner(r);
    }
    this.moveRunners(dt);
    this.checkOuts();
    if (this.outCount() >= 3) {
      this.done = true;
      return;
    }

    // ボールが内野に戻り、走者が全員塁で止まったらプレー終了。
    const anyMoving = this.runners.some((r) => r.state === 'active' && (this.isMoving(r) || r.mustReturn));
    const holder = this.holder >= 0 ? this.fielders[this.holder] : null;
    const settled = this.ballMode === 'held' && !anyMoving && holder !== null && (holder.plan === 'hold' || (this.humanDefense && this.holder === this.controlled));
    this.settleTime = settled ? this.settleTime + dt : 0;
    if (this.settleTime > (this.humanDefense ? 0.8 : 0.5)) this.done = true;
    if (this.time > 45) this.done = true;
  }

  // ---- 結果 ------------------------------------------------------------------

  result(): PlayResult & { foul: boolean } {
    const bases: PlayResult['bases'] = [null, null, null, null];
    if (this.foul) return { outs: [], runs: [], bases, hit: 0, text: 'ファウル', foul: true };
    const kind = battedBallType(this.launch);
    const fielder = this.firstFielder ? POSITION_NAME[this.firstFielder] : '';

    if (this.homeRun) {
      const runs = [...this.runs, ...this.runners.filter((r) => r.state === 'active').map((r) => ({ playerId: r.playerId, time: this.time }))];
      const text = runs.length === 4 ? '満塁ホームラン！' : runs.length === 1 ? 'ソロホームラン！' : `${['', '', 'ツーラン', 'スリーラン'][runs.length]}ホームラン！`;
      return { outs: this.outs, runs, bases, hit: 4, text, foul: false };
    }
    if (this.groundRule) {
      const runs = [...this.runs];
      for (const r of this.runners) {
        if (r.state !== 'active') continue;
        const to = Math.max(Math.round(r.u), r.origin + 2);
        if (to >= 4) runs.push({ playerId: r.playerId, time: this.time });
        else bases[to as 1 | 2 | 3] = r.playerId;
      }
      return { outs: this.outs, runs, bases, hit: 2, text: 'エンタイトルツーベース', foul: false };
    }

    // 塁間で終わった走者は近い塁に置く（時間切れのときだけ起こる）。
    const placed = this.runners.filter((r) => r.state === 'active').sort((a, b) => b.origin - a.origin);
    for (const r of placed) {
      let b = clamp(Math.round(r.u), 1, 3);
      while (b > 1 && bases[b as 1 | 2 | 3]) b--;
      while (b <= 3 && bases[b as 1 | 2 | 3]) b++;
      if (b <= 3) bases[b as 1 | 2 | 3] = r.playerId;
    }

    const batter = this.batterRunner;
    const batterOut = batter.state === 'out';
    let hit: PlayResult['hit'] = 0;
    let text: string;
    if (batterOut) {
      const out = this.outs.find((o) => o.playerId === batter.playerId)!;
      text = out.kind === 'fly' ? `${fielder}${kind === 'liner' ? 'ライナー' : 'フライ'}` : `${fielder}${this.bunt ? 'へのバント' : 'ゴロ'}`;
      if (this.outs.length >= 2) text += this.outs.length >= 3 ? '（トリプルプレー）' : '（併殺）';
    } else if (this.outs.length > 0) {
      text = this.bunt ? '送りバント' : `${fielder}ゴロ（フィルダースチョイス）`;
      if (this.bunt && this.outs.length > 0) text = `${fielder}へのバント（フィルダースチョイス）`;
    } else {
      const reached = batter.state === 'scored' ? 4 : clamp(Math.round(batter.u), 1, 3);
      hit = reached as PlayResult['hit'];
      if (this.bunt && reached === 1) text = 'バントヒット';
      else if (reached === 1) text = this.firstFielder && OUTFIELD.has(this.firstFielder) ? `${fielder}前ヒット` : '内野安打';
      else text = ['', '', 'ツーベースヒット', 'スリーベースヒット', 'ランニングホームラン！'][reached];
    }
    return { outs: this.outs, runs: this.runs, bases, hit, text, foul: false };
  }

  /** テスト・表示用：ボールの現在位置のコピー。 */
  ballSnapshot(): BallState {
    return cloneBall(this.ball);
  }
}
