// 試合の進行。投球前 → 投球動作 → 投球 → インプレー → 結果表示 をくり返す。
// 合間に、リプレイ（本塁打・ダイビングキャッチ）、攻守交代、投手交代、投球練習の場面をはさむ。
// どのモードでも同じ流れを通り、違うのは「どちらのチームを人が操作するか」だけ。判定は rules.ts に任せる。

import { choosePitch, decideSteal, DEFAULT_STRATEGY, DIFFICULTY_ERROR, DIFFICULTY_HEART, planSwing, type Difficulty, type Strategy } from './ai.ts';
import { batContact, EASY_TIMING_SCALE, evaluateSwing, STANCE_RANGE, SWING_DURATION, timingWindow, type BatContact, type SwingCommand, type SwingMode } from './batting.ts';
import { Brawl } from './brawl.ts';
import { BASE_DISTANCE, batterBox, bullpenGate, DEFAULT_FIELD_POSITIONS, dugoutPos, parkOf, type Park } from './field.ts';
import { battingTeam, benchPitchers, createGameState, score, currentBatter, currentPitcher, EXTRA_INNINGS, fieldingTeam, type GameState, type Innings, type MatchMode, type TeamIndex } from './gameState.ts';
import { HomeRunTrot } from './homerunTrot.ts';
import { clamp } from './math.ts';
import { LEAD, NO_INPUT, PlaySim, runnerSpeed, stealMargin, type PlayInput } from './play.ts';
import { AIM_RANGE, createPitch, hitsBatter, PITCH_AIM_RANGE, PITCH_TIME_SCALE, PITCHER_SHIFT_RANGE, DEFAULT_ZONE, fatigue, isStrike, pitchLimit, WINDUP_TIME, type Pitch, type PitchCommand, type PlatePoint } from './pitching.ts';
import { PitchingChange } from './relief.ts';
import { Rng } from './rng.ts';
import { FRAGILITY, injuryChance } from './registration.ts';
import { applyPlay, applySteal, pitchCall, substitute, substitutionError, type PitchCall, type Substitution } from './rules.ts';
import { hookOf, roleOf, type Pitcher, type PitchingHook, type TeamData } from './teams.ts';
import { POSITION_LABEL, type PitchType } from './types.ts';
import { Warmup } from './warmup.ts';

/** 手動モードの守備を人が操作するか、CPU に任せるか。 */
export type FieldingControl = 'manual' | 'auto';
/** 人が打つときの操作。標準はミートカーソル＋タイミング、かんたんはタイミングだけ。 */
export type BattingControl = 'standard' | 'easy';
/** 手動モードで人が攻撃するとき、指示していない走者を CPU が判断して走らせるか。手動ならフォースと帰塁だけ自動。 */
export type RunningControl = 'manual' | 'auto';

export type Phase = 'pre-pitch' | 'windup' | 'pitch' | 'play' | 'result' | 'replay' | 'change' | 'relief' | 'warmup' | 'over';

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
  /** 手動モードの走塁（既定はオート）。 */
  running?: RunningControl;
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
/** 攻守交代の場面の長さ（秒）。守っていたチームがベンチへ戻り、次に守るチームが守備位置へ散る。自動モードでは短くする。 */
const CHANGE_TIME = 3.2;
/** ラッキーセブン（9回の試合の7回の攻撃の前）で、ジェット風船を飛ばすぶん攻守交代の場面を延ばす（秒）。 */
const LUCKY_SEVEN_TIME = 3.5;
/** 自動モードで、合間の場面（交代・投球練習）を早回しにする速さ。 */
const AUTO_SCENE_RATE = 1 / 0.6;
/** リプレイ：打球の最後の何秒までを、何倍の速さで見せるか。 */
const REPLAY_MAX = 6;
const REPLAY_SPEED = 0.7;
/** CPU の投手が、投球前の場面になってから投げるまでの間合い（秒）。自動モードは見ているだけなので短め。 */
const AI_PITCH_DELAY = { normal: 2.0, auto: 0.8 };
/** 救援投手の力の目安（球速・制球・変化球）。 */
const power = (p: Pitcher) => (p.velocity - 130) * 2 + p.control + p.breaking;
/** CPU の中継ぎ・抑えが、回の頭で交代するまでに投げる球数の目安（1イニング投げていなくても）。 */
const RELIEVER_PITCHES = 22;
/** CPU チームが投手を代える疲れ（fatigue）の目安。監督の継投の早さで変わる。 */
const CPU_RELIEF_FATIGUE: Record<PitchingHook, number> = { quick: 0.8, normal: 0.85, patient: 0.92 };
/**
 * CPU チームが打ち込まれた投手を代える失点の目安（プロ野球の継投を参考に）。
 * 先発は1イニング4失点か、試合で5失点（4点以上リードしていれば7失点）でノックアウト。
 * 終盤の接戦なら3失点でも、その回に点を取られて得点圏に走者がいれば継投する。
 * 中継ぎ・抑えは3失点か、2失点でリードを失って走者がいれば代える。
 * 早めの監督は失点の目安が1点少なく、我慢の監督は1点多い（HOOK_SHIFT）。
 */
