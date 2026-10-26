// 試合の 3D 表示。Match（core）の状態を読んで、球場・選手・ボールを描くだけで、判定はしない。
import * as THREE from 'three';
import { batterBox, DEFAULT_FIELD_POSITIONS, DEFAULT_PARK, basePos, dugoutPos, onDeckPos, UMPIRE_POSITIONS, type Park, type UmpireRole } from '../core/field.ts';
import { battingTeam, currentBatter, fieldingTeam, type TeamIndex } from '../core/gameState.ts';
import type { Match } from '../core/match.ts';
import { GATHER } from '../core/relief.ts';
import { tension } from '../core/tension.ts';
import { clamp, v3, type Vec3 } from '../core/math.ts';
import { PlaySim, type PlayEvent } from '../core/play.ts';
import { BENCH_PLAYERS } from '../core/brawl.ts';
import { GREETERS } from '../core/homerunTrot.ts';
import { pitchPosition, WINDUP_TIME } from '../core/pitching.ts';
import type { Position } from '../core/types.ts';
import { FIELD_POSITIONS } from '../core/types.ts';
import { CameraRig } from './cameraRig.ts';
import { basic, mat, mesh } from './materials.ts';
import { Overlays } from './overlays.ts';
import { PlayerFigure, type PoseName } from './player.ts';
import { uniformLook, type UniformLook } from './uniforms.ts';
import type { Crowd } from './crowd.ts';
import { buildStadium, Scoreboard, type Stadium } from './stadium.ts';
import type { TeamColors } from '../core/teams.ts';

const facingTo = (from: Vec3, to: Vec3) => Math.atan2(to.x - from.x, to.z - from.z);
const HOME = v3(0, 0, 0);
const FIGURE_SCALE = 1.05;
/** ふつうの球場の明かりの強さ。 */
const LIGHT = 1.6;

interface Actor {
  figure: PlayerFigure;
  shadow: THREE.Mesh;
}

/** place に渡したもの（選手・位置・向き・動作・その秒・見せるか・打席・投げる手）。 */
type Placement = [Actor, Vec3, number, PoseName, number, boolean, ('R' | 'L')?, ('R' | 'L')?];

/** リプレイ用に記録した1コマ：打球の時刻と、そのとき置いた選手・ボール。 */
interface ReplayFrame {
  t: number;
  places: Placement[];
  ball: Vec3;
  ballVisible: boolean;
  ballAir: boolean;
}

/** 審判の服（紺の上着と帽子）。 */
const UMPIRE_LOOK: UniformLook = { primary: '#1c2230', secondary: '#3a4150', uniform: '#1c2230', pants: '#20242b', cap: '#141821', trim: '#5b6672', pattern: 'piping', lettering: '#ffffff' };
const UMPIRE_ROLES: UmpireRole[] = ['home', '1B', '2B', '3B'];
/** 審判の判定の動きを続ける秒。 */
const UMPIRE_ACT = 1.4;

export class MatchView {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(48, 16 / 9, 0.1, 600);
  readonly rig = new CameraRig(this.camera);
  /** core の座標系（+x が一塁側）。画面で一塁側が右に来るよう x を反転して表示する。 */
  readonly root = new THREE.Group();
  readonly scoreboard = new Scoreboard();
  readonly overlays = new Overlays();
  private stadium!: Stadium;
  private time = 0;

  private readonly fielders: [Actor[], Actor[]];
  private readonly offense: [Actor[], Actor[]];
  /** ベンチの選手（本塁打の出迎え・乱闘で出てくる）と、最後に監督。 */
  private readonly bench: [Actor[], Actor[]];
  private readonly ball: THREE.Mesh;
  private readonly ballShadow: THREE.Mesh;
  private match: Match | null = null;
  /** 球審と塁審。判定（アウト・セーフ）の動きは、打球の出来事を見て近い審判にさせる。 */
  private readonly umpires: Record<UmpireRole, Actor>;
  private readonly umpireAct: Partial<Record<UmpireRole, { pose: PoseName; clock: number; facing: number }>> = {};
  private umpirePlay: PlaySim | null = null;
  private umpireEvents = 0;
  /** リプレイの記録（いちばん最近の打球のぶん）。 */
  private frames: ReplayFrame[] = [];
  private recordedPlay: PlaySim | null = null;
  private recording: ReplayFrame['places'] | null = null;
  /** ラッキーセブンのジェット風船を飛ばした攻守交代（同じ場面で二度飛ばさない）。 */
  private balloonKey = '';

