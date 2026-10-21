// 各球団の本拠地の見た目。寸法は core/field.ts の Park のものを使い、色・屋根・飾りは球場 id ごとにここで決める。
import * as THREE from 'three';
import { BASES, DEFAULT_PARK, fenceDistance, INFIELD_DIRT_CENTER, INFIELD_DIRT_RADIUS, MOUND, type Park } from '../core/field.ts';
import type { GameState } from '../core/gameState.ts';
import { score } from '../core/gameState.ts';
import { glowColor } from '../core/teams.ts';
import { Crowd, type Seat } from './crowd.ts';
import { basic, mat, mesh } from './materials.ts';
import { canvasTexture, LEAVES, Props, Quads, tree } from './parts.ts';
import { castleTown, city, combine, desert, GROUND_RADIUS, highland, islands, mountainForest, SCENERY_Z, themePark } from './surroundings.ts';

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
/** 観客席の1段の奥行き（m）。 */
const ROW_DEPTH = 0.95;
/** 観客の間隔（m）。 */
const SEAT_GAP = 0.62;
const WALL_LOW = 1.4;
/** 最上段の後ろの壁が段より高い分（m）。 */
const BACK_WALL = 1.6;
/** 中堅のバックスクリーンの幅の半分（m）。打者がボールを見やすいよう、ここには客を入れない。 */
const BACKSCREEN_HALF = 12;

/**
 * グラウンドの外周（core 座標）。打球の判定（core/field.ts の inFoulStands とフェンス）と同じ線で、
 * 左翼ポール → 外野フェンス → 右翼ポール → 一塁側の観客席 → バックネット → 三塁側の観客席 の順（上から見て時計回り）。
 * high は外野フェンス（高い壁）の点。
 */
function fieldBoundary(park: Park): { pts: P2[]; high: boolean[] } {
  const pts: P2[] = [];
  const high: boolean[] = [];
  for (let i = 0; i <= OUTFIELD_SEGMENTS; i++) {
    const a = -Math.PI / 4 + (i / OUTFIELD_SEGMENTS) * (Math.PI / 2);
    const r = fenceDistance(a, park);
    pts.push({ x: Math.sin(a) * r, z: Math.cos(a) * r });
    high.push(true);
  }
  // ファウルラインから foul.side 離れた平行線が、本塁から（ポールまで + 4）の円・バックネットと交わる点。
  const k = park.foul.side;
  const corner = (line: number): P2 => {
    const along = Math.sqrt((line + 4) ** 2 - k * k);
    return { x: (along + k) / Math.SQRT2, z: (along - k) / Math.SQRT2 };
  };
  const right = corner(park.fence.right);
  const left = corner(park.fence.left);
  const back = { x: k * Math.SQRT2 - park.foul.backstop, z: -park.foul.backstop };
  for (const p of [right, back, { x: -back.x, z: back.z }, { x: -left.x, z: left.z }]) {
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

/** 地面に貼る面。重なっても ちらつかないよう、order が大きいほど手前に描く。 */
function decal(color: string, order: number): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -order, polygonOffsetUnits: -order * 4 });
}

/** ドームの屋根。 */
interface Roof {
  /** 屋根の膜・パネルの色と、骨組みの線の色。 */
  panel: string;
  line: string;
  /** 経線（縦）と緯線（横）の本数。diagonal は鉄骨のトラス（筋かい）。 */
  meridians: number;
  parallels: number;
  diagonal?: boolean;
  /** 屋根の高さ（壁の上端から頂上まで、m）。 */
  height: number;
  /** 屋根の付け根を一周する照明の色。 */
  glow: string;
  /** 屋根の内側の壁（観客席の上）の色と、その帯の色。 */
  wall: string;
  band: string;
  /** 屋根に沿わせる鉄骨の梁の本数。 */
  beams?: number;
  /** 屋根の中ほどに浮かぶ光の輪と、頂上の天窓。 */
  ring?: string;
  /** 屋根に桜の花びらの模様を散らす。 */
  petals?: string;
  /** 屋根に小さな明かりを星のように散らす。 */
  stars?: string;
  /** 開閉式。試合ごとに、開いているか閉じているかが変わる（開いていれば中央が空く）。 */
  retractable?: boolean;
}

/** 球場ごとの見た目。 */
interface Look {
  /** 外野フェンス・ファウル地域の壁、フェンスの上端、ポール。 */
  wall: string;
  rim: string;
  pole: string;
  /** 観客席の段の色（row 段目、seg 番目の区間）。 */
  seat: (row: number, seg: number, outfield: boolean) => string;
  /** 最上段の後ろの壁・バックスクリーン・球場の外の地面・ウォーニングトラック。 */
  back: string;
  screen: string;
  ground: string;
  track: string;
  /** 内野・外野の観客席の段数、1段の高さ（m）、席が埋まっている割合。 */
  rows: number;
  outfieldRows: number;
  rise: number;
  fill: number;
  sky: string;
  roof?: Roof;
  /** 観客の明るさ（省略は 1 = ふつう）。下げると客席が暗くなり、シルエットだけ見える。 */
  crowdLight?: number;
  /** 飾りを足す。毎フレームの動きがあれば関数を返す。 */
  decorate?: (s: Shell) => ((dt: number, time: number) => void) | void;
}

/** 飾りを置くときに使う、作りかけの球場の情報。 */
interface Shell {
  group: THREE.Group;
  park: Park;
  look: Look;
  /** 区間ごとの最上段の後ろの壁の位置（区間の始点）と、その上端の高さ。 */
  rim: { p: P2; top: number; outfield: boolean }[];
  /** 観客の席。 */
  seats: Seat[];
  /** 球場全体を囲む円（上から見て）。 */
  center: P2;
  radius: number;
  scoreboardZ: number;
}

const gray = (row: number) => (row % 2 ? '#86909b' : '#9aa3ad');
const lerpColor = (a: string, b: string, t: number) => '#' + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString();