const KNOCKOUT = { inning: 4, starter: 5, starterAhead: 7, late: 3, reliever: 3, blown: 2 };
const HOOK_SHIFT: Record<PitchingHook, number> = { quick: -1, normal: 0, patient: 1 };
/**
 * 先発が好投している（失点が runs 以下）あいだは、完投・完封を狙って引っぱる。
 * 疲れでは代えず、投げられる球数の目安（pitchLimit）を extra 球超えるまで続投し、最終回も抑えに代えない。
 * 打たれて失点が増えれば好投ではなくなり、ふだんの目安で代わる。ノーヒットなら NO_HITTER_EXTRA 球さらに粘る。
 */
const GOOD_OUTING: Record<PitchingHook, { runs: number; extra: number }> = {
  quick: { runs: 0, extra: 5 },
  normal: { runs: 1, extra: 10 },
  patient: { runs: 2, extra: 20 }
};
const NO_HITTER_EXTRA = 15;
/** 好投中の先発でも、最終回の頭にこれより疲れていれば抑えに代える。 */
const GOOD_OUTING_CLOSER_FATIGUE = 0.8;
/** 回の頭では、疲れの目安よりこれだけ手前で代える（次の回を投げきれそうにない先発）。 */
const INNING_START_MARGIN = 0.05;
/** 投げられる球数の目安（pitchLimit）をこれだけ超えたら、回の途中でも代える。 */
const EXHAUSTED_EXTRA = 12;
/** 勝ちパターンの中継ぎ（セットアッパー）の人数。 */
const SETUP_COUNT = 2;
/** 勝ちパターンの中継ぎ：中継ぎのうち力のある順に SETUP_COUNT 人。 */
export const setupMen = (t: TeamData): Pitcher[] => t.pitchers.filter((p) => roleOf(p) === 'reliever').sort((a, b) => power(b) - power(a)).slice(0, SETUP_COUNT);
/** 投手が打者1人ごとに負傷で降板する確率（故障しやすさ 30 の投手。9回の試合でおよそ200試合に1度）。 */
const INJURY_PER_BATTER = 0.00015;

/**
 * 試合の途中経過（投球前の場面だけで取る）。端末に保存して、開き直しても続きから遊べるようにする。
 * JSON にできる値だけを持つ。
 */
export interface MatchSnapshot {
  state: GameState;
  rng: number;
  clock: number;
  humanTeam: TeamIndex;
  difficulty: Difficulty;
  fielding: FieldingControl;
  batting: BattingControl;
  running: RunningControl;
  strategy: Strategy;
  cpuStrategy: Strategy;
  swingMode: SwingMode;
  pitcherShift: number;
  batterStance: number;
  shiftOwner: { pitcher: string; batter: string };
  inningStart: { key: string; pitcherId: string; runs: number };
}