  constructor() {
    this.root.scale.x = -1;
    this.scene.add(this.root);
    this.scene.add(this.scoreboard.object);
    this.scene.add(this.hemi, this.sun);
    this.sun.position.set(-40, 80, -30);
    this.setPark(DEFAULT_PARK);

    const shadowGeo = new THREE.CircleGeometry(0.6, 20);
    const shadowMat = basic('#000000', 0.25);
    const actor = (look: PlayerFigure): Actor => {
      const shadow = mesh(shadowGeo, shadowMat);
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.y = 0.05;
      this.root.add(look.root, shadow);
      return { figure: look, shadow };
    };
    // 両チームとも、守備用9人と攻撃用4人（打者＋走者3人）＋本塁打で出迎える仲間を用意しておき、表裏で出し分ける。
    this.fielders = [[], []];
    this.offense = [[], []];
    this.bench = [[], []];
    this.ball = mesh(new THREE.SphereGeometry(0.14, 16, 12), mat('#ffffff', { emissive: '#666666' }));
    this.ballShadow = mesh(new THREE.CircleGeometry(0.16, 16), basic('#000000', 0.35));
    this.ballShadow.rotation.x = -Math.PI / 2;
    this.root.add(this.ball, this.ballShadow, this.overlays.group);
    this.actor = actor;
    this.umpires = Object.fromEntries(UMPIRE_ROLES.map((r) => [r, actor(new PlayerFigure(UMPIRE_LOOK, '', { manager: true }))])) as Record<UmpireRole, Actor>;
  }

  private readonly actor: (f: PlayerFigure) => Actor;
  /** グラウンドを照らす明かり。球場によって暗くする（Stadium.fieldLight）。 */
  private readonly hemi = new THREE.HemisphereLight('#ffffff', '#6a8f4e', LIGHT);
  private readonly sun = new THREE.DirectionalLight('#fff6e0', LIGHT);

  get crowd(): Crowd {
    return this.stadium.crowd;
  }

  get park(): Park {
    return this.stadium.park;
  }

  /** 球場を切り替える（同じ球場なら何もしない）。fans を渡すと観客をその2チームのファンにする。 */
  setPark(park: Park, fans?: [TeamColors, TeamColors]) {
    if (this.stadium?.park.id !== park.id) {
      if (this.stadium) {
        this.root.remove(this.stadium.group);
        this.stadium.dispose();
      }
      this.stadium = buildStadium(park);
      this.root.add(this.stadium.group);
      this.scene.background = new THREE.Color(this.stadium.sky);
      this.scene.fog = new THREE.Fog(this.stadium.sky, 180, 420);
      this.scoreboard.setStadium(this.stadium);
      const light = this.stadium.fieldLight;
      this.hemi.intensity = this.sun.intensity = LIGHT * (light?.intensity ?? 1);
      this.hemi.color.set(light?.color ?? '#ffffff');
      this.sun.color.set(light?.color ?? '#fff6e0');
    }
    if (fans) this.crowd.setTeams(fans);
  }

  /** 試合を表示する。チームの色で選手を作り直す。 */
  attach(m: Match) {
    this.match = m;
    for (const t of [0, 1] as TeamIndex[]) {
      for (const a of [...this.fielders[t], ...this.offense[t], ...this.bench[t]]) this.root.remove(a.figure.root, a.shadow);
      const team = m.state.teams[t].team;
      const look = uniformLook(team, t === 1 ? 'home' : 'visitor');
      this.fielders[t] = FIELD_POSITIONS.map(() => this.actor(new PlayerFigure(look, team.abbr)));
      this.offense[t] = [0, 1, 2, 3].map(() => this.actor(new PlayerFigure(look, team.abbr)));
      this.bench[t] = Array.from({ length: BENCH_PLAYERS + 1 }, (_, k) => this.actor(new PlayerFigure(look, team.abbr, { manager: k === BENCH_PLAYERS })));
    }
    this.setPark(m.park, [m.state.teams[0].team.colors, m.state.teams[1].team.colors]);
    this.rig.setMode('A');
    this.rig.snap({ ball: v3(0, 1, 18), ballAirborne: false });
  }

