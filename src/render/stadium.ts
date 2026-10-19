// Sky Park Stadium の見た目。寸法は core/field.ts のものを使う。
import * as THREE from 'three';
import { BASES, FENCE, FOUL_GROUND, fenceDistance, INFIELD_DIRT_CENTER, INFIELD_DIRT_RADIUS, MOUND, STADIUM_NAME } from '../core/field.ts';
import type { GameState } from '../core/gameState.ts';
import { score } from '../core/gameState.ts';
import { glowColor } from '../core/teams.ts';
import { Crowd, type Seat } from './crowd.ts';
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

const LINE_MAT = new THREE.MeshLambertMaterial({ color: LINE, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -16 });

function lineStrip(from: THREE.Vector3, to: THREE.Vector3, width = 0.12): THREE.Mesh {
  const len = from.distanceTo(to);
  const m = mesh(new THREE.BoxGeometry(width, 0.02, len), LINE_MAT, (from.x + to.x) / 2, 0.035, (from.z + to.z) / 2);
  m.rotation.y = Math.atan2(to.x - from.x, to.z - from.z);
  return m;
}

interface P2 {
  x: number;
  z: number;
}

const OUTFIELD_SEGMENTS = 60;
/** 観客席の段数・1段の奥行きと高さ（m）。 */
const ROWS = 16;
const ROW_DEPTH = 0.95;
const ROW_RISE = 0.5;
/** 観客の間隔（m）と、席が埋まっている割合。 */
const SEAT_GAP = 0.62;
const WALL_LOW = 1.4;
/** 中堅のバックスクリーンの幅の半分（m）。打者がボールを見やすいよう、ここには客を入れない。 */
const BACKSCREEN_HALF = 12;

/**
 * グラウンドの外周（core 座標）。打球の判定（core/field.ts の inFoulStands とフェンス）と同じ線で、
 * 左翼ポール → 外野フェンス → 右翼ポール → 一塁側の観客席 → バックネット → 三塁側の観客席 の順（上から見て時計回り）。
 * high は外野フェンス（高い壁）の点。
 */
function fieldBoundary(): { pts: P2[]; high: boolean[] } {
  const pts: P2[] = [];
  const high: boolean[] = [];
  for (let i = 0; i <= OUTFIELD_SEGMENTS; i++) {
    const a = -Math.PI / 4 + (i / OUTFIELD_SEGMENTS) * (Math.PI / 2);
    const r = fenceDistance(a);
    pts.push({ x: Math.sin(a) * r, z: Math.cos(a) * r });
    high.push(true);
  }
  // ファウルラインから FOUL_GROUND.side 離れた平行線が、本塁から FENCE.line + 4 の円・バックネットと交わる点。
  const k = FOUL_GROUND.side;
  const along = Math.sqrt((FENCE.line + 4) ** 2 - k * k);
  const corner = { x: (along + k) / Math.SQRT2, z: (along - k) / Math.SQRT2 };
  const back = { x: k * Math.SQRT2 - FOUL_GROUND.backstop, z: -FOUL_GROUND.backstop };
  for (const p of [corner, back, { x: -back.x, z: back.z }, { x: -corner.x, z: corner.z }]) {
    pts.push(p);
    high.push(false);
  }
  return { pts, high };
}

/** 閉じた折れ線を外側へ d だけずらす（角は留め継ぎ）。 */
function offsetLoop(pts: P2[], d: number): P2[] {
  const n = pts.length;
  const normal = (a: P2, b: P2): P2 => {
    const l = Math.hypot(b.x - a.x, b.z - a.z);
    // 時計回りなので、進行方向の左が外側。
    return { x: -(b.z - a.z) / l, z: (b.x - a.x) / l };
  };
  return pts.map((p, i) => {
    const n0 = normal(pts[(i - 1 + n) % n], p);
    const n1 = normal(p, pts[(i + 1) % n]);
    const mx = n0.x + n1.x;
    const mz = n0.z + n1.z;
    const ml = Math.hypot(mx, mz) || 1;
    const cos = Math.max(0.4, (mx / ml) * n1.x + (mz / ml) * n1.z);
    return { x: p.x + ((mx / ml) * d) / cos, z: p.z + ((mz / ml) * d) / cos };
  });
}

/** 平らな四角形・縦の四角形を三角形で積む。 */
class Quads {
  readonly pos: number[] = [];
  quad(a: THREE.Vector3Like, b: THREE.Vector3Like, c: THREE.Vector3Like, d: THREE.Vector3Like) {
    for (const p of [a, b, c, a, c, d]) this.pos.push(p.x, p.y, p.z);
  }
  /** 折れ線 inner・outer の間（高さはそれぞれ yi・yo）を帯にする。 */
  ribbon(inner: P2[], outer: P2[], yi: (i: number) => number, yo: (i: number) => number, closed = true) {
    const n = inner.length;
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const j = (i + 1) % n;
      this.quad(
        { x: inner[i].x, y: yi(i), z: inner[i].z },
        { x: inner[j].x, y: yi(j), z: inner[j].z },
        { x: outer[j].x, y: yo(j), z: outer[j].z },
        { x: outer[i].x, y: yo(i), z: outer[i].z }
      );
    }
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.computeVertexNormals();
    return g;
  }
}