export class Match {
  readonly state: GameState;
  /** 試合をする球場（ホームの球団の本拠地）。 */
  readonly park: Park;
  readonly humanTeam: TeamIndex;
  readonly difficulty: Difficulty;
  phase: Phase = 'pre-pitch';
  phaseTime = 0;
  /** 本塁打の後、打者と走者がダイヤモンドを回る場面（結果を出しているあいだだけ）。時刻は phaseTime。J でとばせる。 */
  trot: HomeRunTrot | null = null;
  /** 死球の後の乱闘の場面（結果を出しているあいだだけ）。時刻は phaseTime。J でとばせる。 */
  brawl: Brawl | null = null;
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
  /** 攻守交代の場面の長さ（秒。phase が 'change' のあいだの時刻は phaseTime）。 */
  changeDuration = CHANGE_TIME;
  /** 今の投球前の場面が何回の表か裏か。結果のあとで変わっていれば攻守交代の場面をはさむ。 */
  private halfKey = '';
  /** ラッキーセブンの攻守交代の場面なら、ジェット風船を飛ばすチーム（次に攻撃するチーム）。 */
  luckySeven: TeamIndex | null = null;
  /** 投手交代の場面（phase が 'relief' のあいだ）と、投球練習の場面（'warmup' のあいだ）。時刻は phaseTime。 */
  relief: PitchingChange | null = null;
  warmup: Warmup | null = null;
  /** 投手が代わったので、次の投球前に投手交代の場面をはさむ。 */
  private reliefPending = false;
  /**
   * リプレイ（phase が 'replay' のあいだ）：直前の打球の from 秒から to 秒までを speed 倍で見せる。記録と再生は画面側（render/view.ts）。
   * 本塁打とダイビングキャッチのあと、結果を出し終えてから見せる。自動モードでは見せない。
   */
  replay: { from: number; to: number; speed: number } | null = null;
  private replayPending: { from: number; to: number } | null = null;
  /** 球審のコール（ストライク・三振）。clock はコールした時刻。表示だけ。 */
  umpireCall: { kind: 'strike' | 'strikeout'; clock: number } | null = null;

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
  /** 手動モードの走塁。変えると次の打球から反映される。 */
  running: RunningControl;

  /** 次の投球前に切り替えるモード。 */
  pendingMode: MatchMode | null = null;

  /** タイム（選手交代）の要求。次の投球前になったら画面側が交代画面を開いて false に戻す。 */
  timeoutRequested = false;
  /** 直近の選手交代の知らせ（clock は知らせた時刻）。 */
  notice: { text: string; clock: number } | null = null;

  private readonly rng: Rng;
  private aiDelay = 1;
  private resultTime = 0;
  /** いまの投手が、この回に入ったとき（回の途中で出てきたときは登板したとき）までの失点。 */
  private inningStart = { key: '', pitcherId: '', runs: 0 };

  constructor(c: MatchConfig) {
    const innings = c.innings ?? 3;
    const extra = c.extraInnings ?? EXTRA_INNINGS[innings as Innings] ?? 0;
    this.state = createGameState(c.away, c.home, innings, c.mode ?? 'manual', extra);
    this.park = parkOf(c.home.id);
    this.humanTeam = c.humanTeam ?? 1;
    this.difficulty = c.difficulty ?? 'normal';
    this.fielding = c.fielding ?? 'manual';
    this.batting = c.batting ?? 'standard';
    this.running = c.running ?? 'auto';
    this.rng = new Rng(c.seed ?? Date.now() % 2 ** 31);
    this.enterPrePitch();
  }

  /** いまの途中経過。投球前の場面（投手交代の場面を待っていない）でなければ null。 */
  snapshot(): MatchSnapshot | null {
    if (this.phase !== 'pre-pitch' || this.reliefPending || this.pendingMode) return null;
    return structuredClone({
      state: this.state,
      rng: this.rng.state,
      clock: this.clock,
      humanTeam: this.humanTeam,
      difficulty: this.difficulty,
      fielding: this.fielding,
      batting: this.batting,
      running: this.running,
      strategy: this.strategy,
      cpuStrategy: this.cpuStrategy,
      swingMode: this.swingMode,
      pitcherShift: this.pitcherShift,
      batterStance: this.batterStance,
      shiftOwner: this.shiftOwner,
      inningStart: this.inningStart
    });
  }

