// 試合の進行。投球前 → 投球動作 → 投球 → インプレー → 結果表示 をくり返す。
// どのモードでも同じ流れを通り、違うのは「どちらのチームを人が操作するか」だけ。判定は rules.ts に任せる。

import { choosePitch, DEFAULT_STRATEGY, DIFFICULTY_ERROR, planSwing, type Difficulty, type Strategy } from './ai.ts';
import { batContact, EASY_TIMING_SCALE, evaluateSwing, STANCE_RANGE, SWING_DURATION, timingWindow, type BatContact, type SwingCommand, type SwingMode } from './batting.ts';
import { BASE_DISTANCE, parkOf, type Park } from './field.ts';
import { battingTeam, benchPitchers, createGameState, score, currentBatter, currentPitcher, EXTRA_INNINGS, fieldingTeam, type GameState, type Innings, type MatchMode, type TeamIndex } from './gameState.ts';
import { clamp } from './math.ts';
import { LEAD, NO_INPUT, PlaySim, runnerSpeed, stealMargin, type PlayInput } from './play.ts';
import { AIM_RANGE, createPitch, PITCH_TIME_SCALE, PITCHER_SHIFT_RANGE, DEFAULT_ZONE, fatigue, isStrike, WINDUP_TIME, type Pitch, type PitchCommand, type PlatePoint } from './pitching.ts';
import { Rng } from './rng.ts';
import { applyPlay, applySteal, pitchCall, substitute, substitutionError, type PitchCall, type Substitution } from './rules.ts';
import { roleOf, type Pitcher, type TeamData } from './teams.ts';
import { POSITION_LABEL, type PitchType } from './types.ts';

/** 手動モードの守備を人が操作するか、CPU に任せるか。 */
export type FieldingControl = 'manual' | 'auto';
/** 人が打つときの操作。標準はミートカーソル＋タイミング、かんたんはタイミングだけ。 */
export type BattingControl = 'standard' | 'easy';

export type Phase = 'pre-pitch' | 'windup' | 'pitch' | 'play' | 'result' | 'over';

export interface MatchConfig {
  away: TeamData;
  home: TeamData;
  innings?: number;
  /** 延長の回数。省略すると規定イニングに応じた回数（EXTRA_INNINGS）。 */
  extraInnings?: number;
  mode?: MatchMode;
  /** 人のチーム。手動モードで操作し、監督モードで方針を指示する。 */
  humanTeam?: TeamIndex;
  /** 手動モードの守備の操作（既定は手動）。 */
  fielding?: FieldingControl;
  /** 人が打つときの操作（既定は標準）。 */
  batting?: BattingControl;
  difficulty?: Difficulty;
  seed?: number;
}

export type MessageKind = 'call' | 'out' | 'hit' | 'run' | 'info';
export interface MatchMessage {
  text: string;
  kind: MessageKind;
}

const CURSOR_SPEED = 0.95;
/** 立ち位置を動かす速さ（m/秒）。 */
const SHIFT_SPEED = 0.6;
const START = { x: 0, y: (DEFAULT_ZONE.bottom + DEFAULT_ZONE.top) / 2 };
/** 判定の表示時間（秒）。自動モードでは短くする。 */
const RESULT_TIME = { call: 0.9, play: 1.8 };
/** 救援投手の力の目安（球速・制球・変化球）。 */
const power = (p: Pitcher) => (p.velocity - 130) * 2 + p.control + p.breaking;
/** CPU チームが投手を代える疲れ（fatigue）の目安。 */
const CPU_RELIEF_FATIGUE = 0.85;

export class Match {
  readonly state: GameState;
  /** 試合をする球場（ホームの球団の本拠地）。 */
  readonly park: Park;
  readonly humanTeam: TeamIndex;
  readonly difficulty: Difficulty;
  phase: Phase = 'pre-pitch';
  phaseTime = 0;
  /** 試合開始からの時間（ゲーム内の秒）。 */
  clock = 0;

  pitchCmd: PitchCommand | null = null;
  pitch: Pitch | null = null;
  pitchTime = 0;
  swing: SwingCommand | null = null;
  swingDone = false;
  lastSwingMissed = false;
  play: PlaySim | null = null;
  message: MatchMessage | null = null;