  resize(w: number, h: number) {
    this.camera.aspect = w / h;
    // 縦長の画面でも球場が入るよう、狭いときは画角を広げる。
    this.rig.baseFov = w / h < 1.2 ? 62 : 48;
    this.camera.fov = this.rig.baseFov;
    this.camera.updateProjectionMatrix();
  }

  private place(a: Actor, p: Vec3, facing: number, pose: PoseName, t: number, visible = true, bats?: 'R' | 'L', throws?: 'R' | 'L') {
    this.recording?.push([a, { ...p }, facing, pose, t, visible, bats, throws]);
    a.figure.root.visible = visible;
    a.shadow.visible = visible;
    if (!visible) return;
    a.figure.root.position.set(p.x, p.y, p.z);
    // 約1.85mのモデルを実寸に近い大きさで置く（判定には影響しない）。
    a.figure.root.scale.setScalar(FIGURE_SCALE);
    a.figure.root.rotation.y = facing;
    a.shadow.position.set(p.x, 0.05, p.z);
    a.figure.pose({ name: pose, t, bats, throws });
  }

  /**
   * メニュー表示中：球場の上をゆっくり回る。
   * tour（球場を見る画面）なら、屋外の球場は周りの景色まで見えるよう、引いて高い所から回る（ドームは屋根の中から）。
   */
  idle(dt: number, tour = false) {
    this.time += dt;
    this.match = null;
    this.stadium.update(dt);
    for (const a of this.allActors()) this.place(a, HOME, 0, 'idle', 0, false);
    this.ball.visible = false;
    this.ballShadow.visible = false;
    this.overlays.group.visible = false;
    this.crowd.setBatter(null);
    const a = this.time * 0.06;
    const wide = tour && !this.stadium.park.dome;
    const r = wide ? 185 : 70;
    this.camera.position.set(-Math.sin(a) * r, wide ? 70 : 38, 45 - Math.cos(a) * r);
    this.camera.lookAt(0, wide ? 8 : 0, 45);
    this.scoreboard.update(null);
  }

  private allActors(): Actor[] {
    return [...this.fielders[0], ...this.fielders[1], ...this.offense[0], ...this.offense[1], ...this.bench[0], ...this.bench[1], ...Object.values(this.umpires)];
  }

  /** ネクストバッターズサークルで、打者（打順 order）が素振りして待つ。ベンチの GREETERS 番目の選手が務める。 */
  private placeOnDeck(m: Match, off: TeamIndex, order: number) {
    const t = m.state.teams[off];
    const b = t.lineup[order % t.lineup.length];
    const p = onDeckPos(off === 1 ? 1 : -1);
    this.place(this.bench[off][GREETERS], p, facingTo(p, HOME) + (b.bats === 'R' ? Math.PI / 2 : -Math.PI / 2), 'warmup', m.clock + order * 0.7, true, b.bats);
  }