const LOOKS: Record<string, Look> = {
  skypark: {
    wall: '#1f5f8b',
    rim: '#ffd54f',
    pole: '#ffd54f',
    seat: gray,
    back: '#9aa3ad',
    screen: '#1d3b2c',
    ground: '#7fae5a',
    track: DIRT,
    rows: 16,
    outfieldRows: 16,
    rise: 0.5,
    fill: 0.9,
    sky: '#8fd3ff',
    // 高原の草原：遠くに雪山、まわりに丘と風車と羊。
    decorate: highland
  },
  // 花桜ドーム：白い膜屋根に桜色の骨組み。席は桜色と白のブロック、屋根には光の輪と天窓、ドームの中を花びらが舞う。
  hanazakura: {
    wall: '#6e3550',
    rim: '#f0c6cf',
    pole: '#f7d9e0',
    seat: (row, seg, outfield) => {
      const pink = Math.floor(seg / (outfield ? 6 : 1)) % 2 === 0;
      return lerpColor(pink ? '#e8a7ba' : '#f6eef1', '#6e3550', row % 2 ? 0.08 : 0);
    },
    back: '#f3e6ea',
    screen: '#4a2338',
    ground: '#d9cfd3',
    track: '#c99a7f',
    rows: 16,
    outfieldRows: 16,
    rise: 0.5,
    fill: 0.92,
    sky: '#2a1d2b',
    roof: { panel: '#f8f2f3', line: '#e6a3b6', meridians: 32, parallels: 7, height: 48, glow: '#ff9ec0', wall: '#f1e4e8', band: '#c48a9a', ring: '#ffc4d6', petals: '#f4c6d3' },
    decorate: sakura
  },
  // 神山国ドーム：鋼鉄のトラスを張りめぐらせた屋根。梁と柱がむき出しで、紺と黄色の差し色。
  kamiyama: {
    wall: '#1f2a44',
    rim: '#f2c300',
    pole: '#f2c300',
    seat: (row, _seg, outfield) => (outfield ? (row % 2 ? '#3b4660' : '#434f6b') : row < 6 ? (row % 2 ? '#5c6676' : '#677283') : row % 2 ? '#3b4660' : '#434f6b'),
    back: '#5d6670',
    screen: '#141b2c',
    ground: '#7c838b',
    track: DIRT,
    rows: 16,
    outfieldRows: 16,
    rise: 0.5,
    fill: 0.9,
    sky: '#1b2028',
    roof: { panel: '#a4acb5', line: '#39414c', meridians: 40, parallels: 11, diagonal: true, height: 44, glow: '#fff2b0', wall: '#6f7882', band: '#f2c300', beams: 12 }
  },
  // じょがわドーム：落ち着いた生成りの屋根と木の色の席。広い球場に段も多め。
  jogawa: {
    wall: '#2f2a28',
    rim: '#b08d57',
    pole: '#d9c9a3',
    seat: (row) => (row % 2 ? '#6e5243' : '#7b5e4c'),
    back: '#8a7a6a',
    screen: '#1f2420',
    ground: '#9a928a',
    track: '#b58a62',
    rows: 18,
    outfieldRows: 18,
    rise: 0.5,
    fill: 0.88,
    sky: '#2a2622',
    roof: { panel: '#ece6da', line: '#d2c8b6', meridians: 18, parallels: 5, height: 52, glow: '#ffe7c2', wall: '#d6cdbd', band: '#8f2f2f' }
  },
  // マイカイスタジアム：屋外。ツタの外野フェンス、植え込みのあるバックスクリーン、まわりは木立ち。
  maikai: {
    wall: '#2f5d2a',
    rim: '#a4d65e',
    pole: '#f6faf2',
    seat: (row, seg) => (seg % 9 === 4 ? '#3f8f2f' : row % 2 ? '#7d8b79' : '#8b9886'),
    back: '#a0a89a',
    screen: '#2e6b22',
    ground: '#5d8f45',
    track: DIRT,
    rows: 15,
    outfieldRows: 13,
    rise: 0.5,
    fill: 0.88,
    sky: '#8fd3ff',
    // 山あいの森：重なる山並みと、外に広がる針葉樹の森。
    decorate: combine(greenery, mountainForest)
  },
  // ファクロムスタジアム：狭い敷地に急な段をぎっしり積んだ、客の多い球場。上段は銀色、照明塔つき。
  facrom: {
    wall: '#0a1a4a',
    rim: '#b8c2d6',
    pole: '#eef1f7',
    seat: (row) => (row < 14 ? (row % 2 ? '#2a3760' : '#33416d') : row % 2 ? '#8e99b0' : '#9ea8bd'),
    back: '#5b6478',
    screen: '#0b1330',
    ground: '#5a5e64',
    track: DIRT,
    rows: 24,
    outfieldRows: 20,
    rise: 0.62,
    fill: 0.985,
    sky: '#8fd3ff',
    // 都会のど真ん中：高層ビルと看板、観客席の外をまわる高架の電車。
    decorate: combine(lightTowers, city)
  },
  // スマーリンズスタジアム：海辺の球場。外野席は低く、その先は砂浜と海。帆の形の屋根、灯台、ヨット。
  smarlins: {
    wall: '#2f7fae',
    rim: '#f9fdff',
    pole: '#f9fdff',
    seat: (row, _seg, outfield) => lerpColor('#d6f1fb', '#2f78a8', row / (outfield ? 5 : 15)),
    back: '#e7f4f8',
    screen: '#1e5a7a',
    ground: '#e9d6a6',
    track: '#e3c992',
    rows: 15,
    outfieldRows: 5,
    rise: 0.5,
    fill: 0.9,
    sky: '#a7e3ff',
    decorate: combine(seaside, islands)
  },
  // 寛ブドーム：とにかく広い。白い大屋根にチームカラーの橙の骨組みと光の帯、段も多い。
  kanbu: {
    wall: '#1a1a1a',
    rim: '#f5a300',
    pole: '#f5a300',
    seat: (row, seg, outfield) => (outfield ? (row % 2 ? '#c27f00' : '#d38c00') : seg % 7 === 3 ? '#2a2a2a' : row % 2 ? '#8c939b' : '#99a0a8'),
    back: '#b9bec4',
    screen: '#141414',
    ground: '#8d949c',
    track: DIRT,
    rows: 20,
    outfieldRows: 18,
    rise: 0.5,
    fill: 0.93,
    sky: '#24211c',
    roof: { panel: '#f4f1ea', line: '#f0b33c', meridians: 48, parallels: 9, height: 58, glow: '#ffd27a', wall: '#e2ddd3', band: '#f5a300', ring: '#ffe3a6' }
  },
  // 万山ドームスタジアム：漆黒の屋根に小さな明かりがぽつぽつ。開閉式で、開いている日は夜空が見える。
  manyama: {
    wall: '#111111',
    rim: '#b8962e',
    pole: '#b8962e',
    seat: (row) => (row % 2 ? '#1e1e22' : '#26262b'),
    back: '#161618',
    screen: '#0a0a0a',
    ground: '#2c2c30',
    track: '#8a6a4a',
    rows: 17,
    outfieldRows: 16,
    rise: 0.52,
    fill: 0.9,
    sky: '#07080d',
    roof: { panel: '#0d0d10', line: '#1d1d24', meridians: 28, parallels: 6, height: 46, glow: '#b8962e', wall: '#121215', band: '#3a2f12', stars: '#ffe9b0', retractable: true, beams: 8 },
    // 客席は人がいるのに、ほぼ真っ暗。ところどころの小さな明かりと、最上段の縁の常夜灯だけが灯る。
    crowdLight: 0.018,
    decorate: darkStands
  },
  // オネタールスタジアム：一体感の球場。観客席の上をチームの旗がぐるりと囲む。
  onetar: {
    wall: '#2e7d6b',
    rim: '#f2e8cf',
    pole: '#f2e8cf',
    seat: (row, seg) => (Math.floor(seg / 3) % 2 ? (row % 2 ? '#3f8f7c' : '#4a9a86') : row % 2 ? '#d9cfb4' : '#e4dbc2'),
    back: '#cfc6ad',
    screen: '#1f4f44',
    ground: '#8e9878',
    track: DIRT,
    rows: 16,
    outfieldRows: 15,
    rise: 0.5,
    fill: 0.92,
    sky: '#8fd3ff',
    // 城下町：石垣の上の天守閣、五重塔、瓦屋根の町並み。
    decorate: combine((s: Shell) => flags(s, ['#2e7d6b', '#f2e8cf']), castleTown)
  },
  // サックスターズスタジアム：照明塔と、バックスクリーンの大きな星。
  sackstars: {
    wall: '#3a4fa8',
    rim: '#f7c948',
    pole: '#f7c948',
    seat: (row) => (row % 2 ? '#4a5fb3' : '#5669bb'),
    back: '#a9b3d6',
    screen: '#1d2a66',
    ground: '#c98d5a',
    track: DIRT,
    rows: 16,
    outfieldRows: 14,
    rise: 0.5,
    fill: 0.86,
    sky: '#8fd3ff',
    // 荒野：赤い台地とサボテン。
    decorate: combine(lightTowers, desert, (s: Shell) => {
      emblem(s, (g) => {
        g.fillStyle = '#f7c948';
        g.beginPath();
        for (let k = 0; k < 10; k++) {
          const r = k % 2 ? 95 : 230;
          const a = (k / 10) * Math.PI * 2 - Math.PI / 2;
          g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        g.fill();
      });
    })
  },
  // メリースタジアム：にぎやかな色の席と、外野の向こうの観覧車。
  merry: {
    wall: '#3b2a5a',
    rim: '#d6457a',
    pole: '#ffe1ec',
    seat: (_row, seg) => ['#e76f9a', '#f2b544', '#6cc3d5', '#9b7fd1'][Math.floor(seg / 4) % 4],
    back: '#f3dbe5',
    screen: '#2a1d40',
    ground: '#d9cdb5',
    track: DIRT,
    rows: 15,
    outfieldRows: 13,
    rise: 0.5,
    fill: 0.8,
    sky: '#9ad9ff',
    // テーマパーク：観覧車、城、ジェットコースター、メリーゴーラウンド、フリーフォール、熱気球。
    decorate: combine(ferrisWheel, themePark)
  },
  // 金ノダンクドーム：くすんだ金色の屋根の、こぢんまりしたドーム。
  kanenodunk: {
    wall: '#2d2d2d',
    rim: '#c9a640',
    pole: '#c9a640',
    seat: (row) => (row % 2 ? '#7a6a45' : '#857550'),
    back: '#a39272',
    screen: '#1d1b16',
    ground: '#7c7668',
    track: DIRT,
    rows: 14,
    outfieldRows: 13,
    rise: 0.5,
    fill: 0.78,
    sky: '#221e14',
    roof: { panel: '#d8c9a0', line: '#9c8550', meridians: 20, parallels: 5, height: 42, glow: '#ffe2a0', wall: '#bfae86', band: '#8a6d1f' }
  }
};

const lookOf = (park: Park) => LOOKS[park.id] ?? LOOKS.skypark;

/** 組み上がった球場。 */
export interface Stadium {
  park: Park;
  group: THREE.Group;
  crowd: Crowd;
  /** 背景（空、ドームなら屋根の暗がり）の色。 */
  sky: string;
  /** スコアボードを立てる位置（core の z）と、その前の観客席の高さ。 */
  scoreboard: { z: number; standTop: number };
  update(dt: number): void;
  dispose(): void;
}

/** 球場を作る。core の座標系の group に入れて返す（表示するときは x を反転した root に入れる）。 */
export function buildStadium(park: Park = DEFAULT_PARK): Stadium {
  const look = lookOf(park);
  const group = new THREE.Group();
  const { pts, high } = fieldBoundary(park);
  const n = pts.length;
  const segOutfield = (i: number) => high[i] && high[(i + 1) % n];
  const rowsOf = (i: number) => (segOutfield(i) ? look.outfieldRows : look.rows);
  const maxRows = Math.max(look.rows, look.outfieldRows);
  const wallH = (i: number) => (high[i] ? park.fence.height : WALL_LOW);
  const rowTop = (i: number, row: number) => wallH(i) + 0.4 + row * look.rise;
  const loops: P2[][] = [];
  for (let r = 0; r <= maxRows; r++) loops.push(offsetLoop(pts, 0.4 + r * ROW_DEPTH));
  // ドームは屋根の付け根の床に合わせて、後ろの壁の高さをそろえる。
  let highest = 0;
  for (let i = 0; i < n; i++) highest = Math.max(highest, rowTop(i, rowsOf(i) - 1), rowTop((i + 1) % n, rowsOf(i) - 1));
  const domeFloor = highest + BACK_WALL;
  const backTop = (i: number, rows: number) => (look.roof ? domeFloor : rowTop(i, rows - 1) + BACK_WALL);

  // 球場の外の地面と、グラウンドの中だけ芝。
  // 海辺の球場は、地面のかわりに砂浜と海を敷く（seaside）。
  if (look.decorate !== seaside) {
    const base = mesh(new THREE.CircleGeometry(GROUND_RADIUS, 64), mat(look.ground), 0, -0.05, SCENERY_Z);
    base.rotation.x = -Math.PI / 2;
    group.add(base);
  }
  const shape = new THREE.Shape(pts.map((p) => new THREE.Vector2(p.x, -p.z)));
  const grassMap = grassTexture();
  grassMap.repeat.set(1 / 28, 1 / 28);
  const ground = mesh(new THREE.ShapeGeometry(shape), new THREE.MeshLambertMaterial({ map: grassMap }));
  ground.rotation.x = -Math.PI / 2;
  group.add(ground);

  // 外野フェンス沿いの土（ウォーニングトラック）。
  const arc = pts.slice(0, OUTFIELD_SEGMENTS + 1);
  const track = new Quads();
  track.ribbon(offsetLoop(pts, -4.5).slice(0, OUTFIELD_SEGMENTS + 1), arc, () => 0, () => 0, false);
  group.add(new THREE.Mesh(track.geometry(), decal(look.track, 1)));

  // 内野の土・内野の芝・本塁まわり・マウンド。
  const dirt = mesh(new THREE.CircleGeometry(INFIELD_DIRT_RADIUS, 64), decal(DIRT, 1), INFIELD_DIRT_CENTER.x, 0.01, INFIELD_DIRT_CENTER.z);
  dirt.rotation.x = -Math.PI / 2;
  group.add(dirt);
  const infieldGrass = mesh(new THREE.PlaneGeometry(22, 22), decal(GRASS, 2), 0, 0.015, BASES[2].z / 2);
  infieldGrass.rotation.x = -Math.PI / 2;
  infieldGrass.rotation.z = Math.PI / 4;
  group.add(infieldGrass);
  const homeDirt = mesh(new THREE.CircleGeometry(4.2, 40), decal(DIRT, 3), 0, 0.02, 0);
  homeDirt.rotation.x = -Math.PI / 2;
  group.add(homeDirt);
  group.add(mesh(new THREE.CylinderGeometry(2.7, 2.9, 0.25, 32), mat(DIRT), MOUND.x, 0.12, MOUND.z));
  group.add(mesh(new THREE.BoxGeometry(0.6, 0.04, 0.15), mat(LINE), MOUND.x, 0.26, MOUND.z));

  // 塁と本塁。
  for (const b of [1, 2, 3]) {
    const bag = mesh(new THREE.BoxGeometry(0.38, 0.08, 0.38), mat(LINE), BASES[b].x, 0.06, BASES[b].z);
    bag.rotation.y = Math.PI / 4;
    group.add(bag);
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
  group.add(plate);

  // ファウルライン・バッターボックス。
  for (const side of [-1, 1]) {
    const end = side < 0 ? park.fence.left : park.fence.right;
    group.add(lineStrip(new THREE.Vector3(0, 0, 0), new THREE.Vector3((side * end) / Math.SQRT2, 0, end / Math.SQRT2)));
  }
  for (const side of [-1, 1]) {
    const x = side * 0.9;
    const box = [
      [new THREE.Vector3(x - 0.6, 0, -0.9), new THREE.Vector3(x - 0.6, 0, 0.9)],
      [new THREE.Vector3(x + 0.6, 0, -0.9), new THREE.Vector3(x + 0.6, 0, 0.9)],
      [new THREE.Vector3(x - 0.6, 0, 0.9), new THREE.Vector3(x + 0.6, 0, 0.9)],
      [new THREE.Vector3(x - 0.6, 0, -0.9), new THREE.Vector3(x + 0.6, 0, -0.9)]
    ];
    for (const [a, b] of box) group.add(lineStrip(a, b, 0.06));
  }

  // 外周の壁：外野は高いフェンス（上端に色の帯）、ファウル地域は低い壁。
  const outerWall = loops[0];
  const walls = new Quads();
  walls.ribbon(pts, pts, () => 0, wallH);
  walls.ribbon(pts, outerWall, wallH, wallH);
  group.add(new THREE.Mesh(walls.geometry(), new THREE.MeshLambertMaterial({ color: look.wall, side: THREE.DoubleSide })));
  const rim = new Quads();
  rim.ribbon(arc, outerWall.slice(0, OUTFIELD_SEGMENTS + 1), () => park.fence.height + 0.02, () => park.fence.height + 0.02, false);
  group.add(new THREE.Mesh(rim.geometry(), new THREE.MeshLambertMaterial({ color: look.rim, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 })));
  for (const side of [-1, 1]) {
    const d = (side < 0 ? park.fence.left : park.fence.right) / Math.SQRT2;
    group.add(mesh(new THREE.CylinderGeometry(0.18, 0.18, 22, 8), mat(look.pole), side * d, 11, d));
  }

  // 観客席：壁の外側に、外へ向かって上がる段を一周つなげる（外野と内野で段数が違ってもよい）。段ごとに観客を座らせる。
  const seats: Seat[] = [];
  const steps = new Quads();
  const back = new Quads();
  const color = new THREE.Color();
  const outfieldFill = look.fill - 0.02;
  const mids: P2[][] = [];
  for (let row = 0; row < maxRows; row++) mids.push(offsetLoop(pts, 0.4 + (row + 0.6) * ROW_DEPTH));
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const rows = rowsOf(i);
    const outfield = segOutfield(i);
    for (let row = 0; row < rows; row++) {
      const inner = loops[row];
      const outer = loops[row + 1];
      const lo = (k: number) => (row === 0 ? wallH(k) : rowTop(k, row - 1));
      const c = color.set(look.seat(row, i, outfield));
      // 蹴上げ（前の段から立ち上がる面）と踏み面。
      steps.quad({ x: inner[i].x, y: lo(i), z: inner[i].z }, { x: inner[j].x, y: lo(j), z: inner[j].z }, { x: inner[j].x, y: rowTop(j, row), z: inner[j].z }, { x: inner[i].x, y: rowTop(i, row), z: inner[i].z }, c);
      steps.quad({ x: inner[i].x, y: rowTop(i, row), z: inner[i].z }, { x: inner[j].x, y: rowTop(j, row), z: inner[j].z }, { x: outer[j].x, y: rowTop(j, row), z: outer[j].z }, { x: outer[i].x, y: rowTop(i, row), z: outer[i].z }, c);
      // 席：段の奥寄りに等間隔で。外野席は少し空きを多く。
      const a = mids[row][i];
      const b = mids[row][j];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const fill = outfield ? outfieldFill : look.fill;
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
    // 最上段の後ろの壁。
    const o = loops[rows];
    back.quad({ x: o[i].x, y: 0, z: o[i].z }, { x: o[j].x, y: 0, z: o[j].z }, { x: o[j].x, y: backTop(j, rows), z: o[j].z }, { x: o[i].x, y: backTop(i, rows), z: o[i].z });
    // 段数が変わる境目は、横の壁でふさぐ。
    const prev = rowsOf((i - 1 + n) % n);
    if (prev !== rows) {
      const [few, many] = prev < rows ? [prev, rows] : [rows, prev];
      const p = loops[few][i];
      const q = loops[many][i];
      back.quad({ x: p.x, y: 0, z: p.z }, { x: q.x, y: 0, z: q.z }, { x: q.x, y: backTop(i, many), z: q.z }, { x: p.x, y: backTop(i, few), z: p.z });
    }
  }
  group.add(new THREE.Mesh(steps.geometry(), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })));
  group.add(new THREE.Mesh(back.geometry(), new THREE.MeshLambertMaterial({ color: look.back, side: THREE.DoubleSide })));
  const crowd = new Crowd(seats);
  if (look.crowdLight !== undefined) crowd.dim(look.crowdLight);
  group.add(crowd.group);

  // バックスクリーン：中堅の観客席の部分を壁でふさぐ。
  const mid = OUTFIELD_SEGMENTS / 2;
  const screenTop = backTop(mid, look.outfieldRows);
  const screenDepth = 0.4 + look.outfieldRows * ROW_DEPTH;
  group.add(mesh(new THREE.BoxGeometry(BACKSCREEN_HALF * 2, screenTop, screenDepth), mat(look.screen), 0, screenTop / 2, park.fence.center + 0.4 + screenDepth / 2));

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
  group.add(new THREE.Mesh(net.geometry(), new THREE.MeshBasicMaterial({ color: '#334', transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false })));

  // 飾り・屋根のための情報：後ろの壁の位置、全体を囲む円、スコアボードの位置。
  const rimPts = pts.map((_, i) => ({ p: loops[rowsOf(i)][i], top: backTop(i, rowsOf(i)), outfield: segOutfield(i) }));
  const scoreboardZ = park.fence.center + 0.4 + look.outfieldRows * ROW_DEPTH + 2.4;
  let minZ = Infinity;
  let maxZ = scoreboardZ + 2;
  for (const { p } of rimPts) {
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  const center = { x: 0, z: (minZ + maxZ) / 2 };
  let radius = Math.hypot(22, scoreboardZ + 2 - center.z);
  for (const { p } of rimPts) radius = Math.max(radius, Math.hypot(p.x - center.x, p.z - center.z));
  radius += 5;
  const shell: Shell = { group, park, look, rim: rimPts, seats, center, radius, scoreboardZ };
  const standTop = backTop(mid, look.outfieldRows);
  if (look.roof) buildRoof(shell, look.roof, domeFloor);
  const animate = look.decorate?.(shell);
  let time = 0;
  return {
    park,
    group,
    crowd,
    sky: look.sky,
    scoreboard: { z: scoreboardZ, standTop },
    update(dt: number) {
      time += dt;
      crowd.update(dt);
      animate?.(dt, time);
    },
    dispose() {
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        for (const x of Array.isArray(m.material) ? m.material : m.material ? [m.material] : []) {
          (x as THREE.MeshLambertMaterial).map?.dispose();
          x.dispose();
        }
      });
    }
  };
}