  /** 投手側のコースカーソルと球種、打者側のミートカーソルと打撃モード。 */
  aim: PlatePoint = { ...START };
  pitchType: PitchType = 'fastball';
  batCursor: PlatePoint = { ...START };
  swingMode: SwingMode = 'meet';
  buntStance = false;
  /** 投手のプレート上の位置と、打者の打席での立ち位置（m、一塁側が +）。投手・打者が代わるまで保つ。 */
  pitcherShift = 0;
  batterStance = 0;
  /** 盗塁のスタート（投球動作に入ってからの秒、まだなら null）と、走る走者の元の塁。 */
  stealStart: number | null = null;
  stealers: (1 | 2)[] = [];
  /** 直前の打球がバットのどこに当たったか（表示用）。 */
  lastContact: BatContact | null = null;
  private shiftOwner = { pitcher: '', batter: '' };

  /** 人のチームの方針（監督モード・自動モードで AI が使う）。CPU チームは通常。 */
  strategy: Strategy = { ...DEFAULT_STRATEGY };
  readonly cpuStrategy: Strategy = { ...DEFAULT_STRATEGY };

  /** 手動モードの守備の操作。変えると次の打球から反映される。 */
  fielding: FieldingControl;
  /** 人が打つときの操作。変えると次の投球から反映される。 */
  batting: BattingControl;

  /** 次の投球前に切り替えるモード。 */
  pendingMode: MatchMode | null = null;

  /** タイム（選手交代）の要求。次の投球前になったら画面側が交代画面を開いて false に戻す。 */
  timeoutRequested = false;
  /** 直近の選手交代の知らせ（clock は知らせた時刻）。 */
  notice: { text: string; clock: number } | null = null;

  private readonly rng: Rng;
  private aiDelay = 1;
  private resultTime = 0;

  constructor(c: MatchConfig) {
    const innings = c.innings ?? 3;
    const extra = c.extraInnings ?? EXTRA_INNINGS[innings as Innings] ?? 0;
    this.state = createGameState(c.away, c.home, innings, c.mode ?? 'manual', extra);
    this.park = parkOf(c.home.id);
    this.humanTeam = c.humanTeam ?? 1;
    this.difficulty = c.difficulty ?? 'normal';
    this.fielding = c.fielding ?? 'manual';
    this.batting = c.batting ?? 'standard';
    this.rng = new Rng(c.seed ?? Date.now() % 2 ** 31);
    this.enterPrePitch();
  }

  get mode(): MatchMode {
    return this.state.mode;
  }

  /**
   * モードを切り替える。投球前ならすぐ、投球が始まっていれば次の投球前に切り替わる。
   * 試合状態はモードに関係なく共通なので、切り替えても変わらない。
   */
  requestMode(mode: MatchMode) {
    if (this.phase === 'over') return;
    if (this.phase === 'pre-pitch' && !this.pitchCmd) {
      this.pendingMode = mode;
      this.enterPrePitch();
      return;
    }
    this.pendingMode = mode === this.state.mode ? null : mode;
  }

  /** 次に切り替わる予定のモード（予約がなければ今のモード）。 */
  get nextMode(): MatchMode {
    return this.pendingMode ?? this.state.mode;
  }

  /** 監督モードの方針（人のチームの AI が使う）。 */
  setStrategy(s: Partial<Strategy>) {
    this.strategy = { ...this.strategy, ...s };
  }

  /** 投球前で、まだ投球が始まっていない（選手交代ができる）。 */
  get canSubstitute(): boolean {
    return this.phase === 'pre-pitch' && !this.pitchCmd;
  }

  requestTimeout() {
    if (this.phase !== 'over') this.timeoutRequested = true;
  }

  /** 人のチームの選手交代。投球前だけ。できなければ理由を返す。 */
  substitute(sub: Substitution): string | null {
    if (!this.canSubstitute) return '投球前だけ交代できます';
    const error = substitutionError(this.state, this.humanTeam, sub);
    if (error) return error;
    this.applySubstitution(this.humanTeam, sub);
    this.enterPrePitch();
    return null;
  }