  /** 審判を立たせる。球審は投球のあいだ構え、コールのときは動く。塁審は判定のときだけ動く。 */
  private placeUmpires(m: Match, play: PlaySim | null) {
    // 打球の出来事（アウト・セーフ）を、いちばん近い審判に判定させる。
    if (play !== this.umpirePlay) {
      this.umpirePlay = play;
      this.umpireEvents = 0;
    }
    if (play) {
      for (const e of play.events.slice(this.umpireEvents)) if (e.type === 'out' || e.type === 'safe') this.judge(e, m.clock);
      this.umpireEvents = play.events.length;
    }
    const call = m.umpireCall && m.clock - m.umpireCall.clock < UMPIRE_ACT ? m.umpireCall : null;
    for (const role of UMPIRE_ROLES) {
      const p = UMPIRE_POSITIONS[role];
      const act = this.umpireAct[role];
      const acting = act && m.clock - act.clock < UMPIRE_ACT ? act : null;
      if (role === 'home') {
        // 投球の場面（カメラ A）：捕手と本塁が隠れないよう、打者と反対側へずらして小さめに描き、投球前からかがんで構える。
        // 人が投げる・打つときの近い視点では描かない（捕手と同じ）。
        const atBat = m.phase === 'pre-pitch' || m.phase === 'windup' || m.phase === 'pitch' || (m.phase === 'result' && !m.trot && !m.brawl);
        const close = (m.humanBatting || m.humanPitching) && atBat;
        const bats = currentBatter(m.state).bats;
        // 投球練習のあいだも、捕手の横に立って見守る。
        const aside = atBat || m.phase === 'warmup';
        const spot = aside ? v3(bats === 'R' ? 0.75 : -0.75, 0, p.z - 0.3) : p;
        if (acting) this.place(this.umpires.home, spot, acting.facing, acting.pose, m.clock - acting.clock, !close);
        else if (call && m.phase === 'result') this.place(this.umpires.home, spot, 0, call.kind === 'strikeout' ? 'strikeout' : 'call', m.clock - call.clock, !close);
        else this.place(this.umpires.home, spot, 0, atBat ? 'crouch' : 'idle', m.clock, !close);
        if (aside) this.umpires.home.figure.root.scale.setScalar(1.05);
        continue;
      }
      if (acting) this.place(this.umpires[role], p, acting.facing, acting.pose, m.clock - acting.clock);
      else this.place(this.umpires[role], p, facingTo(p, v3(0, 0, 12)), 'idle', m.clock);
    }
  }

  private judge(e: PlayEvent, clock: number) {
    const role = UMPIRE_ROLES.reduce((a, b) => (Math.hypot(UMPIRE_POSITIONS[b].x - e.pos.x, UMPIRE_POSITIONS[b].z - e.pos.z) < Math.hypot(UMPIRE_POSITIONS[a].x - e.pos.x, UMPIRE_POSITIONS[a].z - e.pos.z) ? b : a));
    this.umpireAct[role] = { pose: e.type === 'out' ? 'call' : 'safe', clock, facing: facingTo(UMPIRE_POSITIONS[role], e.pos) };
  }

  /** リプレイ：記録した打球の場面を、時刻 from から speed 倍で再生する。カメラは R。 */
  private playReplay(m: Match, r: NonNullable<Match['replay']>, dt: number) {
    const target = r.from + m.phaseTime * r.speed;
    let frame = this.frames[0];
    for (const f of this.frames) if (f.t <= target) frame = f;
    for (const a of this.allActors()) this.place(a, HOME, 0, 'idle', 0, false);
    if (!frame) return;
    for (const args of frame.places) this.place(...args);
    this.ball.visible = this.ballShadow.visible = frame.ballVisible;
    this.ball.position.set(frame.ball.x, frame.ball.y, frame.ball.z);
    this.ballShadow.position.set(frame.ball.x, 0.06, frame.ball.z);
    this.rig.setMode('R');
    this.rig.update(dt, { ball: frame.ball, ballAirborne: frame.ballAir });
  }

  /** core の座標を画面上の位置（CSS ピクセル）にする。カメラの後ろなら null。 */
  project(p: Vec3, width: number, height: number): { x: number; y: number } | null {
    const v = new THREE.Vector3(-p.x, p.y, p.z).project(this.camera);
    if (v.z > 1) return null;
    return { x: ((v.x + 1) / 2) * width, y: ((1 - v.y) / 2) * height };
  }

