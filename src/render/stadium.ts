// Sky Park Stadium の見た目。寸法は core/field.ts のものを使う。
import * as THREE from 'three';
import { BASES, FENCE, FOUL_GROUND, fenceDistance, INFIELD_DIRT_CENTER, INFIELD_DIRT_RADIUS, MOUND, STADIUM_NAME } from '../core/field.ts';
import type { GameState } from '../core/gameState.ts';
import { score } from '../core/gameState.ts';
import { mat, mesh } from './materials.ts';

const GRASS = '#4caf50';
const GRASS_DARK = '#43a047';
const DIRT = '#c98b55';
const LINE = '#ffffff';

/** 芝の刈り目（しま模様）のテクスチャ。 */
function grassTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d')!;
  for (let i = 0; i < 8; i++) {
    g.fillStyle = i % 2 ? GRASS : GRASS_DARK;
    g.fillRect(0, i * 32, 256, 32);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(12, 12);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 観客席の色の粒（客席に人がいるように見せる）。 */
function crowdTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#5b6b8c';
  g.fillRect(0, 0, 256, 64);
  const colors = ['#ff7a1a', '#1b3a8c', '#ffffff', '#b3122e', '#ffd54f', '#2b2b2b', '#8bc34a'];
  for (let i = 0; i < 900; i++) {
    g.fillStyle = colors[i % colors.length];
    g.fillRect(Math.random() * 256, Math.random() * 64, 2, 3);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.set(10, 1);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function lineStrip(from: THREE.Vector3, to: THREE.Vector3, width = 0.12): THREE.Mesh {
  const len = from.distanceTo(to);
  const m = mesh(new THREE.BoxGeometry(width, 0.02, len), mat(LINE), (from.x + to.x) / 2, 0.035, (from.z + to.z) / 2);
  m.rotation.y = Math.atan2(to.x - from.x, to.z - from.z);
  return m;
}

/** 球場を作って root（core の座標系）に入れる。 */
export function buildStadium(root: THREE.Object3D) {
  const ground = mesh(new THREE.CircleGeometry(170, 96), new THREE.MeshLambertMaterial({ map: grassTexture() }));
  ground.rotation.x = -Math.PI / 2;
  root.add(ground);

  // 内野の土・内野の芝・本塁まわり・マウンド。
  const dirt = mesh(new THREE.CircleGeometry(INFIELD_DIRT_RADIUS, 64), mat(DIRT), INFIELD_DIRT_CENTER.x, 0.01, INFIELD_DIRT_CENTER.z);
  dirt.rotation.x = -Math.PI / 2;
  root.add(dirt);
  const infieldGrass = mesh(new THREE.PlaneGeometry(22, 22), mat(GRASS), 0, 0.015, BASES[2].z / 2);
  infieldGrass.rotation.x = -Math.PI / 2;
  infieldGrass.rotation.z = Math.PI / 4;
  root.add(infieldGrass);
  const homeDirt = mesh(new THREE.CircleGeometry(4.2, 40), mat(DIRT), 0, 0.02, 0);
  homeDirt.rotation.x = -Math.PI / 2;
  root.add(homeDirt);
  root.add(mesh(new THREE.CylinderGeometry(2.7, 2.9, 0.25, 32), mat(DIRT), MOUND.x, 0.12, MOUND.z));
  root.add(mesh(new THREE.BoxGeometry(0.6, 0.04, 0.15), mat(LINE), MOUND.x, 0.26, MOUND.z));

  // 塁と本塁。
  for (const b of [1, 2, 3]) {
    const base = mesh(new THREE.BoxGeometry(0.38, 0.08, 0.38), mat(LINE), BASES[b].x, 0.06, BASES[b].z);
    base.rotation.y = Math.PI / 4;
    root.add(base);
  }
  const plateShape = new THREE.Shape();
  plateShape.moveTo(-0.216, 0.216);
  plateShape.lineTo(0.216, 0.216);
  plateShape.lineTo(0.216, 0);
  plateShape.lineTo(0, -0.216);
  plateShape.lineTo(-0.216, 0);
  plateShape.closePath();
  const plate = mesh(new THREE.ShapeGeometry(plateShape), mat(LINE), 0, 0.04, 0);
  plate.rotation.x = -Math.PI / 2;
  root.add(plate);

  // ファウルライン・バッターボックス。
  const end = FENCE.line;
  root.add(lineStrip(new THREE.Vector3(0, 0, 0), new THREE.Vector3(end / Math.SQRT2, 0, end / Math.SQRT2)));
  root.add(lineStrip(new THREE.Vector3(0, 0, 0), new THREE.Vector3(-end / Math.SQRT2, 0, end / Math.SQRT2)));
  for (const side of [-1, 1]) {
    const x = side * 0.9;
    const box = [
      [new THREE.Vector3(x - 0.6, 0, -0.9), new THREE.Vector3(x - 0.6, 0, 0.9)],
      [new THREE.Vector3(x + 0.6, 0, -0.9), new THREE.Vector3(x + 0.6, 0, 0.9)],
      [new THREE.Vector3(x - 0.6, 0, 0.9), new THREE.Vector3(x + 0.6, 0, 0.9)],
      [new THREE.Vector3(x - 0.6, 0, -0.9), new THREE.Vector3(x + 0.6, 0, -0.9)]
    ];
    for (const [a, b] of box) root.add(lineStrip(a, b, 0.06));
  }

  // 外野フェンス（両翼92m・中堅112m）と黄色い上端、ポール、観客席。
  const segments = 60;
  const crowd = new THREE.MeshLambertMaterial({ map: crowdTexture() });
  for (let i = 0; i < segments; i++) {
    const a0 = -Math.PI / 4 + (i / segments) * (Math.PI / 2);
    const a1 = -Math.PI / 4 + ((i + 1) / segments) * (Math.PI / 2);
    const r0 = fenceDistance(a0);
    const r1 = fenceDistance(a1);
    const p0 = new THREE.Vector3(Math.sin(a0) * r0, 0, Math.cos(a0) * r0);
    const p1 = new THREE.Vector3(Math.sin(a1) * r1, 0, Math.cos(a1) * r1);
    const len = p0.distanceTo(p1) + 0.05;
    const mid = p0.clone().add(p1).multiplyScalar(0.5);
    const yaw = Math.atan2(p1.x - p0.x, p1.z - p0.z);
    const wall = mesh(new THREE.BoxGeometry(0.4, FENCE.height, len), mat('#1f5f8b'), mid.x, FENCE.height / 2, mid.z);
    wall.rotation.y = yaw;
    root.add(wall);
    const top = mesh(new THREE.BoxGeometry(0.45, 0.15, len), mat('#ffd54f'), mid.x, FENCE.height + 0.07, mid.z);
    top.rotation.y = yaw;
    root.add(top);
    // 観客席：フェンスの外側に、外へ向かって上がる斜面を置く。
    const out = mid.clone().setY(0).normalize();
    const tilt = new THREE.Group();
    tilt.position.set(mid.x + out.x * 8, 5, mid.z + out.z * 8);
    tilt.rotation.y = yaw;
    const slope = mesh(new THREE.BoxGeometry(15, 0.6, len * 1.15), crowd);
    slope.rotation.z = -0.6;
    tilt.add(slope);
    root.add(tilt);
  }
  for (const side of [-1, 1]) {
    const d = FENCE.line / Math.SQRT2;
    root.add(mesh(new THREE.CylinderGeometry(0.15, 0.15, 14, 8), mat('#ffd54f'), side * d, 7, d));
  }

  // ファウルグラウンドの壁とバックネット。
  for (const side of [-1, 1]) {
    // ファウルラインから FOUL_GROUND.side 離れた平行線。
    const k = FOUL_GROUND.side / Math.SQRT2;
    const t = (FENCE.line - 6) / Math.SQRT2;
    const a = new THREE.Vector3(side * k, 0, -k);
    const b = new THREE.Vector3(side * (t + k), 0, t - k);
    const len = a.distanceTo(b);
    const wall = mesh(new THREE.BoxGeometry(0.4, 1.4, len), mat('#1f5f8b'), (a.x + b.x) / 2, 0.7, (a.z + b.z) / 2);
    wall.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
    root.add(wall);
    const seats = mesh(new THREE.BoxGeometry(10, 0.5, len), crowd, (a.x + b.x) / 2 + side * 6, 3, (a.z + b.z) / 2 - 4);
    seats.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
    seats.rotateOnAxis(new THREE.Vector3(0, 0, 1), side * 0.5);
    root.add(seats);
  }
  const back = mesh(new THREE.BoxGeometry(46, 1.4, 0.4), mat('#1f5f8b'), 0, 0.7, -FOUL_GROUND.backstop);
  root.add(back);
  const net = mesh(new THREE.PlaneGeometry(30, 9), new THREE.MeshBasicMaterial({ color: '#334', transparent: true, opacity: 0.25, side: THREE.DoubleSide }), 0, 5, -FOUL_GROUND.backstop);
  root.add(net);
}

/** スコアボード。文字が左右反転しないよう、鏡像にした root の外に置く。 */
export class Scoreboard {
  readonly object: THREE.Group;
  private readonly canvas: HTMLCanvasElement;
  private readonly texture: THREE.CanvasTexture;
  private last = '';

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024;
    this.canvas.height = 384;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.object = new THREE.Group();
    const board = mesh(new THREE.PlaneGeometry(40, 15), new THREE.MeshBasicMaterial({ map: this.texture }));
    board.rotation.y = Math.PI;
    board.position.set(0, 19, 0);
    this.object.add(board);
    const frame = mesh(new THREE.BoxGeometry(42, 17, 1), mat('#263238'), 0, 19, 0.6);
    this.object.add(frame);
    for (const x of [-12, 12]) this.object.add(mesh(new THREE.BoxGeometry(1.2, 12, 1.2), mat('#37474f'), x, 6, 0.6));
    this.object.position.set(0, 0, 128);
    this.draw(null);
  }

  update(s: GameState | null) {
    const key = s ? JSON.stringify([s.teams.map((t) => t.runsByInning), s.inning, s.half, s.teams.map((t) => t.hits)]) : '';
    if (key === this.last) return;
    this.last = key;
    this.draw(s);
  }

  private draw(s: GameState | null) {
    const g = this.canvas.getContext('2d')!;
    g.fillStyle = '#10302a';
    g.fillRect(0, 0, 1024, 384);
    g.font = 'bold 40px sans-serif';
    g.fillStyle = '#ffd54f';
    g.textAlign = 'center';
    g.fillText(STADIUM_NAME, 512, 52);
    if (!s) {
      this.texture.needsUpdate = true;
      return;
    }
    const cols = s.innings;
    const x0 = 300;
    const w = 90;
    g.font = 'bold 34px sans-serif';
    g.fillStyle = '#ffffff';
    for (let i = 0; i < cols; i++) g.fillText(String(i + 1), x0 + i * w, 120);
    g.fillText('R', x0 + cols * w + 30, 120);
    g.fillText('H', x0 + cols * w + 120, 120);
    s.teams.forEach((t, row) => {
      const y = 200 + row * 90;
      g.textAlign = 'left';
      g.fillStyle = t.team.colors.secondary === '#2b2b2b' ? '#ff8a80' : t.team.colors.secondary;
      g.fillText(t.team.abbr, 60, y);
      g.textAlign = 'center';
      g.fillStyle = '#ffffff';
      for (let i = 0; i < cols; i++) {
        const v = t.runsByInning[i];
        const live = i + 1 === s.inning && (row === 0 ? s.half === 'top' : s.half === 'bottom') && !s.over;
        g.fillStyle = live ? '#ffd54f' : '#ffffff';
        g.fillText(v === undefined ? (live ? '0' : '') : String(v), x0 + i * w, y);
      }
      g.fillStyle = '#ffd54f';
      g.fillText(String(score(s, row as 0 | 1)), x0 + cols * w + 30, y);
      g.fillStyle = '#ffffff';
      g.fillText(String(t.hits), x0 + cols * w + 120, y);
    });
    this.texture.needsUpdate = true;
  }
}