  private applySubstitution(team: TeamIndex, sub: Substitution) {
    const s = this.state;
    const t = s.teams[team];
    let text: string;
    if (sub.kind === 'pitcher') {
      text = `投手交代　${t.pitcher.name} → ${t.team.pitchers.find((p) => p.id === sub.playerId)!.name}`;
    } else {
      const out = t.lineup[sub.slot];
      const inName = t.team.batters.find((b) => b.id === sub.playerId)!.name;
      const batting = battingTeam(s) === team;
      const label =
        batting && t.battingIndex === sub.slot ? '代打' : batting && s.bases.includes(out.id) ? '代走' : `${POSITION_LABEL[t.positions[sub.slot]]}の交代`;
      text = `${label}　${out.name} → ${inName}`;
    }
    substitute(s, team, sub);
    this.notice = { text, clock: this.clock };
  }

  /** CPU チーム（自動モードでは人のチームも）は、打席の合間に疲れた投手を代える。 */
  private cpuRelief() {
    const s = this.state;
    const team = fieldingTeam(s);
    // 人のチームは自分で代える。自動モードは見ているだけなので AI が代える。
    if (s.over || (team === this.humanTeam && s.mode !== 'auto') || s.balls || s.strikes) return;
    const t = s.teams[team];
    const bench = benchPitchers(t);
    if (!bench.length) return;
    // 最終回に1〜3点リードしていれば、回の頭から抑えを出す。
    const lead = score(s, team) - score(s, (1 - team) as TeamIndex);
    const closer = bench.find((p) => roleOf(p) === 'closer');
    if (closer && roleOf(t.pitcher) !== 'closer' && s.inning >= s.innings && lead >= 1 && lead <= 3 && s.outs === 0 && !s.bases.some((b) => b)) {
      this.applySubstitution(team, { kind: 'pitcher', playerId: closer.id });
      return;
    }
    if (fatigue(t.pitcher, t.pitchCount) < CPU_RELIEF_FATIGUE) return;
    // 疲れたら中継ぎから、力のある投手を出す。中継ぎがいなければ抑え、最後に先発。
    const pick = (role: string) => bench.filter((p) => roleOf(p) === role);
    const pool = [pick('reliever'), pick('closer'), bench].find((x) => x.length)!;
    const next = pool.reduce((a, b) => (power(b) > power(a) ? b : a));
    this.applySubstitution(team, { kind: 'pitcher', playerId: next.id });
  }

  /** 自動モードで、試合終了まで一気に進める。 */
  skipToEnd(maxSeconds = 4 * 3600) {
    if (this.state.mode !== 'auto') this.requestMode('auto');
    this.timeoutRequested = false;
    const dt = 1 / 30;
    for (let t = 0; t < maxSeconds && this.phase !== 'over'; t += dt) this.tick(dt);
  }

  /** そのチームを人が直接操作しているか（手動モードの人のチーム）。 */
  isHuman(team: TeamIndex): boolean {
    return this.state.mode === 'manual' && team === this.humanTeam;
  }

  get humanPitching() {
    return this.isHuman(fieldingTeam(this.state));
  }

  get humanBatting() {
    return this.isHuman(battingTeam(this.state));
  }

  /** 打球が飛んだあと、守備の選手を人が操作するか（守備オートなら CPU に任せる）。 */
  get humanFielding() {
    return this.humanPitching && this.fielding === 'manual';
  }

  /** 人がかんたん打撃で打っているか。 */
  get easyBatting() {
    return this.humanBatting && this.batting === 'easy';
  }

  /** 人のスイング。かんたん打撃では上下の入力で打球の狙いを決める。 */
  private humanSwing(time: number, input: PlayInput, bunt = false): SwingCommand {
    const sw: SwingCommand = { mode: this.swingMode, cursor: this.batCursor, time, stance: this.batterStance, ...(bunt ? { bunt } : {}) };
    if (this.easyBatting) sw.easy = { lift: Math.abs(input.move.y) > 0.5 ? Math.sign(input.move.y) : 0 };
    return sw;
  }

  strategyOf(team: TeamIndex): Strategy {
    return team === this.humanTeam ? this.strategy : this.cpuStrategy;
  }

  private errorScaleOf(team: TeamIndex) {
    return team === this.humanTeam ? 1 : DIFFICULTY_ERROR[this.difficulty];
  }

  private setPhase(p: Phase) {
    this.phase = p;
    this.phaseTime = 0;
  }