  update(dt: number) {
    const m = this.match;
    if (!m) return;
    this.time += dt;
    this.stadium.update(dt);
    this.overlays.group.visible = true;
    this.overlays.update(m, this.time);
    const s = m.state;
    for (const t of [0, 1] as TeamIndex[]) {
      const side = s.teams[t];
      FIELD_POSITIONS.forEach((pos, i) => {
        const player = pos === 'P' ? side.pitcher : side.lineup[side.positions.indexOf(pos)];
        this.fielders[t][i].figure.setNumber(player?.number);
      });
      this.offense[t][0].figure.setNumber(side.lineup[side.battingIndex]?.number);
      for (const base of [1, 2, 3] as const) {
        const runner = side.team.batters.find((b) => b.id === s.bases[base]);
        this.offense[t][base].figure.setNumber(runner?.number);
      }
    }
    this.scoreboard.update(s);
    const def = fieldingTeam(s);
    const off = battingTeam(s);
    const atBat = s.teams[off].lineup[s.teams[off].battingIndex];
    this.crowd.setBatter(s.over ? null : { id: atBat.id, name: atBat.name, team: off });
    this.crowd.setTension(off, tension(s));
    // ラッキーセブン：攻守交代の場面に入ったら、次に攻撃するチームのファンがジェット風船を飛ばす。
    const lucky = m.phase === 'change' && m.luckySeven !== null ? `${s.inning}${s.half}` : '';
    if (lucky && lucky !== this.balloonKey && m.phaseTime > 0.8) {
      this.balloonKey = lucky;
      this.crowd.releaseBalloons(m.luckySeven!);
    }
    if (m.phase === 'replay' && m.replay) {
      this.playReplay(m, m.replay, dt);
      return;
    }
    const other = (t: TeamIndex) => (t === 0 ? 1 : 0) as TeamIndex;
    // 守っていないチームの守備用・攻撃していないチームの攻撃用は隠す。
    for (const a of this.fielders[other(def)]) this.place(a, HOME, 0, 'idle', 0, false);
    for (const a of this.offense[other(off)]) this.place(a, HOME, 0, 'idle', 0, false);
    // ベンチの選手と監督は、本塁打の出迎えと乱闘の場面だけ出てくる。
    for (const a of [...this.bench[0], ...this.bench[1]]) this.place(a, HOME, 0, 'idle', 0, false);

    const play = m.play;
    // 打球のあいだは、リプレイ用に選手とボールの置き方を記録する（新しい打球が始まったら前の記録は捨てる）。
    const record = m.phase === 'play' && play;
    if (record && play !== this.recordedPlay) {
      this.recordedPlay = play;
      this.frames = [];
    }
    this.recording = record ? [] : null;
    if (record) for (const a of this.allActors()) this.place(a, HOME, 0, 'idle', 0, false);
    const trot = m.phase === 'result' ? m.trot : null;
    const trotTime = m.phaseTime;
    const brawl = m.phase === 'result' ? m.brawl : null;
    let ballPos: Vec3 = v3(0, 1.6, 18);
    let ballVisible = true;
    let ballAir = false;
    /** 出迎えの場面でカメラ D を置く向き。 */
    let greetFrom: Vec3 | undefined;

    if (brawl) {
      // 乱闘の場面：打者・走者・守備・両軍のベンチと監督が、本塁とマウンドの間でもみ合う。
      const t = m.phaseTime;
      brawl.offense(t).forEach((f, i) => this.place(this.offense[off][i], f?.pos ?? HOME, f?.facing ?? 0, f?.anim ?? 'idle', f?.t ?? 0, !!f));
      brawl.fielders(t).forEach((f, i) => this.place(this.fielders[def][i], f.pos, f.facing, f.anim, f.t));
      brawl.bench('offense', t).forEach((f, i) => this.place(this.bench[off][i], f.pos, f.facing, f.anim, f.t));
      brawl.bench('defense', t).forEach((f, i) => this.place(this.bench[def][i], f.pos, f.facing, f.anim, f.t));
      if (brawl.brawling(t)) {
        this.crowd.cheer(0.6, off);
        this.crowd.cheer(0.6, def);
      }
      ballVisible = false;
    } else if (m.phase === 'change') {
      // 攻守交代の場面：守っていたチーム（次は攻撃）は守備位置からベンチへ、次に守るチームはベンチ前から守備位置へ走る。
      // ベンチから外野までは遠いので、出ていく側は途中から、戻る側は途中まで（そこで見えなくする）。
      const k = m.phaseTime / m.changeDuration;
      const toward = (a: Vec3, b: Vec3, u: number) => v3(a.x + (b.x - a.x) * u, 0, a.z + (b.z - a.z) * u);
      const offDugout = dugoutPos(this.park, off === 1 ? 1 : -1);
      const defDugout = dugoutPos(this.park, def === 1 ? 1 : -1);
      FIELD_POSITIONS.forEach((pos, i) => {
        const spot = DEFAULT_FIELD_POSITIONS[pos as Position];
        // 少しずつずらして走り出す。
        const u = clamp((k - i * 0.02) / 0.85, 0, 1);
        const leaving = toward(spot, offDugout, u * 0.6);
        this.place(this.fielders[off][i], leaving, facingTo(spot, offDugout), 'run', m.clock, u < 1);
        const start = toward(defDugout, spot, 0.4);
        const arriving = toward(start, spot, u);
        this.place(this.fielders[def][i], arriving, u < 1 ? facingTo(start, spot) : facingTo(spot, HOME), u < 1 ? 'run' : 'idle', m.clock);
      });
      for (const a of this.offense[off]) this.place(a, HOME, 0, 'idle', 0, false);
      ballVisible = false;
    } else if (m.phase === 'relief' && m.relief) {
      // 投手交代の場面：外野手はその場で待ち、内野手と捕手はマウンドへ。監督とリリーフが来て、代わった投手はベンチへ。
      const r = m.relief;
      const t = m.phaseTime;
      const gather = r.gathering(t);
      FIELD_POSITIONS.forEach((pos, i) => {
        const k = GATHER.indexOf(pos as Position);
        const p = DEFAULT_FIELD_POSITIONS[pos as Position];
        if (pos === 'P') {
          const f = r.reliever(t);
          this.place(this.fielders[def][i], f.pos, f.facing, f.anim, f.t, true, undefined, s.teams[def].pitcher.throws);
        } else if (k >= 0) this.place(this.fielders[def][i], gather[k].pos, gather[k].facing, gather[k].anim, gather[k].t);
        else this.place(this.fielders[def][i], p, facingTo(p, HOME), 'idle', m.clock);
      });
      const mg = r.manager(t);
      this.place(this.bench[def][BENCH_PLAYERS], mg.pos, mg.facing, mg.anim, mg.t);
      const lv = r.leaving(t);
      this.place(this.bench[def][0], lv.pos, lv.facing, lv.anim, lv.t);
      this.placeRunners(m, off);
      this.place(this.offense[off][0], HOME, 0, 'idle', 0, false);
      // 打席に入る打者は、サークルで待つ。
      this.placeOnDeck(m, off, s.teams[off].battingIndex);
      ballVisible = false;
    } else if (m.phase === 'warmup' && m.warmup) {
      // 投球練習の場面：投手が捕手へ投げ、最後に捕手が二塁へ送球する。打席に入る打者はサークルで待つ。
      const w = m.warmup;
      const t = m.phaseTime;
      FIELD_POSITIONS.forEach((pos, i) => {
        const p = DEFAULT_FIELD_POSITIONS[pos as Position];
        const f = pos === 'P' ? w.pitcher(t) : pos === 'C' ? w.catcher(t) : pos === '2B' ? w.cover(t) : null;
        if (f) this.place(this.fielders[def][i], f.pos, f.facing, f.anim, f.t, true, undefined, pos === 'P' ? s.teams[def].pitcher.throws : undefined);
        else this.place(this.fielders[def][i], p, facingTo(p, HOME), 'idle', m.clock);
      });
      for (const a of this.offense[off]) this.place(a, HOME, 0, 'idle', 0, false);
      this.placeOnDeck(m, off, s.teams[off].battingIndex);
      ballPos = w.ball(t);
    } else if (play && trot) {
      // 本塁打の場面：守備の選手はその場で立ち止まり、打者と走者がダイヤモンドを回る。観客は沸き続ける。
      // 本塁の近く（捕手）は、打者がベンチへ向かう道と反対側へよける。
      const aside = v3(-trot.dugoutSide * 4.5, 0, -2.5);
      for (const f of play.fielders) {
        const near = Math.hypot(f.pos.x, f.pos.z) < 6;
        this.place(this.fielders[def][FIELD_POSITIONS.indexOf(f.position)], near ? aside : f.pos, near ? facingTo(aside, HOME) : f.facing, 'idle', m.clock);
      }
      trot.runners(trotTime).forEach((r, i) => this.place(this.offense[off][i], r?.pos ?? HOME, r?.facing ?? 0, r?.anim ?? 'idle', r?.t ?? 0, !!r));
      for (let i = play.runners.length; i < 4; i++) this.place(this.offense[off][i], HOME, 0, 'idle', 0, false);
      trot.greeters(trotTime).forEach((g, k) => this.place(this.bench[off][k], g.pos, g.facing, g.anim, g.t));
      // 次の打者はベンチの残りの1人（GREETERS 番目）が務める。
      const next = trot.nextBatter(trotTime);
      this.place(this.bench[off][GREETERS], next.pos, next.facing, next.anim, next.t);
      this.crowd.cheer(0.8, off);
      ballVisible = false;
    } else if (play) {
      for (const f of play.fielders) this.place(this.fielders[def][FIELD_POSITIONS.indexOf(f.position)], f.pos, f.facing, f.anim, f.animTime);
      play.runners.forEach((r, i) => {
        const a = this.offense[off][i];
        const p = PlaySim.runnerPos(r.u);
        const next = basePos(Math.min(4, Math.floor(r.u + 0.02) + (r.target >= r.u ? 1 : 0)));
        const moving = Math.abs(r.u - r.target) > 0.01;
        // アウトになった走者はしばらく残してから消す。生還した走者は消す。
        const visible = r.state === 'active' || (r.state === 'out' && play.time < 2);
        this.place(a, p, facingTo(p, next), moving ? 'run' : 'idle', play.time, visible);
      });
      for (let i = play.runners.length; i < 4; i++) this.place(this.offense[off][i], HOME, 0, 'idle', 0, false);
      this.placeOnDeck(m, off, s.teams[off].battingIndex + 1);
      ballPos = play.ball.pos;
      ballAir = play.ballMode === 'live' && play.ball.bounces === 0;
      ballVisible = play.ballMode !== 'dead' || !play.homeRun;
    } else {
      // 投球前後：守備位置に立ち、打者は打席、走者は塁上。
      for (const pos of FIELD_POSITIONS) {
        const a = this.fielders[def][FIELD_POSITIONS.indexOf(pos)];
        const p = DEFAULT_FIELD_POSITIONS[pos as Position];
        if (pos === 'P') {
          const pitching = m.phase === 'windup' || m.phase === 'pitch';
          const t = m.phase === 'windup' ? m.phaseTime : m.phase === 'pitch' ? WINDUP_TIME + m.pitchTime : 0;
          this.place(a, v3(p.x + m.pitcherShift, 0.25, p.z), Math.PI, pitching ? 'pitch' : 'idle', t, true, undefined, s.teams[def].pitcher.throws);
        } else if (pos === 'C') {
          // 人が投げる・打つときの近い視点では、ゾーンが隠れないよう捕手を描かない。
          this.place(a, p, 0, 'crouch', m.clock, !(m.humanBatting || m.humanPitching));
        } else {
          this.place(a, p, facingTo(p, HOME), 'idle', m.clock);
        }
      }
      const batter = s.teams[off].lineup[s.teams[off].battingIndex];
      const box = batterBox(batter.bats);
      box.x += m.batterStance;
      const swinging = m.phase === 'pitch' && m.swingStarted();
      const pose: PoseName = m.buntStance ? 'bunt' : swinging ? 'swing' : 'bat';
      const swingT = swinging && m.swing ? m.pitchTime - m.swing.time : 0;
      this.place(this.offense[off][0], box, batter.bats === 'R' ? Math.PI / 2 : -Math.PI / 2, pose, swingT, true, batter.bats);
      // 近い視点では打者が画面をふさがないよう、少し小さく描く。
      if (m.humanBatting || m.humanPitching) this.offense[off][0].figure.root.scale.setScalar(1.1);
      this.placeRunners(m, off);
      if (!s.over) this.placeOnDeck(m, off, s.teams[off].battingIndex + 1);
      if (m.phase === 'pitch' && m.pitch) {
        const bp = pitchPosition(m.pitch, m.pitchTime);
        // 捕手のミットで止まる。
        ballPos = bp.z < -1.0 ? v3(m.pitch.plate.x, m.pitch.plate.y, -1.0) : bp;
      } else if (m.phase === 'result' && m.pitch) {
        ballPos = v3(m.pitch.plate.x, m.pitch.plate.y, -1.0);
      } else {
        ballVisible = false;
      }
    }

    this.placeUmpires(m, play);
    if (this.recording && play) this.frames.push({ t: play.time, places: this.recording, ball: { ...ballPos }, ballVisible, ballAir });
    this.recording = null;
    this.ball.visible = ballVisible;
    this.ballShadow.visible = ballVisible;
    this.ball.position.set(ballPos.x, ballPos.y, ballPos.z);
    this.ballShadow.position.set(ballPos.x, 0.06, ballPos.z);

    // カメラ：打球が出たら B、捕球・着地の後は C、次の投球前に A。本塁打の場面は回る打者を追い、本塁に近づいたら出迎えの列を正面から。
    if (brawl) {
      this.rig.setMode('E');
      ballPos = brawl.focus(m.phaseTime);
    } else if (trot) {
      const batter = trot.batterPos(trotTime);
      const greet = trot.greeting(trotTime);
      this.rig.setMode(greet ? 'D' : 'B');
      if (greet) {
        const c = greet.center;
        ballPos = v3(c.x + (batter.x - c.x) * 0.3, 0, c.z + (batter.z - c.z) * 0.3);
        greetFrom = greet.from;
      } else ballPos = batter;
    } else if (m.phase === 'change' && m.luckySeven !== null && m.phaseTime > 0.6) {
      // ラッキーセブン：ジェット風船が上がる応援席（ホームは右翼、ビジターは左翼）を見上げる。
      this.rig.setMode('B');
      ballPos = v3((m.luckySeven === 1 ? 1 : -1) * 45, 20, 82);
      ballAir = true;
    } else if (m.phase === 'change') {
      this.rig.setMode('C');
      ballPos = v3(0, 0, 30);
    } else if (m.phase === 'relief') {
      this.rig.setMode('C');
      ballPos = v3(0, 0, 14);
    } else if (m.phase === 'warmup') {
      this.rig.setMode('A');
    } else if (play && m.phase === 'play') {
      const settle = play.ballMode !== 'live' || (play.ball.bounces > 0 && play.time > 0.9) || play.time > 4.5;
      this.rig.setMode(settle ? 'C' : 'B');
    } else if (!play) {
      this.rig.setMode('A');
    }
    const controlled = play && play.controlled >= 0 ? play.fielders[play.controlled].pos : null;
    const bats = s.teams[off].lineup[s.teams[off].battingIndex].bats;
    const close = (m.humanBatting || m.humanPitching) && m.phase !== 'warmup';
    this.rig.update(dt, { ball: ballPos, ballAirborne: ballAir, player: controlled, batterSide: bats, close, from: greetFrom });
  }

  /** 塁上の走者（盗塁中は次の塁へ走る）。 */
  private placeRunners(m: Match, off: TeamIndex) {
    const s = m.state;
    for (const b of [1, 2, 3] as const) {
      const a = this.offense[off][b];
      const id = s.bases[b];
      const p = basePos(b);
      const running = b < 3 && m.phase !== 'relief' ? m.stealPosition(b as 1 | 2) : null;
      const lead = running !== null ? PlaySim.runnerPos(running) : v3(p.x + (basePos(b + 1).x - p.x) * 0.1, 0, p.z + (basePos(b + 1).z - p.z) * 0.1);
      this.place(a, lead, facingTo(lead, basePos(b + 1)), running !== null ? 'run' : 'idle', m.clock, !!id);
    }
  }
}