/** ドームの屋根：観客席の上の床と壁、半球の屋根、付け根の照明。屋根は内側からだけ見える。 */
function buildRoof(s: Shell, roof: Roof, floorY: number) {
  const { center, radius: R } = s;
  const rimY = floorY + 20;
  // 観客席の後ろから屋根の壁までの床（後ろの壁の上端の高さ）。
  const ring = new THREE.Shape();
  ring.absarc(center.x, -center.z, R, 0, Math.PI * 2, false);
  ring.holes.push(new THREE.Path(s.rim.map(({ p }) => new THREE.Vector2(p.x, -p.z))));
  const floor = mesh(new THREE.ShapeGeometry(ring, 48), new THREE.MeshLambertMaterial({ color: roof.wall, side: THREE.DoubleSide }), 0, floorY, 0);
  floor.rotation.x = -Math.PI / 2;
  s.group.add(floor);

  const wallTex = canvasTexture(1024, 128, (g) => {
    g.fillStyle = roof.wall;
    g.fillRect(0, 0, 1024, 128);
    g.fillStyle = roof.band;
    g.fillRect(0, 52, 1024, 18);
    g.fillStyle = 'rgba(0,0,0,0.12)';
    for (let x = 0; x < 1024; x += 32) g.fillRect(x, 0, 2, 128);
  });
  wallTex.wrapS = THREE.RepeatWrapping;
  wallTex.repeat.set(6, 1);
  const wall = mesh(new THREE.CylinderGeometry(R, R, rimY, 96, 1, true), new THREE.MeshBasicMaterial({ map: wallTex, side: THREE.BackSide }), center.x, rimY / 2, center.z);
  s.group.add(wall);

  const roofTex = canvasTexture(2048, 512, (g) => {
    const grad = g.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, roof.panel);
    grad.addColorStop(1, lerpColor(roof.panel, '#000000', 0.18));
    g.fillStyle = grad;
    g.fillRect(0, 0, 2048, 512);
    if (roof.petals) {
      g.fillStyle = roof.petals;
      for (let i = 0; i < 180; i++) {
        g.save();
        g.translate(Math.random() * 2048, 40 + Math.random() * 460);
        g.rotate(Math.random() * Math.PI);
        g.beginPath();
        g.ellipse(0, 0, 6, 3, 0, 0, Math.PI * 2);
        g.fill();
        g.restore();
      }
    }
    if (roof.stars) {
      g.fillStyle = roof.stars;
      for (let i = 0; i < 420; i++) {
        g.globalAlpha = 0.25 + Math.random() * 0.75;
        g.fillRect(Math.random() * 2048, 20 + Math.random() * 480, 2 + Math.random() * 2, 2 + Math.random() * 2);
      }
      g.globalAlpha = 1;
    }
    g.strokeStyle = roof.line;
    g.lineWidth = roof.diagonal ? 5 : 3;
    const dx = 2048 / roof.meridians;
    const dy = 512 / roof.parallels;
    g.beginPath();
    for (let i = 0; i <= roof.meridians; i++) {
      g.moveTo(i * dx, 0);
      g.lineTo(i * dx, 512);
    }
    for (let j = 1; j <= roof.parallels; j++) {
      g.moveTo(0, j * dy);
      g.lineTo(2048, j * dy);
    }
    if (roof.diagonal) {
      for (let i = 0; i < roof.meridians; i++) {
        for (let j = 0; j < roof.parallels; j++) {
          g.moveTo(i * dx, j * dy);
          g.lineTo((i + 1) * dx, (j + 1) * dy);
          g.moveTo((i + 1) * dx, j * dy);
          g.lineTo(i * dx, (j + 1) * dy);
        }
      }
    }
    g.stroke();
  });
  roofTex.wrapS = THREE.RepeatWrapping;
  // 屋根と壁は内向きで、半球ライトの地面の色（緑）に染まってしまうので、照明を受けない素材で描く（陰影はテクスチャに付ける）。
  // 開閉式の屋根が開いているときは、頂上のまわりが空いて夜空が見える。
  const opening = roof.retractable && Math.random() < 0.5 ? 0.62 : 0;
  const cap = mesh(new THREE.SphereGeometry(1, 96, 32, 0, Math.PI * 2, opening, Math.PI / 2 - opening), new THREE.MeshBasicMaterial({ map: roofTex, side: THREE.BackSide }), center.x, rimY, center.z);
  cap.scale.set(R, roof.height, R);
  s.group.add(cap);

  // 屋根の付け根を一周する照明。
  const glow = mesh(new THREE.TorusGeometry(R - 0.8, 0.45, 8, 160), basic(roof.glow), center.x, rimY - 0.4, center.z);
  glow.rotation.x = Math.PI / 2;
  s.group.add(glow);
  /** 屋根の内側の、頂上からの角度 th（ラジアン）・方位 ph の点。 */
  const onRoof = (th: number, ph: number, k = 0.985) => new THREE.Vector3(center.x + Math.sin(th) * Math.cos(ph) * R * k, rimY + Math.cos(th) * roof.height * k, center.z + Math.sin(th) * Math.sin(ph) * R * k);
  if (opening) {
    // 開いた屋根の縁に沿う明かり。
    const edge = mesh(new THREE.TorusGeometry(Math.sin(opening) * R * 0.99, 0.5, 8, 160), basic(roof.glow), center.x, rimY + Math.cos(opening) * roof.height * 0.99, center.z);
    edge.rotation.x = Math.PI / 2;
    s.group.add(edge);
  }
  if (roof.ring && !opening) {
    const th = 0.95;
    const halo = mesh(new THREE.TorusGeometry(Math.sin(th) * R * 0.97, 0.6, 8, 160), basic(roof.ring), center.x, rimY + Math.cos(th) * roof.height * 0.97, center.z);
    halo.rotation.x = Math.PI / 2;
    s.group.add(halo);
    const sky = mesh(new THREE.CircleGeometry(R * 0.14, 48), new THREE.MeshBasicMaterial({ color: roof.ring, side: THREE.DoubleSide }), center.x, rimY + roof.height * 0.975, center.z);
    sky.rotation.x = Math.PI / 2;
    s.group.add(sky);
  }
  if (roof.beams) {
    // 屋根に沿う鋼鉄の梁と、壁を下りる柱、梁をつなぐ輪。
    const steel = new Props();
    const beamMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    for (let b = 0; b < roof.beams; b++) {
      const ph = (b / roof.beams) * Math.PI * 2;
      const curve = new THREE.CatmullRomCurve3(Array.from({ length: 13 }, (_, k) => onRoof((k / 12) * (Math.PI / 2), ph)));
      steel.add(new THREE.TubeGeometry(curve, 24, 0.9, 6), roof.line, 0, 0, 0);
      const p = onRoof(Math.PI / 2, ph);
      steel.add(new THREE.BoxGeometry(1.6, rimY, 1.6), roof.line, p.x, rimY / 2, p.z, { ry: -ph });
    }
    for (const th of [0.5, 1.0]) {
      const ringBeam = new THREE.TorusGeometry(Math.sin(th) * R * 0.98, 0.7, 6, 120);
      steel.add(ringBeam, roof.line, center.x, rimY + Math.cos(th) * roof.height * 0.98, center.z, { rx: Math.PI / 2 });
    }
    s.group.add(steel.mesh(beamMat));
    // 照明の列。
    const lamps = new Props();
    for (let b = 0; b < roof.beams * 2; b++) {
      const p = onRoof(0.7, ((b + 0.5) / (roof.beams * 2)) * Math.PI * 2, 0.96);
      lamps.add(new THREE.BoxGeometry(2.4, 0.5, 2.4), roof.glow, p.x, p.y, p.z);
    }
    s.group.add(lamps.mesh(new THREE.MeshBasicMaterial({ vertexColors: true })));
  }
}