  protected enterPrePitch() {
    if (this.pendingMode) {
      this.state.mode = this.pendingMode;
      this.pendingMode = null;
    }
    this.cpuRelief();
    this.setPhase(this.state.over ? 'over' : 'pre-pitch');
    this.pitch = null;
    this.pitchCmd = null;
    this.swing = null;
    this.swingDone = false;
    this.play = null;
    this.aim = { ...START };
    this.pitchType = 'fastball';
    this.batCursor = { ...START };
    this.buntStance = false;
    this.lastContact = null;
    this.stealStart = null;
    this.stealers = [];
    if (!this.humanBatting) this.swingMode = 'meet';
    // 投手・打者が代わったら、立ち位置を標準に戻す。
    if (!this.state.over) {
      const pid = currentPitcher(this.state).id;
      const bid = currentBatter(this.state).id + ':' + this.state.log.length;
      if (pid !== this.shiftOwner.pitcher) this.pitcherShift = 0;
      if (bid !== this.shiftOwner.batter) this.batterStance = 0;
      this.shiftOwner = { pitcher: pid, batter: bid };
    }
    this.aiDelay = this.state.mode === 'auto' ? 0.45 : 1.0;
  }

  private moveCursor(c: PlatePoint, input: PlayInput, dt: number) {
    c.x = clamp(c.x + input.move.x * CURSOR_SPEED * dt, -AIM_RANGE.x, AIM_RANGE.x);
    c.y = clamp(c.y + input.move.y * CURSOR_SPEED * dt, AIM_RANGE.yMin, AIM_RANGE.yMax);
  }

  /** dt 秒進める。input は人の操作（人が操作していない場面では無視される）。 */
  tick(dt: number, input: PlayInput = NO_INPUT) {
    if (this.phase === 'over') return;
    this.clock += dt;
    this.phaseTime += dt;
    const human = this.humanPitching || this.humanBatting;
    const inp = human ? input : NO_INPUT;
    switch (this.phase) {
      case 'pre-pitch':
        this.updatePrePitch(dt, inp);
        break;
      case 'windup':
        this.updateBatterInput(dt, inp);
        if (this.phaseTime >= WINDUP_TIME) this.release();
        break;
      case 'pitch':
        this.updatePitch(dt, inp);
        break;
      case 'play':
        this.updatePlay(dt, input);
        break;
      case 'result':
        this.resultTime -= dt;
        if (this.resultTime <= 0) this.enterPrePitch();
        break;
    }
  }

  private updateBatterInput(dt: number, input: PlayInput) {
    if (!this.humanBatting || this.swing) return;
    if (!this.easyBatting) this.moveCursor(this.batCursor, input, dt);
    this.batterStance = clamp(this.batterStance + (input.shift ?? 0) * SHIFT_SPEED * dt, -STANCE_RANGE, STANCE_RANGE);
    if (input.switch && this.phase !== 'pitch') this.swingMode = this.swingMode === 'meet' ? 'power' : 'meet';
    if (input.secondary) this.buntStance = !this.buntStance;
    if (input.steal && this.phase !== 'pitch') this.orderSteal();
  }

  /** 盗塁できる走者（元の塁）。先の塁が空いているか、その塁の走者も走るとき。本盗はしない。 */
  stealCandidates(): (1 | 2)[] {
    const b = this.state.bases;
    const out: (1 | 2)[] = [];
    if (b[2] && !b[3]) out.push(2);
    if (b[1] && (!b[2] || out.includes(2))) out.push(1);
    return out;
  }

  /** 盗塁のサイン。投球前に出せば投球動作と同時に、投球動作中なら押した時点でスタートする。投球前ならもう一度で取り消し。 */
  private orderSteal() {
    if (this.stealers.length) {
      if (this.phase === 'pre-pitch') this.stealers = [];
      return;
    }
    this.stealers = this.stealCandidates();
    this.stealStart = this.stealers.length && this.phase === 'windup' ? this.phaseTime : null;
  }

  /** 盗塁中の走者の位置（塁間の割合 u）。走っていなければ null。 */
  stealPosition(from: 1 | 2): number | null {
    if (!this.stealers.includes(from) || (this.phase !== 'windup' && this.phase !== 'pitch')) return null;
    const start = this.stealStart ?? 0;
    const t = (this.phase === 'windup' ? this.phaseTime : WINDUP_TIME + this.pitchTime) - start;
    if (t < 0) return null;
    const id = this.state.bases[from]!;
    const speed = runnerSpeed(this.state.teams[battingTeam(this.state)].team.batters.find((b) => b.id === id)!.speed);
    const lead = from === 2 ? LEAD * 1.6 : LEAD;
    // 画面の投球はゆっくり進めているので、走者もそれに合わせて進める（打ったときの位置にも使う）。
    return from + Math.min(0.92, lead + (t * PITCH_TIME_SCALE * speed) / BASE_DISTANCE);
  }

