// 試合中のガイド表示（3D）：ストライクゾーン、ミートカーソル、コースカーソル、操作選手のマーカー、落下点ガイド。
import * as THREE from 'three';
import { cursorSize } from '../core/batting.ts';
import { currentBatter } from '../core/gameState.ts';
import type { Match } from '../core/match.ts';
import { PlaySim } from '../core/play.ts';
import { DEFAULT_ZONE } from '../core/pitching.ts';
import { mesh } from './materials.ts';

const overlay = (color: string, opacity = 1) =>
  new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false, side: THREE.DoubleSide });

const CURSOR_COLOR = { meet: '#ffe14d', power: '#ff4d4d', bunt: '#4dd9ff' };

function flatRing(inner: number, outer: number, color: string, opacity = 0.9): THREE.Mesh {
  const m = mesh(new THREE.RingGeometry(inner, outer, 40), overlay(color, opacity));
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 5;
  return m;
}

export class Overlays {
  readonly group = new THREE.Group();
  private readonly zone = new THREE.Group();
  private readonly meet: THREE.Group;
  private readonly meetRing: THREE.Mesh;
  private readonly meetFill: THREE.Mesh;
  private readonly aim: THREE.Group;
  private readonly crossing: THREE.Mesh;
  private readonly controlled: THREE.Mesh;
  private readonly landing: THREE.Mesh;
  private readonly runnerRings: THREE.Mesh[];

  constructor() {
    // ストライクゾーンの枠（本塁上、z = 0 の面）。
    const z = DEFAULT_ZONE;
    const w = z.halfWidth * 2;
    const h = z.top - z.bottom;
    const t = 0.012;
    const frame = overlay('#ffffff', 0.85);
    for (const [x, y, sx, sy] of [
      [0, z.bottom, w, t],
      [0, z.top, w, t],
      [-z.halfWidth, (z.bottom + z.top) / 2, t, h],
      [z.halfWidth, (z.bottom + z.top) / 2, t, h]
    ]) {
      const bar = mesh(new THREE.PlaneGeometry(sx, sy), frame, x, y, 0);
      bar.renderOrder = 5;
      this.zone.add(bar);
    }
    // 9分割の補助線。
    const thin = overlay('#ffffff', 0.25);
    for (const k of [1, 2]) {
      this.zone.add(mesh(new THREE.PlaneGeometry(t * 0.6, h), thin, -z.halfWidth + (w * k) / 3, (z.bottom + z.top) / 2, 0));
      this.zone.add(mesh(new THREE.PlaneGeometry(w, t * 0.6), thin, 0, z.bottom + (h * k) / 3, 0));
    }
    this.group.add(this.zone);

    // ミートカーソル：楕円の輪と薄い塗り。大きさは打者のミート能力と打撃モードで変わる。
    this.meet = new THREE.Group();
    this.meetRing = mesh(new THREE.RingGeometry(0.86, 1, 40), overlay(CURSOR_COLOR.meet, 0.95));
    this.meetFill = mesh(new THREE.CircleGeometry(0.86, 40), overlay(CURSOR_COLOR.meet, 0.22));
    this.meetRing.renderOrder = 6;
    this.meetFill.renderOrder = 6;
    const dot = mesh(new THREE.CircleGeometry(0.016, 12), overlay('#ffffff', 0.9));
    dot.renderOrder = 7;
    this.meet.add(this.meetFill, this.meetRing, dot);
    this.group.add(this.meet);

    // コースカーソル（投手側）。
    this.aim = new THREE.Group();
    const aimMat = overlay('#ff8a1a', 0.95);
    const ring = mesh(new THREE.RingGeometry(0.05, 0.065, 28), aimMat);
    const barH = mesh(new THREE.PlaneGeometry(0.2, 0.012), aimMat);
    const barV = mesh(new THREE.PlaneGeometry(0.012, 0.2), aimMat);
    for (const m of [ring, barH, barV]) m.renderOrder = 7;
    this.aim.add(ring, barH, barV);
    this.group.add(this.aim);

    // かんたん：投球の通過点の目印。
    this.crossing = mesh(new THREE.RingGeometry(0.03, 0.05, 20), overlay('#ffffff', 0.7));
    this.crossing.renderOrder = 7;
    this.group.add(this.crossing);

    this.controlled = flatRing(0.75, 1.0, '#ffe14d');
    this.landing = flatRing(0.4, 0.65, '#ff4d4d', 0.85);
    this.runnerRings = [0, 1, 2, 3].map(() => flatRing(0.7, 0.9, '#4dd9ff'));
    this.group.add(this.controlled, this.landing, ...this.runnerRings);
  }

  update(m: Match, time: number) {
    const humanBat = m.humanBatting;
    const humanPitch = m.humanPitching;
    const pitchPhase = m.phase === 'pre-pitch' || m.phase === 'windup' || m.phase === 'pitch';
    this.zone.visible = pitchPhase && (humanBat || humanPitch);

    // ミートカーソル（人が打つときだけ）。
    // かんたん打撃ではカーソルを出さない（タイミングだけで打つ）。
    this.meet.visible = pitchPhase && humanBat && !m.easyBatting;
    if (this.meet.visible) {
      const mode = m.buntStance ? 'bunt' : m.swingMode;
      const size = m.buntStance ? { halfW: 0.3, halfH: 0.18 } : cursorSize(currentBatter(m.state), m.swingMode);
      this.meet.position.set(m.batCursor.x, m.batCursor.y, 0);
      this.meetRing.scale.set(size.halfW, size.halfH, 1);
      this.meetFill.scale.set(size.halfW, size.halfH, 1);
      (this.meetRing.material as THREE.MeshBasicMaterial).color.set(CURSOR_COLOR[mode]);
      (this.meetFill.material as THREE.MeshBasicMaterial).color.set(CURSOR_COLOR[mode]);
      (this.meetFill.material as THREE.MeshBasicMaterial).opacity = m.swing ? 0.45 : 0.22;
    }

    // コースカーソル（人が投げるとき、投げるまで）。
    this.aim.visible = humanPitch && (m.phase === 'pre-pitch' || m.phase === 'windup');
    this.aim.position.set(m.aim.x, m.aim.y, 0);
    this.aim.rotation.z = time * 1.5;

    this.crossing.visible = humanBat && m.difficulty === 'easy' && m.phase === 'pitch' && !!m.pitch;
    if (this.crossing.visible) this.crossing.position.set(m.pitch!.plate.x, m.pitch!.plate.y, 0);

    // 守備：操作選手のマーカーと落下点。攻撃：指示する走者。
    const play = m.phase === 'play' ? m.play : null;
    this.controlled.visible = !!play && play.controlled >= 0;
    if (play && play.controlled >= 0) {
      const f = play.fielders[play.controlled];
      this.controlled.position.set(f.pos.x, 0.07, f.pos.z);
      this.controlled.scale.setScalar(1 + Math.sin(time * 8) * 0.08);
    }
    const land = play && play.controlled >= 0 && play.ballMode === 'live' && play.ball.bounces === 0 ? play.path.landing : null;
    this.landing.visible = !!land;
    if (land) this.landing.position.set(land.pos.x, 0.08, land.pos.z);

    const offense = play && m.isHuman(m.state.half === 'top' ? 0 : 1);
    this.runnerRings.forEach((ring, i) => {
      const r = play?.runners[i];
      const show = !!offense && !!r && r.state === 'active' && (play!.selectedRunner < 0 || play!.selectedRunner === i);
      ring.visible = show;
      if (show) {
        const p = PlaySim.runnerPos(r!.u);
        ring.position.set(p.x, 0.07, p.z);
      }
    });
  }
}