/** マイカイ：外の木立ち、バックスクリーンの上の植え込み、ところどころの観客席の花壇。 */
function greenery(s: Shell) {
  const props = new Props();
  // 観客席の後ろを木立ちで囲む。
  for (let i = 0; i < s.rim.length; i += 1) {
    const { p } = s.rim[i];
    const l = Math.hypot(p.x - s.center.x, p.z - s.center.z) || 1;
    const ux = (p.x - s.center.x) / l;
    const uz = (p.z - s.center.z) / l;
    for (let k = 0; k < 2; k++) {
      const d = 5 + k * 7 + Math.random() * 4;
      const h = 12 + Math.random() * 9;
      tree(props, p.x + ux * d + (Math.random() - 0.5) * 3, p.z + uz * d, h, Math.random() < 0.3 ? 'cone' : 'round', LEAVES[(i + k) % LEAVES.length]);
    }
  }
  // バックスクリーンの上と、観客席の上の段の花壇・植え込み。
  const top = s.rim[OUTFIELD_SEGMENTS / 2].top;
  const z0 = s.park.fence.center + 1.5;
  for (let x = -10; x <= 10; x += 2.5) props.add(new THREE.IcosahedronGeometry(1.3, 0), LEAVES[Math.round(Math.abs(x)) % LEAVES.length], x, top + 0.8, z0 + Math.random() * 6, { s: [1.2, 0.8, 1.2] });
  for (const x of [-9, -3, 3, 9]) tree(props, x, z0 + 9, 9, 'round', LEAVES[(x + 9) % 5]);
  for (let i = 2; i < s.rim.length - 1; i += 6) {
    const a = s.rim[i];
    const b = s.rim[i + 1];
    const yaw = Math.atan2(b.p.x - a.p.x, b.p.z - a.p.z);
    const x = (a.p.x + b.p.x) / 2;
    const z = (a.p.z + b.p.z) / 2;
    if (a.outfield && Math.abs(x) < 14) continue;
    props.add(new THREE.BoxGeometry(0.9, 0.7, 3.2), '#7b5a44', x, a.top + 0.35, z, { ry: yaw });
    for (const t of [-1, 0, 1]) props.add(new THREE.IcosahedronGeometry(0.75, 0), LEAVES[(i + t + 5) % 5], x + Math.sin(yaw) * t, a.top + 1.1, z + Math.cos(yaw) * t);
  }
  s.group.add(props.mesh());
}