  /** 途中経過から試合を作り直す。打順・投手は球団の選手と同じもの（同じ参照）に戻す。 */
  static restore(snap: MatchSnapshot): Match {
    const s = structuredClone(snap.state);
    for (const t of s.teams) {
      t.lineup = t.lineup.map((b) => t.team.batters.find((x) => x.id === b.id) ?? b);
      t.pitcher = t.team.pitchers.find((p) => p.id === t.pitcher.id) ?? t.pitcher;
    }
    const m = new Match({ away: s.teams[0].team, home: s.teams[1].team, innings: s.innings, extraInnings: s.extraInnings, mode: s.mode, humanTeam: snap.humanTeam, difficulty: snap.difficulty, fielding: snap.fielding, batting: snap.batting, running: snap.running, seed: 1 });
    Object.assign(m.state, s);
    m.rng.state = snap.rng;
    m.clock = snap.clock;
    m.strategy = snap.strategy;
    Object.assign(m.cpuStrategy, snap.cpuStrategy);
    m.swingMode = snap.swingMode;
    m.pitcherShift = snap.pitcherShift;
    m.batterStance = snap.batterStance;
    m.shiftOwner = snap.shiftOwner;
    m.inningStart = snap.inningStart;
    m.enterPrePitch(false);
    return m;
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
    if (sub.kind === 'pitcher') this.reliefPending = true;
    this.enterPrePitch();
    return null;
  }