  /** 見送り・空振りで盗塁を判定する。捕手は先の走者に投げ、後ろの走者はセーフ。 */
  private resolveSteal(): string {
    const s = this.state;
    const team = s.teams[fieldingTeam(s)];
    const catcher = team.lineup[team.positions.indexOf('C')];
    const lead = Math.max(...this.stealers) as 1 | 2;
    const id = s.bases[lead]!;
    const runner = s.teams[battingTeam(s)].team.batters.find((b) => b.id === id)!;
    const jump = this.stealStart === null ? 0 : this.stealStart * 0.6;
    const margin = stealMargin({ speed: runner.speed, catcherArm: catcher.arm, from: lead, breaking: this.pitch?.type !== 'fastball', jump }) + this.rng.gauss(0, 0.18);
    const safe = margin > 0;
    applySteal(
      s,
      this.stealers.map((from) => ({ from, safe: from !== lead || safe }))
    );
    const what = this.stealers.length > 1 ? 'ダブルスチール' : lead === 2 ? '三盗' : '二盗';
    return safe ? `${what}成功！` : `${what}失敗（${runner.name}）`;
  }

  private updatePrePitch(dt: number, input: PlayInput) {
    this.updateBatterInput(dt, this.humanBatting ? input : NO_INPUT);
    const pitcher = currentPitcher(this.state);
    if (this.humanPitching) {
      this.moveCursor(this.aim, input, dt);
      this.pitcherShift = clamp(this.pitcherShift + (input.shift ?? 0) * SHIFT_SPEED * dt, -PITCHER_SHIFT_RANGE, PITCHER_SHIFT_RANGE);
      if (input.switch) {
        const list = pitcher.pitches;
        this.pitchType = list[(list.indexOf(this.pitchType) + 1) % list.length];
      }
      if (input.primary) this.startWindup({ type: this.pitchType, target: { ...this.aim }, shift: this.pitcherShift });
      return;
    }
    if (this.phaseTime >= this.aiDelay) {
      const s = this.state;
      const cmd = choosePitch(pitcher, s, this.strategyOf(fieldingTeam(s)).pitching, this.rng);
      this.pitchType = cmd.type;
      this.aim = { ...cmd.target };
      this.startWindup({ ...cmd, shift: this.pitcherShift });
    }
  }

  private startWindup(cmd: PitchCommand) {
    this.pitchCmd = cmd;
    this.setPhase('windup');
  }

  private release() {
    const s = this.state;
    const pitcher = currentPitcher(s);
    const team = s.teams[fieldingTeam(s)];
    this.pitch = createPitch(pitcher, this.pitchCmd!, fatigue(pitcher, team.pitchCount), this.rng);
    this.pitchTime = 0;
    this.setPhase('pitch');
    if (!this.humanBatting) {
      const bt = battingTeam(s);
      this.swing = planSwing(
        currentBatter(s),
        this.pitch,
        {
          balls: s.balls,
          strikes: s.strikes,
          outs: s.outs,
          runnerOnFirst: !!s.bases[1],
          runnerOnSecond: !!s.bases[2],
          pitcherVelocity: pitcher.velocity
        },
        this.strategyOf(bt).offense,
        this.errorScaleOf(bt),
        this.rng
      );
      if (this.swing) {
        this.swing.stance = this.batterStance;
        this.swingMode = this.swing.mode;
        this.buntStance = !!this.swing.bunt;
        this.batCursor = { ...this.swing.cursor };
      }
    } else if (this.buntStance) {
      this.swing = this.humanSwing(0, NO_INPUT, true);
    }
  }

  /** CPU のスイングが始まったか（表示用）。 */
  swingStarted(): boolean {
    return !!this.swing && !this.swing.bunt && this.pitchTime >= this.swing.time;
  }