/** 照明塔を、観客席の後ろの何か所かに立てる。 */
function lightTowers(s: Shell) {
  const props = new Props();
  const lamps = new Props();
  const at = [8, 22, 38, 52, OUTFIELD_SEGMENTS + 1, s.rim.length - 1];
  for (const i of at) {
    const { p, top } = s.rim[i];
    const h = top + 22;
    const face = Math.atan2(s.center.x - p.x, 40 - p.z);
    props.add(new THREE.CylinderGeometry(0.5, 0.8, h, 8), '#9aa3b2', p.x, h / 2, p.z);
    props.add(new THREE.BoxGeometry(7, 4.2, 0.6), '#3a4252', p.x, h + 1.6, p.z, { ry: face });
    lamps.add(new THREE.BoxGeometry(6.4, 3.6, 0.2), '#fff8dc', p.x + Math.sin(face) * 0.35, h + 1.6, p.z + Math.cos(face) * 0.35, { ry: face });
  }
  s.group.add(props.mesh());
  s.group.add(lamps.mesh(new THREE.MeshBasicMaterial({ vertexColors: true })));
}

/** バックスクリーンに紋を描く。draw は 512×512 の中心を原点にして描く。 */
function emblem(s: Shell, draw: (g: CanvasRenderingContext2D) => void, size = 9) {
  const tex = canvasTexture(512, 512, (g) => {
    g.translate(256, 256);
    draw(g);
  });
  const sign = mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false }), 0, 7.5, s.park.fence.center + 0.35);
  sign.rotation.y = Math.PI;
  s.group.add(sign);
}