  private applySubstitution(team: TeamIndex, sub: Substitution, reason?: string) {
    const s = this.state;
    const t = s.teams[team];
    let text: string;
    if (sub.kind === 'pitcher') {
      text = `${reason ?? '投手交代'}　${t.pitcher.name} → ${t.team.pitchers.find((p) => p.id === sub.playerId)!.name}`;
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

  /** CPU チーム（自動モードでは人のチームも）は、打席の合間に疲れた投手・打ち込まれた投手・負傷した投手を代える。 */
  private cpuRelief() {
    const s = this.state;
    const team = fieldingTeam(s);
    // 人のチームは自分で代える。自動モードは見ているだけなので AI が代える。
    if (s.over || (team === this.humanTeam && s.mode !== 'auto') || s.balls || s.strikes) return;
    const t = s.teams[team];
    const bench = benchPitchers(t);
    if (!bench.length) return;
    const pick = (role: string) => bench.filter((p) => roleOf(p) === role);
    const lead = score(s, team) - score(s, (1 - team) as TeamIndex);
    const late = s.inning >= s.innings - 2;
    // 勝ちパターン（リードか同点の終盤）なら力のある中継ぎ（セットアッパー）、それ以外は残りの中継ぎ（負けパターン）から出す。
    const setup = new Set(setupMen(t.team).map((p) => p.id));
    const winning = late && lead >= 0 && lead <= 3;
    const pattern = (pool: Pitcher[]) => {
      const [main, rest] = [pool.filter((p) => setup.has(p.id) === winning), pool.filter((p) => setup.has(p.id) !== winning)];
      return main.length ? main : rest;
    };
    // 代わりは中継ぎから。中継ぎがいなければ抑え、最後に先発。
    const relieve = (reason?: string) => {
      const pool = [pattern(pick('reliever')), pick('closer'), bench].find((x) => x.length)!;
      this.applySubstitution(team, { kind: 'pitcher', playerId: this.pickReliever(pool).id }, reason);
    };
    // ごくまれに、投手が負傷して降板する。故障しやすい投手、疲れた投手ほど起きやすい。
    const fragile = injuryChance(t.pitcher) / FRAGILITY.perDay;
    if (this.rng.chance(INJURY_PER_BATTER * fragile * (1 + fatigue(t.pitcher, t.pitchCount)))) {
      relieve('負傷降板');
      return;
    }
    const hook = hookOf(t.team);
    const line = s.pitching[t.pitcher.id];
    const tired = fatigue(t.pitcher, t.pitchCount);
    const starter = roleOf(t.pitcher) === 'starter';
    const good = starter && (line?.r ?? 0) <= GOOD_OUTING[hook].runs;
    // 継投は基本、回の頭（無死・走者なし）で。回の途中で代えるのは、打ち込まれたときと勝負どころ（終盤の接戦で得点圏に走者）、投げきれないほど疲れたときだけ。
    const fresh = s.outs === 0 && !s.bases.some((b) => b);
    const crunch = late && Math.abs(lead) <= 2 && !!(s.bases[2] || s.bases[3]);
    // 最終回に1〜3点リードしていれば、回の頭から抑えを出す（好投中でまだ余力のある先発は続投）。
    const closer = bench.find((p) => roleOf(p) === 'closer');
    const keepStarter = good && tired < GOOD_OUTING_CLOSER_FATIGUE;
    if (closer && roleOf(t.pitcher) !== 'closer' && !keepStarter && s.inning >= s.innings && lead >= 1 && lead <= 3 && fresh) {
      this.applySubstitution(team, { kind: 'pitcher', playerId: closer.id });
      return;
    }
    // 中継ぎ・抑えは基本1イニング：回の頭で、もう1イニング投げていれば次の中継ぎに代える。
    const done = (line?.outs ?? 0) >= 3 || t.pitchCount >= RELIEVER_PITCHES;
    if (!starter && done && fresh && pick('reliever').length) {
      this.applySubstitution(team, { kind: 'pitcher', playerId: this.pickReliever(pattern(pick('reliever'))).id });
      return;
    }
    if (this.knockedOut(lead, HOOK_SHIFT[hook])) {
      relieve();
      return;
    }
    if (good) {
      const extra = GOOD_OUTING[hook].extra + (line?.h ? 0 : NO_HITTER_EXTRA);
      if (t.pitchCount >= pitchLimit(t.pitcher) + extra && (fresh || crunch || t.pitchCount >= pitchLimit(t.pitcher) + extra + EXHAUSTED_EXTRA)) relieve();
      return;
    }
    // 疲れた先発は回の頭で代える。回の途中は勝負どころか、限界を超えて投げているときだけ。
    const limit = CPU_RELIEF_FATIGUE[hook];
    if ((fresh && tired >= limit - INNING_START_MARGIN) || (crunch && tired >= limit) || t.pitchCount >= pitchLimit(t.pitcher) + EXHAUSTED_EXTRA) relieve();
  }

  /** いまの投手が打ち込まれていて、代えどきか（プロ野球の継投を参考にした KNOCKOUT の目安に、監督の継投の早さ shift を足す）。 */
  private knockedOut(lead: number, shift: number): boolean {
    const s = this.state;
    const p = s.teams[fieldingTeam(s)].pitcher;
    const runs = s.pitching[p.id]?.r ?? 0;
    const key = `${s.inning}${s.half}`;
    if (this.inningStart.key !== key || this.inningStart.pitcherId !== p.id) this.inningStart = { key, pitcherId: p.id, runs };
    const inningRuns = runs - this.inningStart.runs;
    const runners = s.bases.some((b) => b);
    if (roleOf(p) !== 'starter') return runs >= KNOCKOUT.reliever + shift || (runs >= KNOCKOUT.blown && lead <= 0 && runners);
    if (inningRuns >= KNOCKOUT.inning + shift || runs >= (lead >= 4 ? KNOCKOUT.starterAhead : KNOCKOUT.starter) + shift) return true;
    // 終盤（9回なら7回から）の接戦で、この回に点を取られて得点圏に走者を背負った。
    const late = s.inning >= Math.ceil(s.innings * 0.7);
    return late && Math.abs(lead) <= 2 && runs >= KNOCKOUT.late + shift && inningRuns >= 1 && !!(s.bases[2] || s.bases[3]);
  }

  /** 次に出す投手。毎試合同じ投手ばかりにならないよう、力のある順に重みを付けて選ぶ（いちばん上が出やすい）。 */
  private pickReliever(pool: Pitcher[]): Pitcher {
    const ranked = [...pool].sort((a, b) => power(b) - power(a));
    return this.rng.weighted(ranked.map((p, i) => ({ value: p, weight: 1 / (i + 1.5) })));
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

  /** 人と対戦する CPU チームか（自動モードは CPU 同士なので、難易度をかけずに五分にする）。 */
  private isOpponentCpu(team: TeamIndex) {
    return team !== this.humanTeam && this.state.mode !== 'auto';
  }

  private errorScaleOf(team: TeamIndex) {
    return this.isOpponentCpu(team) ? DIFFICULTY_ERROR[this.difficulty] : 1;
  }

  private setPhase(p: Phase) {
    this.phase = p;
    this.phaseTime = 0;
  }

  /** 投球前の場面へ。relief なら CPU の継投を決める（投球練習のあとは、継投を決めてから練習したので決め直さない）。 */
  protected enterPrePitch(relief = true) {
    if (this.pendingMode) {
      this.state.mode = this.pendingMode;
      this.pendingMode = null;
    }
    if (relief && this.changesPitcher()) this.reliefPending = true;
    this.setPhase(this.state.over ? 'over' : 'pre-pitch');
    this.relief = null;
    this.warmup = null;
    this.replay = null;
    this.pitch = null;
    this.pitchCmd = null;
    this.swing = null;
    this.swingDone = false;
    this.play = null;
    this.trot = null;
    this.brawl = null;
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
      this.halfKey = `${this.state.inning}${this.state.half}`;
    }
    this.aiDelay = this.state.mode === 'auto' ? AI_PITCH_DELAY.auto : AI_PITCH_DELAY.normal;
  }

  private moveCursor(c: PlatePoint, input: PlayInput, dt: number, range = AIM_RANGE) {
    c.x = clamp(c.x + input.move.x * CURSOR_SPEED * dt, -range.x, range.x);
    c.y = clamp(c.y + input.move.y * CURSOR_SPEED * dt, range.yMin, range.yMax);
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
        if (this.reliefPending) this.enterRelief();
        else this.updatePrePitch(dt, inp);
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
        // 本塁打・乱闘の場面は、誰の操作でもとばせる（自動モードでも）。
        if ((this.trot || this.brawl) && input.primary) this.resultTime = 0;
        this.resultTime -= dt;
        if (this.resultTime <= 0) {
          if (this.replayPending) this.enterReplay();
          else this.afterResult();
        }
        break;
      // 合間の場面は、誰の操作でもとばせる。
      case 'replay':
      case 'change':
      case 'relief':
      case 'warmup':
        if (input.primary) this.resultTime = 0;
        this.resultTime -= dt;
        if (this.resultTime > 0) break;
        if (this.phase === 'replay') this.afterResult();
        else if (this.phase === 'change') {
          // 回の頭の継投は、投球練習の前に済ませる。
          if (this.changesPitcher()) this.enterRelief();
          else this.enterWarmup();
        } else if (this.phase === 'relief') this.enterWarmup();
        else this.enterPrePitch(false);
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
      this.moveCursor(this.aim, input, dt, PITCH_AIM_RANGE);
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
      const cmd = choosePitch(pitcher, s, this.strategyOf(fieldingTeam(s)).pitching, this.rng, this.isOpponentCpu(fieldingTeam(s)) ? DIFFICULTY_HEART[this.difficulty] : 1);
      this.pitchType = cmd.type;
      this.aim = { ...cmd.target };
      this.startWindup({ ...cmd, shift: this.pitcherShift });
    }
  }

  private startWindup(cmd: PitchCommand) {
    this.pitchCmd = cmd;
    this.setPhase('windup');
    if (!this.humanBatting) this.cpuSteal();
  }

  /** CPU の攻撃の盗塁。先の走者が走れそうなら、投球動作と同時にスタートする（後ろの走者もつられて走る）。 */
  private cpuSteal() {
    const s = this.state;
    const from = this.stealCandidates();
    if (!from.length) return;
    const lead = Math.max(...from) as 1 | 2;
    const runner = s.teams[battingTeam(s)].team.batters.find((b) => b.id === s.bases[lead])!;
    const team = s.teams[fieldingTeam(s)];
    const catcher = team.lineup[team.positions.indexOf('C')];
    const go = decideSteal({ speed: runner.speed, catcherArm: catcher.arm, from: lead, outs: s.outs, balls: s.balls, strikes: s.strikes, running: this.strategyOf(battingTeam(s)).running }, this.rng);
    if (!go) return;
    this.stealers = from;
    this.stealStart = null;
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
          pitcherVelocity: pitcher.velocity,
          pitcherBreaking: pitcher.breaking
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
    // 見送った球が打者の体に当たれば死球（球が来た時点で決まる）。
    if (this.pitchTime >= pitch.flightTime && hitsBatter(pitch.plate, currentBatter(this.state).bats, this.batterStance)) {
      this.hitByPitch();
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
      autoRunning: this.running === 'auto',
      rng: this.rng,
      park: this.park
    });
    this.setPhase('play');
  }

