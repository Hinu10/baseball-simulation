// 試合の 3D 表示。Match（core）の状態を読んで、球場・選手・ボールを描くだけで、判定はしない。
import * as THREE from 'three';
import { batterBox, DEFAULT_FIELD_POSITIONS, DEFAULT_PARK, basePos, type Park } from '../core/field.ts';
import { battingTeam, fieldingTeam, type TeamIndex } from '../core/gameState.ts';
import type { Match } from '../core/match.ts';
import { v3, type Vec3 } from '../core/math.ts';
import { PlaySim } from '../core/play.ts';
import { pitchPosition, WINDUP_TIME } from '../core/pitching.ts';
import type { Position } from '../core/types.ts';
import { FIELD_POSITIONS } from '../core/types.ts';
import { CameraRig } from './cameraRig.ts';
import { basic, mat, mesh } from './materials.ts';
import { Overlays } from './overlays.ts';
import { PlayerFigure, type PoseName } from './player.ts';
import type { Crowd } from './crowd.ts';
import { buildStadium, Scoreboard, type Stadium } from './stadium.ts';
import type { TeamColors } from '../core/teams.ts';

const facingTo = (from: Vec3, to: Vec3) => Math.atan2(to.x - from.x, to.z - from.z);
const HOME = v3(0, 0, 0);
const FIGURE_SCALE = 1.4;

interface Actor {
  figure: PlayerFigure;
  shadow: THREE.Mesh;
}

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
  private readonly ball: THREE.Mesh;
  private readonly ballShadow: THREE.Mesh;
  private match: Match | null = null;

  constructor() {
    this.root.scale.x = -1;
    this.scene.add(this.root);
    this.scene.add(this.scoreboard.object);
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#6a8f4e', 1.6));
    const sun = new THREE.DirectionalLight('#fff6e0', 1.6);
    sun.position.set(-40, 80, -30);
    this.scene.add(sun);
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
    // 両チームとも、守備用9人と攻撃用4人（打者＋走者3人）を用意しておき、表裏で出し分ける。
    this.fielders = [[], []];
    this.offense = [[], []];
    this.ball = mesh(new THREE.SphereGeometry(0.14, 16, 12), mat('#ffffff', { emissive: '#666666' }));
    this.ballShadow = mesh(new THREE.CircleGeometry(0.16, 16), basic('#000000', 0.35));
    this.ballShadow.rotation.x = -Math.PI / 2;
    this.root.add(this.ball, this.ballShadow, this.overlays.group);
    this.actor = actor;
  }

  private readonly actor: (f: PlayerFigure) => Actor;

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
    }
    if (fans) this.crowd.setTeams(fans);
  }

  /** 試合を表示する。チームの色で選手を作り直す。 */
  attach(m: Match) {
    this.match = m;
    for (const t of [0, 1] as TeamIndex[]) {
      for (const a of [...this.fielders[t], ...this.offense[t]]) this.root.remove(a.figure.root, a.shadow);
      const team = m.state.teams[t].team;
      this.fielders[t] = FIELD_POSITIONS.map(() => this.actor(new PlayerFigure(team.colors, team.abbr[0])));
      this.offense[t] = [0, 1, 2, 3].map(() => this.actor(new PlayerFigure(team.colors, team.abbr[0])));
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
    a.figure.root.visible = visible;
    a.shadow.visible = visible;
    if (!visible) return;
    a.figure.root.position.set(p.x, p.y, p.z);
    // アーケード風に、選手は実寸より大きく見せる（判定には影響しない）。
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
    for (const a of [...this.fielders[0], ...this.fielders[1], ...this.offense[0], ...this.offense[1]]) this.place(a, HOME, 0, 'idle', 0, false);
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
    this.scoreboard.update(s);
    const def = fieldingTeam(s);
    const off = battingTeam(s);
    const atBat = s.teams[off].lineup[s.teams[off].battingIndex];
    this.crowd.setBatter(s.over ? null : { id: atBat.id, name: atBat.name, team: off });
    const other = (t: TeamIndex) => (t === 0 ? 1 : 0) as TeamIndex;
    // 守っていないチームの守備用・攻撃していないチームの攻撃用は隠す。
    for (const a of this.fielders[other(def)]) this.place(a, HOME, 0, 'idle', 0, false);
    for (const a of this.offense[other(off)]) this.place(a, HOME, 0, 'idle', 0, false);

    const play = m.play;
    let ballPos: Vec3 = v3(0, 1.6, 18);
    let ballVisible = true;
    let ballAir = false;

    if (play) {
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
      for (const b of [1, 2, 3] as const) {
        const a = this.offense[off][b];
        const id = s.bases[b];
        const p = basePos(b);
        // 盗塁中は次の塁へ走る。
        const running = b < 3 ? m.stealPosition(b as 1 | 2) : null;
        const lead = running !== null ? PlaySim.runnerPos(running) : v3(p.x + (basePos(b + 1).x - p.x) * 0.1, 0, p.z + (basePos(b + 1).z - p.z) * 0.1);
        this.place(a, lead, facingTo(lead, basePos(b + 1)), running !== null ? 'run' : 'idle', m.clock, !!id);
      }
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

    this.ball.visible = ballVisible;
    this.ballShadow.visible = ballVisible;
    this.ball.position.set(ballPos.x, ballPos.y, ballPos.z);
    this.ballShadow.position.set(ballPos.x, 0.06, ballPos.z);

    // カメラ：打球が出たら B、捕球・着地の後は C、次の投球前に A。
    if (play && m.phase === 'play') {
      const settle = play.ballMode !== 'live' || (play.ball.bounces > 0 && play.time > 0.9) || play.time > 4.5;
      this.rig.setMode(settle ? 'C' : 'B');
    } else if (!play) {
      this.rig.setMode('A');
    }
    const controlled = play && play.controlled >= 0 ? play.fielders[play.controlled].pos : null;
    const bats = s.teams[off].lineup[s.teams[off].battingIndex].bats;
    this.rig.update(dt, { ball: ballPos, ballAirborne: ballAir, player: controlled, batterSide: bats, close: m.humanBatting || m.humanPitching });
  }
}