/** 観客席の後ろの壁の上に、旗を並べる（colors の色を交互に）。 */
function flags(s: Shell, colors: string[]) {
  const props = new Props();
  const cloth = new Quads();
  const flutter: { from: number }[] = [];
  let k = 0;
  for (let i = 0; i < s.rim.length; i += 3) {
    const { p, top, outfield } = s.rim[i];
    if (outfield && Math.abs(p.x) < 14) continue;
    props.add(new THREE.CylinderGeometry(0.08, 0.08, 6, 5), '#e0e0e0', p.x, top + 3, p.z);
    const c = new THREE.Color(colors[k++ % colors.length]);
    const yaw = Math.atan2(s.center.x - p.x, s.center.z - p.z) + Math.PI / 2;
    const dx = Math.sin(yaw) * 2.4;
    const dz = Math.cos(yaw) * 2.4;
    flutter.push({ from: cloth.pos.length });
    cloth.quad({ x: p.x, y: top + 5.9, z: p.z }, { x: p.x + dx, y: top + 5.9, z: p.z + dz }, { x: p.x + dx, y: top + 4.3, z: p.z + dz }, { x: p.x, y: top + 4.3, z: p.z }, c);
  }
  s.group.add(props.mesh());
  const geo = cloth.geometry();
  s.group.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })));
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const base = Float32Array.from(pos.array as Float32Array);
  // 旗の先（ポールから離れた2点）だけを、上下に揺らす。
  return (_dt: number, time: number) => {
    flutter.forEach(({ from }, n) => {
      const wave = Math.sin(time * 3 + n) * 0.25;
      for (const v of [1, 2, 4]) (pos.array as Float32Array)[from + v * 3 + 1] = base[from + v * 3 + 1] + wave;
    });
    pos.needsUpdate = true;
  };
}