  private callPitch(call: PitchCall) {
    const s = this.state;
    const half = `${s.inning}${s.half}`;
    const end = pitchCall(s, call);
    if (end === 'strikeout' || call === 'called-strike' || call === 'swinging-strike') this.umpireCall = { kind: end === 'strikeout' ? 'strikeout' : 'strike', clock: this.clock };
    const text =
      end === 'strikeout' ? '三振！' : end === 'walk' ? 'フォアボール' : end === 'hit-by-pitch' ? '死球！' : call === 'ball' ? 'ボール' : call === 'swinging-strike' ? '空振り' : 'ストライク';
    const runs = s.log.at(-1)?.runs ?? 0;
    // 盗塁：四球なら走者は押し出されるだけ、3アウトでチェンジなら判定しない。
    const steal = this.stealers.length && end !== 'walk' && end !== 'hit-by-pitch' && !s.over && `${s.inning}${s.half}` === half ? this.resolveSteal() : '';
    const main = (end === 'walk' || end === 'hit-by-pitch') && runs ? '押し出し！' : text;
    const kind = end === 'strikeout' || end === 'hit-by-pitch' ? 'out' : end === 'walk' ? 'hit' : 'call';
    this.showResult({ text: steal ? `${main}　${steal}` : main, kind: steal ? (steal.includes('成功') ? 'hit' : 'out') : kind }, steal ? RESULT_TIME.play : RESULT_TIME.call);
  }