  private updatePitch(dt: number, input: PlayInput) {
    const pitch = this.pitch!;
    this.pitchTime += dt;
    if (this.humanBatting && !this.swing) {
      if (!this.easyBatting) this.moveCursor(this.batCursor, input, dt);
      if (input.primary) this.swing = this.humanSwing(this.pitchTime, input);
    }
    const sw = this.swing;
    if (sw) {
      // 早いスイングは球が来た時点、遅いスイングはバットが本塁上に来た時点で判定する。
      const evalAt = sw.bunt ? pitch.flightTime : Math.max(pitch.flightTime, sw.time + SWING_DURATION);
      if (this.pitchTime >= evalAt) this.resolveSwing(sw);
      return;
    }
    // 見送り：遅れたスイングも受け付けるため、少し待ってから判定する。
    if (this.pitchTime >= pitch.flightTime + timingWindow(currentBatter(this.state), 'meet') * (this.easyBatting ? EASY_TIMING_SCALE : 1)) {
      this.callPitch(isStrike(DEFAULT_ZONE, pitch.plate) ? 'called-strike' : 'ball');
    }
  }

  private resolveSwing(sw: SwingCommand) {
    const s = this.state;
    const out = evaluateSwing(currentBatter(s), this.pitch!, { ...sw, cursor: { ...sw.cursor } }, this.rng);
    this.swingDone = true;
    if (out.kind === 'miss') {
      this.lastSwingMissed = true;
      this.callPitch('swinging-strike');
      return;
    }
    this.lastSwingMissed = false;
    if (!sw.bunt) this.lastContact = batContact(out.spot);
    const bt = battingTeam(s);
    this.play = new PlaySim({
      state: s,
      batter: currentBatter(s),
      fielding: s.teams[fieldingTeam(s)],
      origin: out.origin,
      velocity: out.velocity,
      launch: out.launch,
      bunt: !!sw.bunt,
      running: this.strategyOf(bt).running,
      stealing: Object.fromEntries(this.stealers.map((b) => [b, this.stealPosition(b) ?? b + LEAD])),
      humanDefense: this.humanFielding,
      humanOffense: this.isHuman(bt),
      rng: this.rng,
      park: this.park
    });
    this.setPhase('play');
  }

  private callPitch(call: PitchCall) {
    const s = this.state;
    const half = `${s.inning}${s.half}`;
    const end = pitchCall(s, call);
    const text =
      end === 'strikeout' ? '三振！' : end === 'walk' ? 'フォアボール' : call === 'ball' ? 'ボール' : call === 'swinging-strike' ? '空振り' : 'ストライク';
    const runs = s.log.at(-1)?.runs ?? 0;
    // 盗塁：四球なら走者は押し出されるだけ、3アウトでチェンジなら判定しない。
    const steal = this.stealers.length && end !== 'walk' && !s.over && `${s.inning}${s.half}` === half ? this.resolveSteal() : '';
    const main = end === 'walk' && runs ? '押し出し！' : text;
    const kind = end === 'strikeout' ? 'out' : end === 'walk' ? 'hit' : 'call';
    this.showResult({ text: steal ? `${main}　${steal}` : main, kind: steal ? (steal.includes('成功') ? 'hit' : 'out') : kind }, steal ? RESULT_TIME.play : RESULT_TIME.call);
  }

  private updatePlay(dt: number, input: PlayInput) {
    const play = this.play!;
    play.tick(dt, input);
    if (!play.done) return;
    const r = play.result();
    if (r.foul) {
      pitchCall(this.state, this.swing?.bunt ? 'foul-bunt' : 'foul');
      this.showResult({ text: 'ファウル', kind: 'call' }, RESULT_TIME.call);
      return;
    }
    const before = this.state.outs;
    applyPlay(this.state, r);
    const runs = this.state.log.at(-1)?.runs ?? 0;
    const kind = runs ? 'run' : r.hit ? 'hit' : r.error ? 'info' : 'out';
    const extra = runs ? `　${runs}点！` : r.outs.length && before + r.outs.length >= 3 ? '　チェンジ' : '';
    this.showResult({ text: r.text + extra, kind }, RESULT_TIME.play);
  }

  private showResult(m: MatchMessage, time: number) {
    this.message = m;
    this.resultTime = this.state.mode === 'auto' ? time * 0.6 : time;
    this.setPhase('result');
  }
}