/** メリー：外野の向こうの観覧車。ゆっくり回る。 */
function ferrisWheel(s: Shell) {
  const R = 26;
  const hub = new THREE.Vector3(-70, R + 6, s.park.fence.center + 45);
  const stand = new Props();
  for (const side of [-1, 1]) {
    const foot = new THREE.Vector3(hub.x + side * 12, 0, hub.z);
    const len = foot.distanceTo(hub);
    stand.add(new THREE.CylinderGeometry(0.5, 0.7, len, 6), '#e0e0e8', (foot.x + hub.x) / 2, hub.y / 2, hub.z, { rz: Math.atan2(hub.x - foot.x, hub.y) * -1 });
  }
  s.group.add(stand.mesh());
  const wheel = new THREE.Group();
  wheel.position.copy(hub);
  // 本塁のほうを向ける。
  wheel.rotation.y = Math.atan2(-hub.x, -hub.z);
  const frame = new Props();
  frame.add(new THREE.TorusGeometry(R, 0.35, 6, 96), '#ffffff', 0, 0, 0);
  frame.add(new THREE.TorusGeometry(R * 0.55, 0.25, 6, 64), '#ffffff', 0, 0, 0);
  const n = 16;
  for (let i = 0; i < n; i++) frame.add(new THREE.BoxGeometry(0.25, R, 0.25), '#f2f2f2', Math.sin((i / n) * Math.PI * 2) * (R / 2), Math.cos((i / n) * Math.PI * 2) * (R / 2), 0, { rz: -(i / n) * Math.PI * 2 });
  wheel.add(frame.mesh());
  const colors = ['#e76f9a', '#f2b544', '#6cc3d5', '#9b7fd1'];
  const cars: THREE.Mesh[] = [];
  for (let i = 0; i < n; i++) {
    const car = mesh(new THREE.BoxGeometry(2.2, 2.4, 2.2), mat(colors[i % 4]), Math.sin((i / n) * Math.PI * 2) * R, Math.cos((i / n) * Math.PI * 2) * R - 1.5, 0);
    cars.push(car);
    wheel.add(car);
  }
  s.group.add(wheel);
  return (_dt: number, time: number) => {
    const a = time * 0.08;
    wheel.rotation.z = a;
    // ゴンドラは回っても下を向いたまま。
    cars.forEach((c, i) => {
      const t = (i / n) * Math.PI * 2;
      c.position.set(Math.sin(t) * R, Math.cos(t) * R - 1.5, 0);
      c.rotation.z = -a;
    });
  };
}