  /** 死球：打者を一塁へ送り、両軍が入り乱れる乱闘の場面を見せる。 */
  private hitByPitch() {
    const s = this.state;
    const bats = currentBatter(s).bats;
    const box = batterBox(bats);
    const mound = DEFAULT_FIELD_POSITIONS.P;
    const offense = battingTeam(s);
    const setup = {
      batter: { ...box, x: box.x + this.batterStance },
      pitcher: { ...mound, x: mound.x + this.pitcherShift },
      bases: ([1, 2, 3] as const).filter((b) => s.bases[b]),
      offenseDugout: dugoutPos(this.park, offense === 1 ? 1 : -1),
      defenseDugout: dugoutPos(this.park, offense === 1 ? -1 : 1),
      seed: Math.floor(this.rng.range(0, 1e6))
    };
    this.callPitch('hit-by-pitch');
    this.brawl = new Brawl(setup);
    this.resultTime = this.brawl.duration;
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
    const dugout = battingTeam(this.state) === 1 ? 1 : -1;
    applyPlay(this.state, r);
    const runs = this.state.log.at(-1)?.runs ?? 0;
    const kind = runs ? 'run' : r.hit ? 'hit' : r.error ? 'info' : 'out';
    const extra = runs ? `　${runs}点！` : r.outs.length && before + r.outs.length >= 3 ? '　チェンジ' : '';
    this.showResult({ text: r.text + extra, kind }, RESULT_TIME.play);
    // 本塁打とダイビングキャッチは、結果のあとでリプレイを見せる。
    const fine = play.events.some((e) => e.type === 'catch' && e.text === 'ダイビングキャッチ！');
    if (this.state.mode !== 'auto' && (play.homeRun || fine)) this.replayPending = { from: Math.max(0, play.time - REPLAY_MAX), to: play.time };
    if (play.homeRun) {
      // 打者と走者がダイヤモンドを回り、仲間とハイタッチし終えるまで結果を出しておく。
      this.trot = new HomeRunTrot(play.runners.map((x) => (x.state === 'active' ? x.u : null)), dugoutPos(this.park, dugout));
      this.resultTime = this.trot.duration;
    }
  }