/** 地面に貼る面。重なっても ちらつかないよう、order が大きいほど手前に描く。 */
function decal(color: string, order: number): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -order, polygonOffsetUnits: -order * 4 });
}

/** 球場を作って root（core の座標系）に入れる。観客を返す。 */
export function buildStadium(root: THREE.Object3D): Crowd {
  const { pts, high } = fieldBoundary();
  const n = pts.length;

  // 球場の外はコンクリート、グラウンドの中だけ芝。
  const base = mesh(new THREE.CircleGeometry(320, 64), mat('#8d949c'), 0, -0.05, 40);
  base.rotation.x = -Math.PI / 2;
  root.add(base);
  const shape = new THREE.Shape(pts.map((p) => new THREE.Vector2(p.x, -p.z)));
  const grassMap = grassTexture();
  grassMap.repeat.set(1 / 28, 1 / 28);
  const ground = mesh(new THREE.ShapeGeometry(shape), new THREE.MeshLambertMaterial({ map: grassMap }));
  ground.rotation.x = -Math.PI / 2;
  root.add(ground);

  // 外野フェンス沿いの土（ウォーニングトラック）。
  const arc = pts.slice(0, OUTFIELD_SEGMENTS + 1);
  const track = new Quads();
  track.ribbon(offsetLoop(pts, -4.5).slice(0, OUTFIELD_SEGMENTS + 1), arc, () => 0, () => 0, false);
  root.add(new THREE.Mesh(track.geometry(), decal(DIRT, 1)));

  // 内野の土・内野の芝・本塁まわり・マウンド。
  const dirt = mesh(new THREE.CircleGeometry(INFIELD_DIRT_RADIUS, 64), decal(DIRT, 1), INFIELD_DIRT_CENTER.x, 0.01, INFIELD_DIRT_CENTER.z);
  dirt.rotation.x = -Math.PI / 2;
  root.add(dirt);
  const infieldGrass = mesh(new THREE.PlaneGeometry(22, 22), decal(GRASS, 2), 0, 0.015, BASES[2].z / 2);
  infieldGrass.rotation.x = -Math.PI / 2;
  infieldGrass.rotation.z = Math.PI / 4;
  root.add(infieldGrass);
  const homeDirt = mesh(new THREE.CircleGeometry(4.2, 40), decal(DIRT, 3), 0, 0.02, 0);
  homeDirt.rotation.x = -Math.PI / 2;
  root.add(homeDirt);
  root.add(mesh(new THREE.CylinderGeometry(2.7, 2.9, 0.25, 32), mat(DIRT), MOUND.x, 0.12, MOUND.z));
  root.add(mesh(new THREE.BoxGeometry(0.6, 0.04, 0.15), mat(LINE), MOUND.x, 0.26, MOUND.z));

  // 塁と本塁。
  for (const b of [1, 2, 3]) {
    const bag = mesh(new THREE.BoxGeometry(0.38, 0.08, 0.38), mat(LINE), BASES[b].x, 0.06, BASES[b].z);
    bag.rotation.y = Math.PI / 4;
    root.add(bag);
  }
  const plateShape = new THREE.Shape();
  plateShape.moveTo(-0.216, 0.216);
  plateShape.lineTo(0.216, 0.216);
  plateShape.lineTo(0.216, 0);
  plateShape.lineTo(0, -0.216);
  plateShape.lineTo(-0.216, 0);
  plateShape.closePath();
  const plate = mesh(new THREE.ShapeGeometry(plateShape), decal(LINE, 4), 0, 0.04, 0);
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

  // 外周の壁：外野は高いフェンス（上端は黄色）、ファウル地域は低い壁。
  const wallH = (i: number) => (high[i] ? FENCE.height : WALL_LOW);
  const outerWall = offsetLoop(pts, 0.4);
  const walls = new Quads();
  walls.ribbon(pts, pts, () => 0, wallH);
  walls.ribbon(pts, outerWall, wallH, wallH);
  root.add(new THREE.Mesh(walls.geometry(), new THREE.MeshLambertMaterial({ color: '#1f5f8b', side: THREE.DoubleSide })));
  const rim = new Quads();
  rim.ribbon(arc, outerWall.slice(0, OUTFIELD_SEGMENTS + 1), () => FENCE.height + 0.02, () => FENCE.height + 0.02, false);
  root.add(new THREE.Mesh(rim.geometry(), new THREE.MeshLambertMaterial({ color: '#ffd54f', side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 })));
  for (const side of [-1, 1]) {
    const d = FENCE.line / Math.SQRT2;
    root.add(mesh(new THREE.CylinderGeometry(0.18, 0.18, 22, 8), mat('#ffd54f'), side * d, 11, d));
  }

  // 観客席：壁の外側に、外へ向かって上がる段を一周つなげる。段ごとに観客を座らせる。
  const seats: Seat[] = [];
  const steps = [new Quads(), new Quads()];
  const rowTop = (i: number, row: number) => wallH(i) + 0.4 + row * ROW_RISE;
  let inner = outerWall;
  for (let row = 0; row < ROWS; row++) {
    const outer = offsetLoop(pts, 0.4 + (row + 1) * ROW_DEPTH);
    const q = steps[row % 2];
    // 蹴上げ（前の段から立ち上がる面）と踏み面。
    q.ribbon(inner, inner, (i) => (row === 0 ? wallH(i) : rowTop(i, row - 1)), (i) => rowTop(i, row));
    q.ribbon(inner, outer, (i) => rowTop(i, row), (i) => rowTop(i, row));
    // 席：段の奥寄りに等間隔で。外野席は少し空きを多く。
    const mid = offsetLoop(pts, 0.4 + (row + 0.6) * ROW_DEPTH);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a = mid[i];
      const b = mid[j];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const outfield = high[i] && high[j];
      const fill = outfield ? 0.88 : 0.9;
      // グラウンドを向く（外側の法線の逆向き）。
      const yaw = Math.atan2(b.z - a.z, -(b.x - a.x));
      for (let t = SEAT_GAP / 2; t < len; t += SEAT_GAP) {
        if (Math.random() > fill) continue;
        const s = t / len;
        const x = a.x + (b.x - a.x) * s;
        if (outfield && Math.abs(x) < BACKSCREEN_HALF + 1) continue;
        seats.push({ x, z: a.z + (b.z - a.z) * s, y: rowTop(i, row) + (rowTop(j, row) - rowTop(i, row)) * s, yaw, outfield });
      }
    }
    inner = outer;
  }
  // 最上段の後ろの壁。
  const top = (i: number) => rowTop(i, ROWS - 1);
  steps[0].ribbon(inner, inner, () => 0, (i) => top(i) + 1.6);
  root.add(new THREE.Mesh(steps[0].geometry(), new THREE.MeshLambertMaterial({ color: '#9aa3ad', side: THREE.DoubleSide })));
  root.add(new THREE.Mesh(steps[1].geometry(), new THREE.MeshLambertMaterial({ color: '#86909b', side: THREE.DoubleSide })));
  const crowd = new Crowd(seats);
  root.add(crowd.group);

  // バックスクリーン：中堅の観客席の部分を濃い緑の壁でふさぐ。
  const screenTop = rowTop(OUTFIELD_SEGMENTS / 2, ROWS - 1) + 1.6;
  const screenDepth = 0.4 + ROWS * ROW_DEPTH;
  root.add(mesh(new THREE.BoxGeometry(BACKSCREEN_HALF * 2, screenTop, screenDepth), mat('#1d3b2c'), 0, screenTop / 2, FENCE.center + 0.4 + screenDepth / 2));

  // バックネット：本塁の後ろの壁沿いに張る。
  const front = offsetLoop(pts, -0.3);
  const toward = (p: P2, q: P2, len: number): P2 => {
    const l = Math.hypot(q.x - p.x, q.z - p.z);
    return { x: p.x + ((q.x - p.x) / l) * len, z: p.z + ((q.z - p.z) / l) * len };
  };
  // 外周の最後の4点が 一塁側の角・バックネットの両端・三塁側の角。
  const netLine = [toward(front[n - 2], front[n - 1], 14), front[n - 2], front[n - 3], toward(front[n - 3], front[n - 4], 14)];
  const net = new Quads();
  net.ribbon(netLine, netLine, () => WALL_LOW, () => 10, false);
  root.add(new THREE.Mesh(net.geometry(), new THREE.MeshBasicMaterial({ color: '#334', transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false })));
  return crowd;
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
    board.position.set(0, 23, 0);
    this.object.add(board);
    const frame = mesh(new THREE.BoxGeometry(42, 17, 1), mat('#263238'), 0, 23, 0.6);
    this.object.add(frame);
    // 中堅の観客席のすぐ後ろに立てる。
    for (const x of [-12, 12]) this.object.add(mesh(new THREE.BoxGeometry(1.2, 15, 1.2), mat('#37474f'), x, 7.5, 0.6));
    this.object.position.set(0, 0, 130);
    this.draw(null);
  }

  update(s: GameState | null) {
    const key = s ? JSON.stringify([s.teams.map((t) => [t.team.id, t.runsByInning, t.hits]), s.inning, s.half]) : '';
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
    // 延長に入ったら列を足し、9回を越えるときは列を詰める。
    const cols = Math.max(s.innings, s.inning);
    const x0 = 300;
    const w = Math.min(90, 560 / cols);
    g.font = `bold ${Math.round(Math.min(34, w * 0.72))}px sans-serif`;
    g.fillStyle = '#ffffff';
    for (let i = 0; i < cols; i++) g.fillText(String(i + 1), x0 + i * w, 120);
    g.fillText('R', x0 + cols * w + 30, 120);
    g.fillText('H', x0 + cols * w + 120, 120);
    s.teams.forEach((t, row) => {
      const y = 200 + row * 90;
      g.textAlign = 'left';
      g.fillStyle = glowColor(t.team.colors);
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