/** 万山：暗い客席に、ペンライトやスマホのような小さな明かり（ゆっくりまたたく）と、最上段の縁の常夜灯。 */
function darkStands(s: Shell) {
  const glow = canvasTexture(64, 64, (g) => {
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(0.25, 'rgba(255,255,255,0.8)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 64, 64);
  });
  const lightColors = ['#ffd27a', '#ffe9b0', '#b8962e', '#ffffff', '#9fd0ff'];
  // 小さな明かり：客の何人かに1つ、頭の上あたりに。
  const picked = s.seats.filter((_, i) => (i * 2654435761) % 1000 < 35);
  const n = picked.length;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const base = new Float32Array(n * 3);
  const phase = new Float32Array(n);
  const c = new THREE.Color();
  picked.forEach((seat, i) => {
    pos.set([seat.x, seat.y + 1.25, seat.z], i * 3);
    c.set(lightColors[i % lightColors.length]);
    base.set([c.r, c.g, c.b], i * 3);
    phase[i] = Math.random() * Math.PI * 2;
  });
  col.set(base);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const points = new THREE.Points(geo, new THREE.PointsMaterial({ map: glow, size: 2.2, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  points.frustumCulled = false;
  s.group.add(points);

  // 最上段の縁の常夜灯（バックスクリーンの上は空ける）。
  const lamps = new Props();
  s.rim.forEach(({ p, top, outfield }, i) => {
    if (i % 2 || (outfield && Math.abs(p.x) < 14)) return;
    lamps.add(new THREE.SphereGeometry(0.28, 8, 6), '#ffcf6b', p.x, top + 0.35, p.z);
  });
  s.group.add(lamps.mesh(new THREE.MeshBasicMaterial({ vertexColors: true })));
  const halos = new Float32Array(s.rim.length * 3);
  let h = 0;
  s.rim.forEach(({ p, top, outfield }, i) => {
    if (i % 2 || (outfield && Math.abs(p.x) < 14)) return;
    halos.set([p.x, top + 0.35, p.z], h * 3);
    h++;
  });
  const haloGeo = new THREE.BufferGeometry();
  haloGeo.setAttribute('position', new THREE.BufferAttribute(halos.slice(0, h * 3), 3));
  const halo = new THREE.Points(haloGeo, new THREE.PointsMaterial({ map: glow, size: 3.2, color: '#ffb84a', transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
  halo.frustumCulled = false;
  s.group.add(halo);

  const attr = geo.getAttribute('color') as THREE.BufferAttribute;
  return (_dt: number, time: number) => {
    for (let i = 0; i < n; i++) {
      const k = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(time * 1.6 + phase[i]));
      col[i * 3] = base[i * 3] * k;
      col[i * 3 + 1] = base[i * 3 + 1] * k;
      col[i * 3 + 2] = base[i * 3 + 2] * k;
    }
    attr.needsUpdate = true;
  };
}

/** 花桜ドーム：ドームの中をゆっくり舞う花びら。 */
function sakura(s: Shell) {
  const N = 500;
  const pos = new Float32Array(N * 3);
  const drift = new Float32Array(N);
  const spread = s.radius * 0.8;
  for (let i = 0; i < N; i++) {
    pos[i * 3] = s.center.x + (Math.random() - 0.5) * 2 * spread;
    pos[i * 3 + 1] = 2 + Math.random() * 40;
    pos[i * 3 + 2] = s.center.z + (Math.random() - 0.5) * 2 * spread;
    drift[i] = Math.random() * Math.PI * 2;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const petal = canvasTexture(32, 32, (g) => {
    g.fillStyle = '#ffd0dd';
    g.beginPath();
    g.ellipse(16, 16, 13, 7, 0.6, 0, Math.PI * 2);
    g.fill();
  });
  const points = new THREE.Points(geo, new THREE.PointsMaterial({ map: petal, size: 0.55, transparent: true, depthWrite: false, alphaTest: 0.3 }));
  points.frustumCulled = false;
  s.group.add(points);
  // バックスクリーンに大きな桜の紋。
  emblem(s, (g) => {
    for (let k = 0; k < 5; k++) {
      g.save();
      g.rotate((k / 5) * Math.PI * 2);
      g.fillStyle = '#f2b8c8';
      g.beginPath();
      g.moveTo(0, 0);
      g.bezierCurveTo(-120, -90, -80, -230, -18, -215);
      g.lineTo(0, -185);
      g.lineTo(18, -215);
      g.bezierCurveTo(80, -230, 120, -90, 0, 0);
      g.fill();
      g.restore();
    }
    g.fillStyle = '#c4687f';
    g.beginPath();
    g.arc(0, 0, 34, 0, Math.PI * 2);
    g.fill();
  });
  return (dt: number, time: number) => {
    for (let i = 0; i < N; i++) {
      pos[i * 3] += Math.sin(time * 0.7 + drift[i]) * 0.6 * dt;
      pos[i * 3 + 2] += Math.cos(time * 0.5 + drift[i]) * 0.4 * dt;
      pos[i * 3 + 1] -= (0.5 + 0.3 * Math.sin(drift[i])) * dt;
      if (pos[i * 3 + 1] < 0.2) pos[i * 3 + 1] = 40;
    }
    geo.getAttribute('position').needsUpdate = true;
  };
}

/** スマーリンズ：砂浜と海、帆の屋根、灯台、ヨット、ヤシの木。 */
function seaside(s: Shell) {
  const { center } = s;
  const beach = mesh(new THREE.CircleGeometry(s.radius + 14, 96), mat('#e9d6a6'), center.x, -0.05, center.z);
  beach.rotation.x = -Math.PI / 2;
  s.group.add(beach);
  const wave = canvasTexture(256, 256, (g) => {
    g.fillStyle = '#2a8fc4';
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.lineWidth = 3;
    for (let y = 16; y < 256; y += 32) {
      g.beginPath();
      for (let x = 0; x <= 256; x += 8) g.lineTo(x, y + Math.sin((x / 256) * Math.PI * 4 + y) * 5);
      g.stroke();
    }
  });
  wave.wrapS = wave.wrapT = THREE.RepeatWrapping;
  wave.repeat.set(60, 60);
  const sea = mesh(new THREE.PlaneGeometry(1600, 1600), new THREE.MeshLambertMaterial({ map: wave }), 0, -0.3, 300);
  sea.rotation.x = -Math.PI / 2;
  s.group.add(sea);
  // 波打ちぎわ。
  const foam = mesh(new THREE.RingGeometry(s.radius + 13, s.radius + 15.5, 96), basic('#ffffff', 0.7), center.x, -0.2, center.z);
  foam.rotation.x = -Math.PI / 2;
  s.group.add(foam);

  const props = new Props();
  // 内野席の上に、帆の形の屋根を並べる。
  const sails = new Quads();
  const white = new THREE.Color('#fbfdff');
  for (let i = OUTFIELD_SEGMENTS + 1; i < s.rim.length; i++) {
    const a = s.rim[i];
    const b = s.rim[(i + 1) % s.rim.length];
    const dx = b.p.x - a.p.x;
    const dz = b.p.z - a.p.z;
    const len = Math.hypot(dx, dz);
    for (let t = 4; t + 8 < len; t += 12) {
      const p = { x: a.p.x + (dx / len) * t, z: a.p.z + (dz / len) * t };
      const q = { x: a.p.x + (dx / len) * (t + 8), z: a.p.z + (dz / len) * (t + 8) };
      // グラウンド側（外向きの法線の逆）へ張り出す。
      const nx = -dz / len;
      const nz = dx / len;
      const tip = { x: p.x - nx * 9, y: a.top + 9, z: p.z - nz * 9 };
      props.add(new THREE.CylinderGeometry(0.18, 0.22, 12, 6), '#dfe8ee', p.x, a.top + 6, p.z);
      sails.quad({ x: p.x, y: a.top + 12, z: p.z }, { x: q.x, y: a.top + 1, z: q.z }, tip, tip, white);
    }
  }
  s.group.add(new THREE.Mesh(sails.geometry(), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })));
  // 右翼の先の岬に灯台。
  const lh = { x: 62, z: s.park.fence.center + 60 };
  props.add(new THREE.DodecahedronGeometry(9, 0), '#8a8178', lh.x, 0, lh.z, { s: [1.3, 0.6, 1.1] });
  for (let k = 0; k < 6; k++) props.add(new THREE.CylinderGeometry(2.3 - k * 0.2, 2.5 - k * 0.2, 3.6, 16), k % 2 ? '#d84b3c' : '#fafafa', lh.x, 5 + k * 3.6, lh.z);
  props.add(new THREE.ConeGeometry(1.9, 2.6, 12), '#2e3b45', lh.x, 5 + 6 * 3.6 + 3.3, lh.z);
  // ヤシの木を浜に。
  for (let i = 0; i < 24; i++) {
    const a = -Math.PI * 0.42 + (i / 23) * Math.PI * 0.84 + (Math.random() - 0.5) * 0.04;
    const r = s.radius + 4 + Math.random() * 6;
    const x = center.x + Math.sin(a) * r;
    const z = center.z + Math.cos(a) * r;
    if (Math.hypot(x - lh.x, z - lh.z) < 16) continue;
    const h = 8 + Math.random() * 4;
    const lean = (Math.random() - 0.5) * 0.4;
    props.add(new THREE.CylinderGeometry(0.22, 0.35, h, 6), '#8b6b47', x, h / 2, z, { rz: lean });
    const tx = x - Math.sin(lean) * h * 0.5;
    for (let f = 0; f < 7; f++) props.add(new THREE.BoxGeometry(0.5, 0.08, 3.6), '#3e8b3a', tx + Math.sin((f / 7) * Math.PI * 2) * 1.5, h - 0.2, z + Math.cos((f / 7) * Math.PI * 2) * 1.5, { ry: (f / 7) * Math.PI * 2, rx: 0.35 });
  }
  s.group.add(props.mesh());
  const lamp = mesh(new THREE.CylinderGeometry(1.5, 1.5, 2, 12), basic('#fff3a8'), lh.x, 5 + 6 * 3.6 + 1, lh.z);
  s.group.add(lamp);
  const beam = mesh(new THREE.ConeGeometry(4, 40, 16, 1, true), basic('#fff6c4', 0.18), lh.x, 5 + 6 * 3.6 + 1, lh.z);
  beam.geometry.translate(0, -20, 0);
  beam.rotation.z = Math.PI / 2;
  const beamPivot = new THREE.Group();
  beamPivot.position.set(lh.x, 0, lh.z);
  beam.position.set(0, 5 + 6 * 3.6 + 1, 0);
  beamPivot.add(beam);
  s.group.add(beamPivot);
  // 沖のヨット。
  const boats: THREE.Group[] = [];
  for (let b = 0; b < 4; b++) {
    const boat = new THREE.Group();
    const p = new Props();
    p.add(new THREE.BoxGeometry(1.6, 0.8, 5), '#fafafa', 0, 0.3, 0);
    p.add(new THREE.CylinderGeometry(0.08, 0.08, 6, 5), '#cfd8dc', 0, 3.4, 0.3);
    const sail = new Quads();
    sail.quad({ x: 0, y: 6.3, z: 0.4 }, { x: 0, y: 0.9, z: 0.4 }, { x: 0, y: 0.9, z: -2.2 }, { x: 0, y: 0.9, z: -2.2 }, new THREE.Color(b % 2 ? '#a9dcf2' : '#ffffff'));
    boat.add(p.mesh(), new THREE.Mesh(sail.geometry(), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })));
    boat.position.set(-90 + b * 55 + Math.random() * 20, -0.2, s.park.fence.center + 90 + Math.random() * 80);
    boat.rotation.y = Math.random() * Math.PI * 2;
    boats.push(boat);
    s.group.add(boat);
  }
  return (_dt: number, time: number) => {
    wave.offset.set(time * 0.01, time * 0.006);
    beamPivot.rotation.y = time * 0.8;
    boats.forEach((boat, i) => {
      boat.position.y = -0.2 + Math.sin(time * 1.3 + i) * 0.15;
      boat.rotation.z = Math.sin(time * 0.9 + i * 2) * 0.05;
    });
  };
}

/** スコアボード。文字が左右反転しないよう、鏡像にした root の外に置く。 */
export class Scoreboard {
  readonly object: THREE.Group;
  private readonly canvas: HTMLCanvasElement;
  private readonly texture: THREE.CanvasTexture;
  private last = '';
  private name = DEFAULT_PARK.nameJa;

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

  /** 球場に合わせて、名前と立てる位置を変える。中堅の観客席が高い球場では、その上に出るよう持ち上げる。 */
  setStadium(s: Stadium) {
    this.name = s.park.nameJa;
    this.object.position.set(0, Math.max(0, s.scoreboard.standTop - 12.7), s.scoreboard.z);
    this.last = '\u0000';
    this.update(null);
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
    g.fillText(this.name, 512, 52);
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