  /** 攻守交代の場面。次の回の攻撃を知らせ、選手が入れ替わるのを見せる。J でとばせる。 */
  private enterChange() {
    const s = this.state;
    this.clearScenes();
    // ラッキーセブン：9回の試合の7回表の前はビジター、7回裏の前はホームのファンがジェット風船を飛ばす。
    this.luckySeven = s.innings >= 9 && s.inning === 7 ? battingTeam(s) : null;
    const attack = `${s.inning}回${s.half === 'top' ? '表' : '裏'}　${s.teams[battingTeam(s)].team.nameJa}の攻撃`;
    this.message = { text: this.luckySeven === null ? attack : 'ラッキーセブン！', kind: 'info' };
    const time = CHANGE_TIME + (this.luckySeven === null ? 0 : LUCKY_SEVEN_TIME);
    this.changeDuration = s.mode === 'auto' ? time * 0.6 : time;
    this.resultTime = this.changeDuration;
    this.setPhase('change');
  }

  /** 結果を出し終えたあと：回が変わっていれば攻守交代の場面、そうでなければ次の投球前。 */
  private afterResult() {
    if (!this.state.over && `${this.state.inning}${this.state.half}` !== this.halfKey) this.enterChange();
    else this.enterPrePitch();
  }

  /** 場面の途中のもの（投球・打球・本塁打・乱闘）を片づける。 */
  private clearScenes() {
    this.pitch = null;
    this.play = null;
    this.trot = null;
    this.brawl = null;
  }

  private get sceneRate() {
    return this.state.mode === 'auto' ? AUTO_SCENE_RATE : 1;
  }

  /** CPU の継投を決め、投手が代わったか。 */
  private changesPitcher(): boolean {
    const before = currentPitcher(this.state).id;
    this.cpuRelief();
    return currentPitcher(this.state).id !== before;
  }

  /** 投手交代の場面。守備側のベンチから監督が、同じ側のブルペンからリリーフが出てくる。 */
  private enterRelief() {
    this.reliefPending = false;
    this.clearScenes();
    const side = fieldingTeam(this.state) === 1 ? 1 : -1;
    this.relief = new PitchingChange(dugoutPos(this.park, side), bullpenGate(side), this.sceneRate);
    this.resultTime = this.relief.duration;
    this.setPhase('relief');
  }

  /** 投球練習の場面（攻守交代・投手交代のあと）。 */
  private enterWarmup() {
    this.clearScenes();
    this.relief = null;
    this.message = null;
    this.warmup = new Warmup(this.sceneRate);
    this.resultTime = this.warmup.duration;
    this.setPhase('warmup');
  }

  private enterReplay() {
    const r = this.replayPending!;
    this.replayPending = null;
    this.trot = null;
    this.brawl = null;
    this.replay = { ...r, speed: REPLAY_SPEED };
    this.resultTime = (r.to - r.from) / REPLAY_SPEED;
    this.setPhase('replay');
  }

  private showResult(m: MatchMessage, time: number) {
    this.message = m;
    this.resultTime = this.state.mode === 'auto' ? time * 0.6 : time;
    this.setPhase('result');
  }
}
