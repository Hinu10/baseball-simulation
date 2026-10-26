// 各球団の本拠地の見た目。寸法は core/field.ts の Park のものを使い、色・屋根・飾りは球場 id ごとにここで決める。
import * as THREE from 'three';
import { BASES, DEFAULT_PARK, DUGOUT, fenceDistance, INFIELD_DIRT_CENTER, INFIELD_DIRT_RADIUS, MOUND, NEXT_CIRCLE, onDeckPos, type Park } from '../core/field.ts';
import type { GameState } from '../core/gameState.ts';
import { score } from '../core/gameState.ts';
import { glowColor } from '../core/teams.ts';
import nemuchartLogo from './ads/nemuchart.png';
import yamanoteRunnerLogo from './ads/yamanote-runner.png';
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
const ROW_DEPTH = 0.85;
/** 観客の間隔（m）。 */
const SEAT_GAP = 0.52;
const WALL_LOW = 1.4;
/** 最上段の後ろの壁が段より高い分（m）。 */
const BACK_WALL = 1.6;
/** 中堅のバックスクリーンの幅の半分（m）。打者がボールを見やすいよう、ここには客を入れない。 */
const BACKSCREEN_HALF = 12;
/** 観客席を縦に区切る階段の間隔と幅（m、最前列の長さで測る。どの段でも同じ割合の位置に来るので、上までまっすぐ通る）。 */
const AISLE_GAP = 11;
const AISLE_W = 1.1;
/** 下段と上段の間の通路：何割の高さにあるか、上段がどれだけ高く始まるか（m。その面にリボン看板を張る）。 */
const WALKWAY_AT = 0.45;
const DECK_STEP = 1.5;
const CONCRETE = '#a9a9a4';

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
  /** グラウンドを照らす明かりの強さ（省略は 1 = ふつう）と色。下げると選手やグラウンドも薄暗くなる。 */
  fieldLight?: { intensity: number; color: string };
  /** 屋外の球場で、外に駐車場を作るか（省略は作る。街なか・海辺・森の球場は作らない）。 */
  parking?: boolean;
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
    rows: 41,
    outfieldRows: 41,
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
    rows: 41,
    outfieldRows: 41,
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
    rows: 42,
    outfieldRows: 42,
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
    rows: 44,
    outfieldRows: 44,
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
    rows: 41,
    outfieldRows: 36,
    rise: 0.5,
    fill: 0.88,
    sky: '#8fd3ff',
    // 山あいの森：重なる山並みと、外に広がる針葉樹の森。
    parking: false,
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
    rows: 48,
    outfieldRows: 40,
    rise: 0.62,
    fill: 0.985,
    sky: '#8fd3ff',
    // 都会のど真ん中：高層ビルと看板、観客席の外をまわる高架の電車。
    parking: false,
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
    rows: 47,
    outfieldRows: 15,
    rise: 0.5,
    fill: 0.9,
    sky: '#a7e3ff',
    parking: false,
    decorate: combine(seaside, islands)
  },
  // 寛ブドーム：とにかく広い。白い大屋根にチームカラーのからし色の骨組みと光の帯、段も多い。
  kanbu: {
    wall: '#1a1a1a',
    rim: '#dca212',
    pole: '#dca212',
    seat: (row, seg, outfield) => (outfield ? (row % 2 ? '#b88a0c' : '#c99812') : seg % 7 === 3 ? '#2a2a2a' : row % 2 ? '#8c939b' : '#99a0a8'),
    back: '#b9bec4',
    screen: '#141414',
    ground: '#8d949c',
    track: DIRT,
    rows: 53,
    outfieldRows: 48,
    rise: 0.5,
    fill: 0.93,
    sky: '#24211c',
    roof: { panel: '#f4f1ea', line: '#f0b33c', meridians: 48, parallels: 9, height: 58, glow: '#ffd27a', wall: '#e2ddd3', band: '#dca212', ring: '#ffe3a6' }
  },
  // 万山ドームスタジアム：漆黒の屋根に小さな明かりがぽつぽつ。開閉式で、開いている日は夜空が見える。
  manyama: {
    wall: '#111111',
    rim: '#a8862a',
    pole: '#a8862a',
    seat: (row) => (row % 2 ? '#1e1e22' : '#26262b'),
    back: '#161618',
    screen: '#0a0a0a',
    ground: '#2c2c30',
    track: '#8a6a4a',
    rows: 56,
    outfieldRows: 52,
    rise: 0.52,
    fill: 0.9,
    sky: '#07080d',
    roof: { panel: '#0d0d10', line: '#1d1d24', meridians: 28, parallels: 6, height: 46, glow: '#a8862a', wall: '#121215', band: '#3a2f12', stars: '#ffe9b0', retractable: true, beams: 8 },
    // 客席は人がいるのに、ほぼ真っ暗。ところどころの小さな明かりと、最上段の縁の常夜灯だけが灯る。
    crowdLight: 0.018,
    // グラウンドも薄暗く、少し琥珀がかった明かりだけ。
    fieldLight: { intensity: 0.22, color: '#ffd9a0' },
    decorate: darkStands
  },
  // オネタールスタジアム：一体感の球場。観客席の上をチームの旗がぐるりと囲む。
  onetar: {
    wall: '#0e4d5a',
    rim: '#26b5c0',
    pole: '#26b5c0',
    seat: (row, seg) => (Math.floor(seg / 3) % 2 ? (row % 2 ? '#2aa9b3' : '#36b4be') : row % 2 ? '#dcebec' : '#e8f3f3'),
    back: '#c6dfe1',
    screen: '#0b3a44',
    ground: '#8e9878',
    track: DIRT,
    rows: 41,
    outfieldRows: 39,
    rise: 0.5,
    fill: 0.92,
    sky: '#8fd3ff',
    // 城下町：石垣の上の天守閣、五重塔、瓦屋根の町並み。
    decorate: combine((s: Shell) => flags(s, ['#26b5c0', '#ffffff']), castleTown)
  },
  // サックスターズスタジアム：照明塔と、バックスクリーンの大きな星。
  sackstars: {
    wall: '#2c2f38',
    rim: '#e0b13a',
    pole: '#f0eee6',
    seat: (row) => (row % 2 ? '#d6d4cc' : '#e2e0d8'),
    back: '#c9c7bf',
    screen: '#1f222a',
    ground: '#c98d5a',
    track: DIRT,
    rows: 43,
    outfieldRows: 39,
    rise: 0.5,
    fill: 0.86,
    sky: '#8fd3ff',
    // 荒野：赤い台地とサボテン。
    decorate: combine(lightTowers, desert, (s: Shell) => {
      emblem(s, (g) => {
        g.fillStyle = '#e0b13a';
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
    wall: '#4a2f1c',
    rim: '#ae7a2c',
    pole: '#f3e3c3',
    seat: (_row, seg) => ['#e76f9a', '#f2b544', '#6cc3d5', '#9b7fd1'][Math.floor(seg / 4) % 4],
    back: '#efe2c9',
    screen: '#24170e',
    ground: '#d9cdb5',
    track: DIRT,
    rows: 43,
    outfieldRows: 39,
    rise: 0.5,
    fill: 0.8,
    sky: '#9ad9ff',
    // テーマパーク：観覧車、城、ジェットコースター、メリーゴーラウンド、フリーフォール、熱気球。
    decorate: combine(ferrisWheel, themePark)
  },
  // 金ノダンクドーム：くすんだ金色の屋根の、こぢんまりしたドーム。
  kanenodunk: {
    wall: '#1c1c1c',
    rim: '#d0b35c',
    pole: '#d0b35c',
    seat: (row) => (row % 2 ? '#7a6a45' : '#857550'),
    back: '#a39272',
    screen: '#1d1b16',
    ground: '#7c7668',
    track: DIRT,
    rows: 43,
    outfieldRows: 40,
    rise: 0.5,
    fill: 0.78,
    sky: '#221e14',
    roof: { panel: '#d8c9a0', line: '#9c8550', meridians: 20, parallels: 5, height: 42, glow: '#ffe2a0', wall: '#bfae86', band: '#a8862a' }
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
  /** グラウンドを照らす明かり（省略はふつうの明るさ）。 */
  fieldLight?: { intensity: number; color: string };
  /** スコアボードを立てる位置（core の z）と、本塁から見てその前の観客席（バックスクリーン）に隠れる高さ。 */
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
  // 段の少ない球場（外野席の低い海辺など）以外は、途中に通路をはさんで上段を高く始める。
  const minRows = Math.min(look.rows, look.outfieldRows);
  const walkway = minRows >= 10 ? Math.round(minRows * WALKWAY_AT) : -1;
  const rowTop = (i: number, row: number) => wallH(i) + 0.4 + row * look.rise + (walkway >= 0 && row > walkway ? DECK_STEP : 0);
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
  // ネクストバッターズサークル：濃い色の円に白い縁。
  for (const side of [-1, 1] as const) {
    const c = onDeckPos(side);
    const disk = mesh(new THREE.CircleGeometry(NEXT_CIRCLE.radius, 32), decal('#3b4a3c', 3), c.x, 0.03, c.z);
    const ring = mesh(new THREE.RingGeometry(NEXT_CIRCLE.radius - 0.06, NEXT_CIRCLE.radius, 32), decal(LINE, 4), c.x, 0.035, c.z);
    for (const m of [disk, ring]) {
      m.rotation.x = -Math.PI / 2;
      group.add(m);
    }
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

  fenceAds(group, arc, offsetLoop(pts, -0.06).slice(0, OUTFIELD_SEGMENTS + 1), park.fence.height);
  for (const side of [-1, 1] as const) dugout(group, park, look, side);

  // 観客席：壁の外側に、外へ向かって上がる段を一周つなげる（外野と内野で段数が違ってもよい）。段ごとに観客を座らせる。
  const seats: Seat[] = [];
  const steps = new Quads();
  const back = new Quads();
  const color = new THREE.Color();
  const outfieldFill = look.fill - 0.02;
  const mids: P2[][] = [];
  for (let row = 0; row < maxRows; row++) mids.push(offsetLoop(pts, 0.4 + (row + 0.6) * ROW_DEPTH));
  // 階段の位置は、最前列に沿った長さで決める（区間 i の始まりまでの長さ）。
  const along0: number[] = [0];
  for (let i = 0; i < n; i++) along0.push(along0[i] + Math.hypot(mids[0][(i + 1) % n].x - mids[0][i].x, mids[0][(i + 1) % n].z - mids[0][i].z));
  const inAisle = (d: number) => (d + AISLE_W / 2) % AISLE_GAP < AISLE_W;
  const concrete = new THREE.Color(CONCRETE);
  // リボン看板（上段の前の面）。黒い板に、区間ごとに色の変わる光る帯。
  const boards = new Quads();
  const boardColors = [look.rim, '#ffffff', look.pole, '#ffd54f'].map((c) => new THREE.Color(c));
  const black = new THREE.Color('#15171c');
  const at = (line: P2[], i: number, j: number, f: number, y: number) => ({ x: line[i].x + (line[j].x - line[i].x) * f, y, z: line[i].z + (line[j].z - line[i].z) * f });
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const rows = rowsOf(i);
    const outfield = segOutfield(i);
    for (let row = 0; row < rows; row++) {
      const inner = loops[row];
      const outer = loops[row + 1];
      const lo = (k: number) => (row === 0 ? wallH(k) : rowTop(k, row - 1));
      const c = row === walkway ? concrete : color.set(look.seat(row, i, outfield));
      // 蹴上げ（前の段から立ち上がる面）と踏み面。
      steps.quad({ x: inner[i].x, y: lo(i), z: inner[i].z }, { x: inner[j].x, y: lo(j), z: inner[j].z }, { x: inner[j].x, y: rowTop(j, row), z: inner[j].z }, { x: inner[i].x, y: rowTop(i, row), z: inner[i].z }, c);
      steps.quad({ x: inner[i].x, y: rowTop(i, row), z: inner[i].z }, { x: inner[j].x, y: rowTop(j, row), z: inner[j].z }, { x: outer[j].x, y: rowTop(j, row), z: outer[j].z }, { x: outer[i].x, y: rowTop(i, row), z: outer[i].z }, c);
      // 上段の前の面のリボン看板。
      if (row === walkway + 1) {
        const y0 = (k: number) => rowTop(k, walkway) + 0.25;
        const y1 = (k: number) => rowTop(k, row) - 0.15;
        const ym = (k: number) => (y0(k) + y1(k)) / 2;
        const front = offsetLoop(pts, 0.4 + row * ROW_DEPTH - 0.03);
        boards.quad({ x: front[i].x, y: y0(i), z: front[i].z }, { x: front[j].x, y: y0(j), z: front[j].z }, { x: front[j].x, y: y1(j), z: front[j].z }, { x: front[i].x, y: y1(i), z: front[i].z }, black);
        const led = boardColors[Math.floor(i / 4) % boardColors.length];
        const f = offsetLoop(pts, 0.4 + row * ROW_DEPTH - 0.06);
        boards.quad({ x: f[i].x, y: ym(i) - 0.22, z: f[i].z }, { x: f[j].x, y: ym(j) - 0.22, z: f[j].z }, { x: f[j].x, y: ym(j) + 0.22, z: f[j].z }, { x: f[i].x, y: ym(i) + 0.22, z: f[i].z }, led);
      }
      // 階段：最前列の長さで決めた位置に、上の段まで踏み面をコンクリートの色で通す。
      const seg0 = along0[i + 1] - along0[i];
      for (let d = Math.ceil((along0[i] - AISLE_W / 2) / AISLE_GAP) * AISLE_GAP; d - AISLE_W / 2 < along0[i + 1]; d += AISLE_GAP) {
        const f0 = Math.max(0, (d - AISLE_W / 2 - along0[i]) / seg0);
        const f1 = Math.min(1, (d + AISLE_W / 2 - along0[i]) / seg0);
        if (f1 <= f0 || row === walkway) continue;
        const y = (f: number) => rowTop(i, row) + (rowTop(j, row) - rowTop(i, row)) * f + 0.012;
        steps.quad(at(inner, i, j, f0, y(f0)), at(inner, i, j, f1, y(f1)), at(outer, i, j, f1, y(f1)), at(outer, i, j, f0, y(f0)), concrete);
      }
      // 通路の段には席を置かない。
      if (row === walkway) continue;
      // 席：段の奥寄りに等間隔で。外野席は少し空きを多く。階段の上は空ける。
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
        if (inAisle(along0[i] + s * seg0)) continue;
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
  if (boards.pos.length) group.add(new THREE.Mesh(boards.geometry(), new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 })));
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
  // 本塁の後ろ（打者を映すカメラのあたり）から、バックスクリーンの上端ごしにスコアボードの位置を見たときの高さ。
  const eye = { y: 3, z: -8 };
  const screenFront = park.fence.center + 0.4;
  const standTop = eye.y + ((screenTop - eye.y) * (scoreboardZ - eye.z)) / (screenFront - eye.z);
  if (look.roof) buildRoof(shell, look.roof, domeFloor);
  const animate = combine(look.decorate ?? (() => {}), look.roof ? () => {} : outside)(shell);
  let time = 0;
  return {
    park,
    group,
    crowd,
    sky: look.sky,
    fieldLight: look.fieldLight,
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

/** 外野フェンスの広告（架空の会社と、作者のアプリ）。3区間ずつ1枚、バックスクリーンの前は空ける。logo はアプリのアイコン（左端に置く）。 */
const ADS: { text: string; bg: string; fg: string; logo?: string }[] = [
  { text: 'そらいろ銀行', bg: '#1565c0', fg: '#ffffff' },
  { text: 'ハヤブサ急便', bg: '#ffffff', fg: '#2e7d32' },
  { text: 'まんぷく食堂', bg: '#c62828', fg: '#fff3c4' },
  { text: 'スターライト電機', bg: '#212121', fg: '#ffd54f' },
  { text: 'NemuChart', bg: '#283593', fg: '#e8eaf6', logo: nemuchartLogo },
  { text: '山手線ランナー', bg: '#9acd32', fg: '#1b3a1b', logo: yamanoteRunnerLogo },
  { text: 'ひだまり保険', bg: '#ffb300', fg: '#3e2723' },
  { text: 'みなと鉄道', bg: '#00897b', fg: '#ffffff' },
  { text: 'くもり堂', bg: '#f5f5f5', fg: '#6a1b9a' }
];
/** 広告を縦に並べた1枚の絵（1枚の高さ H）。 */
function adTexture(H: number): THREE.CanvasTexture {
  const atlas = canvasTexture(512, H * ADS.length, (g) => {
    ADS.forEach((ad, k) => {
      g.fillStyle = ad.bg;
      g.fillRect(0, k * H, 512, H);
      g.fillStyle = ad.fg;
      g.font = '900 78px "Hiragino Sans", "Noto Sans JP", sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      // アイコンのある広告は、文字を右に寄せる。
      if (ad.logo) g.fillText(ad.text, (LOGO.x + LOGO.size + 512) / 2, k * H + H / 2 + 4, 512 - LOGO.size - LOGO.x * 3);
      else g.fillText(ad.text, 256, k * H + H / 2 + 4, 470);
    });
  });
  // アイコンは読み込めたら、角を丸めて左端に描き足す。
  ADS.forEach((ad, k) => {
    if (!ad.logo) return;
    const img = new Image();
    img.onload = () => {
      const g = (atlas.image as HTMLCanvasElement).getContext('2d')!;
      const y = k * H + (H - LOGO.size) / 2;
      g.save();
      g.beginPath();
      g.roundRect(LOGO.x, y, LOGO.size, LOGO.size, LOGO.size * 0.22);
      g.clip();
      g.drawImage(img, LOGO.x, y, LOGO.size, LOGO.size);
      g.restore();
      atlas.needsUpdate = true;
    };
    img.src = ad.logo;
  });
  return atlas;
}

let adAtlas: THREE.CanvasTexture | null = null;
const LOGO = { x: 16, size: 128 };
function fenceAds(group: THREE.Group, arc: P2[], front: P2[], height: number) {
  const H = 160;
  adAtlas ??= adTexture(H);
  const pos: number[] = [];
  const uv: number[] = [];
  const y0 = 0.35;
  const y1 = height - 0.35;
  let k = 0;
  for (let i = 0; i + 3 <= OUTFIELD_SEGMENTS; i += 3) {
    if (Math.abs(arc[i].x) < BACKSCREEN_HALF + 2 || Math.abs(arc[i + 3].x) < BACKSCREEN_HALF + 2) continue;
    const ad = k++ % ADS.length;
    const v0 = 1 - (ad + 1) / ADS.length;
    const v1 = 1 - ad / ADS.length;
    for (let t = 0; t < 3; t++) {
      const a = front[i + t];
      const b = front[i + t + 1];
      // 外野の弧は左翼から右翼へ並ぶ。球場は左右反転して描くので、この向きに貼るとグラウンドから読める。
      const u0 = t / 3;
      const u1 = (t + 1) / 3;
      pos.push(a.x, y0, a.z, b.x, y0, b.z, b.x, y1, b.z, a.x, y0, a.z, b.x, y1, b.z, a.x, y1, a.z);
      uv.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  group.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: adAtlas, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 })));
}

/** ベンチ（ダッグアウト）：ファウル地域の壁に背をつけた、屋根つきの低い小屋。side は 1 = 一塁側、-1 = 三塁側。 */
function dugout(group: THREE.Group, park: Park, look: Look, side: 1 | -1) {
  const s = Math.SQRT1_2;
  const out = park.foul.side - DUGOUT.depth / 2;
  const cx = side * (DUGOUT.along + out) * s;
  const cz = (DUGOUT.along - out) * s;
  // 小屋の向き：x がファウルラインに沿う向き、z がグラウンド側。
  const ry = side === 1 ? -Math.PI / 4 : (-3 * Math.PI) / 4;
  const props = new Props();
  const L = DUGOUT.length;
  const D = DUGOUT.depth;
  const put = (geo: THREE.BufferGeometry, color: string, x: number, y: number, z: number) =>
    props.add(geo, color, cx + x * Math.cos(ry) + z * Math.sin(ry), y, cz - x * Math.sin(ry) + z * Math.cos(ry), { ry });
  put(new THREE.BoxGeometry(L + 0.4, 0.18, D + 0.4), look.wall, 0, 1.8, 0.1);
  put(new THREE.BoxGeometry(L + 0.4, 0.26, 0.12), look.rim, 0, 1.68, D / 2 + 0.3);
  put(new THREE.BoxGeometry(L, 1.8, 0.12), '#4a505a', 0, 0.9, -D / 2 + 0.06);
  for (const e of [-1, 1]) put(new THREE.BoxGeometry(0.22, 1.8, D), look.wall, (e * L) / 2, 0.9, 0);
  put(new THREE.BoxGeometry(L, 0.04, D), '#3b3226', 0, 0.02, 0);
  put(new THREE.BoxGeometry(L - 1.2, 0.45, 0.55), '#6d4c41', 0, 0.23, -D / 2 + 0.5);
  put(new THREE.BoxGeometry(L, 0.07, 0.07), '#d6d6d6', 0, 1.0, D / 2);
  for (let x = -L / 2 + 0.6; x <= L / 2 - 0.6; x += 2.2) put(new THREE.BoxGeometry(0.07, 1.0, 0.07), '#d6d6d6', x, 0.5, D / 2);
  // 壁に掛けたヘルメットとバット立て。
  for (let x = -L / 2 + 1.2; x < L / 2 - 1; x += 0.55) put(new THREE.SphereGeometry(0.15, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), '#1d2433', x, 1.3, -D / 2 + 0.2);
  for (let x = L / 2 - 2.6; x < L / 2 - 1; x += 0.12) put(new THREE.CylinderGeometry(0.025, 0.035, 0.85, 5), '#d9a35f', x, 0.45, -D / 2 + 0.25);
  group.add(props.mesh());
}

/**
 * 屋外の球場の外まわり：外壁の柱と窓、まわりの広場（舗装・街灯・行き交う人・屋台）、入場ゲート、駐車場。
 * 広場は観客席の後ろの壁に沿って、PLAZA m の幅でぐるりと囲む。
 */
const PLAZA = 13;
function outside(s: Shell) {
  const outline = s.rim.map((r) => r.p);
  const n = outline.length;
  const props = new Props();
  const glow = new Props();
  const backColor = '#' + new THREE.Color(s.look.back).multiplyScalar(0.82).getHexString();

  // 外壁：各階の窓の帯（約5 m ごと）と、一定の間隔の柱。
  const face = offsetLoop(outline, 0.12);
  const glass = new Quads();
  const dark = new THREE.Color('#2b3846');
  const FLOOR = 5;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const top = Math.min(s.rim[i].top, s.rim[j].top);
    for (let y0 = 3; y0 + 1.3 < top - 1.5; y0 += FLOOR) {
      const y1 = y0 + 1.3;
      glass.quad({ x: face[i].x, y: y0, z: face[i].z }, { x: face[j].x, y: y0, z: face[j].z }, { x: face[j].x, y: y1, z: face[j].z }, { x: face[i].x, y: y1, z: face[i].z }, dark);
    }
  }
  s.group.add(new THREE.Mesh(glass.geometry(), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 })));
  const pillarLine = offsetLoop(outline, 0.45);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = pillarLine[i];
    const b = pillarLine[j];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const yaw = Math.atan2(b.x - a.x, b.z - a.z);
    for (let t = 0; t < len; t += 7.5) {
      const f = t / len;
      const top = s.rim[i].top + (s.rim[j].top - s.rim[i].top) * f;
      props.add(new THREE.BoxGeometry(0.9, top, 0.9), backColor, a.x + (b.x - a.x) * f, top / 2, a.z + (b.z - a.z) * f, { ry: yaw });
    }
  }

  // 広場の舗装。
  const paving = new Quads();
  const plazaIn = offsetLoop(outline, 0.2);
  const plazaOut = offsetLoop(outline, PLAZA);
  paving.ribbon(plazaIn, plazaOut, () => 0.03, () => 0.03);
  s.group.add(new THREE.Mesh(paving.geometry(), decal('#cdc5b4', 1)));

  // 広場の道（人が歩く筋）を、長さで測れる折れ線にしておく。
  const lane = (d: number) => {
    const line = offsetLoop(outline, d);
    line.push(line[0]);
    const acc = [0];
    for (let i = 1; i < line.length; i++) acc.push(acc[i - 1] + Math.hypot(line[i].x - line[i - 1].x, line[i].z - line[i - 1].z));
    return { line, acc, length: acc[acc.length - 1] };
  };
  const pointOn = (l: ReturnType<typeof lane>, d: number) => {
    const t = ((d % l.length) + l.length) % l.length;
    let lo = 0;
    let hi = l.acc.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (l.acc[mid] <= t) lo = mid;
      else hi = mid;
    }
    const f = (t - l.acc[lo]) / (l.acc[hi] - l.acc[lo] || 1);
    const a = l.line[lo];
    const b = l.line[hi];
    return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, yaw: Math.atan2(b.x - a.x, b.z - a.z) };
  };

  // 街灯：広場の外寄りに等間隔で。
  const lamps = lane(PLAZA - 1.5);
  for (let d = 0; d < lamps.length; d += 16) {
    const p = pointOn(lamps, d);
    props.add(new THREE.CylinderGeometry(0.1, 0.14, 6, 6), '#4a4f57', p.x, 3, p.z);
    props.add(new THREE.BoxGeometry(0.9, 0.18, 0.4), '#4a4f57', p.x, 6.05, p.z, { ry: p.yaw });
    glow.add(new THREE.BoxGeometry(0.7, 0.08, 0.3), '#fff4cf', p.x, 5.93, p.z, { ry: p.yaw });
  }

  // 入場ゲート：本塁の後ろと、一塁側・三塁側の角。ゲートの両脇に屋台を並べる。
  const gates = [n - 3, n - 4, n - 1].map((i) => {
    const a = outline[i];
    const b = outline[(i + 1) % n];
    const f = i === n - 3 ? 0.5 : 0;
    const p = { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f };
    const l = Math.hypot(p.x - s.center.x, p.z - s.center.z) || 1;
    return { p, out: { x: (p.x - s.center.x) / l, z: (p.z - s.center.z) / l } };
  });
  const awnings = ['#e53935', '#fdd835', '#1e88e5', '#43a047', '#fb8c00', '#8e24aa'];
  gates.forEach(({ p, out }, g) => {
    const yaw = Math.atan2(out.x, out.z);
    const side = { x: out.z, z: -out.x };
    const at = (along: number, across: number) => ({ x: p.x + out.x * along + side.x * across, z: p.z + out.z * along + side.z * across });
    for (const e of [-1, 1]) {
      const q = at(1.5, e * 4.5);
      props.add(new THREE.BoxGeometry(1.1, 7, 1.1), s.look.rim, q.x, 3.5, q.z, { ry: yaw });
    }
    const top = at(1.5, 0);
    props.add(new THREE.BoxGeometry(10.2, 1.4, 1.2), s.look.wall, top.x, 7.3, top.z, { ry: yaw });
    glow.add(new THREE.BoxGeometry(8.4, 0.5, 1.25), s.look.rim, top.x, 7.3, top.z, { ry: yaw });
    // 屋台：ゲートの両脇に3軒ずつ、色とりどりのひさし。
    for (const e of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        const q = at(6.5, e * (9 + k * 3.6));
        const c = awnings[(g * 6 + k * 2 + (e > 0 ? 1 : 0)) % awnings.length];
        props.add(new THREE.BoxGeometry(2.8, 2.1, 1.8), '#f2efe9', q.x, 1.05, q.z, { ry: yaw });
        props.add(new THREE.BoxGeometry(3.1, 0.12, 1.2), c, q.x - out.x * 1.2, 2.25, q.z - out.z * 1.2, { ry: yaw, rx: -0.35 });
        props.add(new THREE.BoxGeometry(2.4, 0.5, 0.06), c, q.x - out.x * 0.93, 2.6, q.z - out.z * 0.93, { ry: yaw });
      }
    }
  });

  // 駐車場：一塁側・三塁側の角の外。白線と、とめてある車。
  if (s.look.parking !== false) {
    const lot = new Quads();
    const lines = new Quads();
    const asphalt = new THREE.Color('#4b4e54');
    const white = new THREE.Color('#e8e8e8');
    const carColors = ['#f5f5f5', '#212121', '#9e9e9e', '#c62828', '#1565c0', '#eeeeee', '#455a64', '#8d6e63', '#2e7d32', '#fbc02d'];
    for (const i of [n - 4, n - 1]) {
      const p = outline[i];
      const l = Math.hypot(p.x - s.center.x, p.z - s.center.z) || 1;
      const out = { x: (p.x - s.center.x) / l, z: (p.z - s.center.z) / l };
      const side = { x: out.z, z: -out.x };
      const yaw = Math.atan2(out.x, out.z);
      const at = (along: number, across: number, y = 0.02) => ({ x: p.x + out.x * along + side.x * across, y, z: p.z + out.z * along + side.z * across });
      const [a0, a1, w] = [PLAZA + 4, PLAZA + 30, 20];
      lot.quad(at(a0, -w), at(a0, w), at(a1, w), at(a1, -w), asphalt);
      // 2列の駐車枠（列ごとに向かい合わせ）。
      for (const row of [a0 + 6, a0 + 19]) {
        for (let k = -w + 1.5; k <= w - 1.5; k += 2.8) {
          lines.quad(at(row - 2.6, k - 0.06, 0.04), at(row - 2.6, k + 0.06, 0.04), at(row + 2.6, k + 0.06, 0.04), at(row + 2.6, k - 0.06, 0.04), white);
          if (k + 2.8 > w - 1.5 || Math.random() < 0.25) continue;
          const c = at(row, k + 1.4);
          const color = carColors[Math.floor(Math.random() * carColors.length)];
          props.add(new THREE.BoxGeometry(1.75, 0.75, 4.2), color, c.x, 0.55, c.z, { ry: yaw });
          props.add(new THREE.BoxGeometry(1.55, 0.6, 2.2), '#37474f', c.x, 1.2, c.z, { ry: yaw });
        }
      }
    }
    s.group.add(new THREE.Mesh(lot.geometry(), new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1 })));
    s.group.add(new THREE.Mesh(lines.geometry(), new THREE.MeshBasicMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2 })));
  }
  s.group.add(props.mesh());
  s.group.add(glow.mesh(new THREE.MeshBasicMaterial({ vertexColors: true })));

  // 行き交う人：広場の3本の筋を、思い思いの速さで右回り・左回りに歩く。ゲートの前には立ち止まっている人も。
  const lanes = [3.5, 6.5, 9.5].map(lane);
  const WALKERS = 240;
  const STANDING = 90;
  const total = WALKERS + STANDING;
  const bodyMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.2, 0.24, 1.15, 6).translate(0, 0.62, 0), new THREE.MeshLambertMaterial(), total);
  const headMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.14, 1).translate(0, 1.36, 0), new THREE.MeshLambertMaterial(), total);
  const shirts = ['#e53935', '#1e88e5', '#fdd835', '#ffffff', '#212121', '#43a047', '#ff7043', '#8e24aa', '#90a4ae', '#f48fb1', s.look.rim];
  const skins = ['#f1c9a5', '#e8b996', '#d9a47c', '#f6d7bd'];
  const color = new THREE.Color();
  const walkers = Array.from({ length: WALKERS }, (_, k) => ({ lane: lanes[k % 3], d: Math.random() * lanes[k % 3].length, v: (Math.random() < 0.5 ? -1 : 1) * (1 + Math.random() * 0.6), k: 0.9 + Math.random() * 0.2 }));
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3();
  for (let k = 0; k < total; k++) {
    bodyMesh.setColorAt(k, color.set(shirts[Math.floor(Math.random() * shirts.length)]));
    headMesh.setColorAt(k, color.set(skins[Math.floor(Math.random() * skins.length)]));
    if (k < WALKERS) continue;
    // 立ち止まっている人：ゲートと屋台のまわりに集まる。
    const { p, out } = gates[k % gates.length];
    const r = 3 + Math.random() * 8;
    const a = Math.random() * Math.PI * 2;
    const x = p.x + out.x * 4 + Math.cos(a) * r;
    const z = p.z + out.z * 4 + Math.sin(a) * r;
    const size = 1.15 + Math.random() * 0.2;
    m.compose(v.set(x, 0, z), q.setFromAxisAngle(up, Math.random() * Math.PI * 2), sc.set(size, size, size));
    bodyMesh.setMatrixAt(k, m);
    headMesh.setMatrixAt(k, m);
  }
  for (const mesh of [bodyMesh, headMesh]) {
    mesh.frustumCulled = false;
    s.group.add(mesh);
  }
  return (_dt: number, time: number) => {
    walkers.forEach((w, k) => {
      const p = pointOn(w.lane, w.d + w.v * time);
      const bob = Math.abs(Math.sin(time * 7 * Math.abs(w.v) + k)) * 0.05;
      m.compose(v.set(p.x, bob, p.z), q.setFromAxisAngle(up, p.yaw + (w.v < 0 ? Math.PI : 0)), sc.set(1.25 * w.k, 1.25 * w.k, 1.25 * w.k));
      bodyMesh.setMatrixAt(k, m);
      headMesh.setMatrixAt(k, m);
    });
    bodyMesh.instanceMatrix.needsUpdate = true;
    headMesh.instanceMatrix.needsUpdate = true;
  };
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
      // 外まわりの広場（outside）の先に植える。
      const d = 15 + k * 7 + Math.random() * 4;
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
