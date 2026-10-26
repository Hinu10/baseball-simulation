// 観客席の観客。数万人を InstancedMesh で描き（動きは頂点シェーダーで計算する）、安打・得点・本塁打のときに跳ねて沸く。
// 観客は基本的に応援する球団のユニフォーム姿（チームカラーを組み合わせたもの）。プロ野球の球場のように全体ではホームのファンが多く、
// 外野は右翼がホーム、左翼がビジターの応援席で、相手のファンは混ざらない。沸くのは攻撃中のチームのファンが中心。
import * as THREE from 'three';
import { inkOn, type TeamColors } from '../core/teams.ts';
import type { TeamIndex } from '../core/gameState.ts';

export interface Seat {
  x: number;
  y: number;
  z: number;
  /** 本塁側（グラウンド）を向く角度。 */
  yaw: number;
  /** 外野席か。 */
  outfield: boolean;
}

const SCALE = 1.25;
const HEAD_R = 0.15;
/** 体の寸法（拡大前、座面からの高さ）。胴は上（肩）が広く下が細い楕円の筒。 */
const TORSO = { bottom: 0.2, h: 0.62, top: 0.25, waist: 0.2, depth: 0.72 };
const HEAD_Y = TORSO.bottom + TORSO.h + 0.05 + HEAD_R * 0.95;
const SHOULDER = { x: 0.3, y: TORSO.bottom + TORSO.h - 0.07 };
const ARM_LEN = 0.46;
const SKIN = ['#f1c9a5', '#e8b996', '#d9a47c', '#f6d7bd', '#c68a62', '#eec29b'];
/** 髪の色。黒・こげ茶が多く、茶髪や白髪まじりの人も少し。 */
const HAIR = ['#141110', '#1c1612', '#231a14', '#2e2018', '#3d2a1c', '#5a3d26', '#7a5536', '#8f8a84', '#b9b3ab'];
/** 私服（ユニフォームを着ていない少数の人。落ち着いた色が多い）。 */
const CASUAL = ['#f5f5f5', '#e8e0d0', '#2b2b2b', '#3e4a61', '#8a8f98', '#5d6d7e', '#c8b79a', '#6d4c41', '#a5b4c4', '#b0413e'];
const UP = new THREE.Vector3(0, 1, 0);
/** 腕を上げきった角度（前に少し倒す）。 */
const RAISED = -2.8;

/** 打席の選手の名前入りタオルを掲げるファンの数（チームごと）。 */
const TOWEL_HOLDERS = 14;
const TOWEL = { w: 2.6, h: 0.65 };

/** 色の文字列を一度だけ解析して使い回す（数万人ぶん色を塗るので）。 */
const parsed = new Map<string, THREE.Color>();
const colorOf = (c: string): THREE.Color => {
  let v = parsed.get(c);
  if (!v) parsed.set(c, (v = new THREE.Color(c)));
  return v;
};

/** 一塁側（core の +x）がホーム（後攻）。 */
const sideOf = (s: Seat): TeamIndex => (s.x > 0 ? 1 : 0);

/**
 * その席に座るファンの割合 [ホーム, ビジター]（残りは私服）。プロ野球の球場のように全体ではホームが多く、
 * ビジターのファンは三塁側の内野と左翼席に集まる。外野席は応援席なので、相手チームのファンは座らない。
 */
export function fanShare(s: Pick<Seat, 'x' | 'z' | 'outfield'>): [number, number] {
  if (s.outfield) {
    return s.x > 0 ? [0.97, 0] : [0, 0.97];
  }
  if (s.z < -4) return [0.74, 0.2];
  return s.x > 0 ? [0.9, 0.05] : [0.55, 0.4];
}

/** ユニフォームの型：胴・肩（ヨーク）・胸のラインの色。 */
type Outfit = [body: string, yoke: string, stripe: string];

/**
 * チームカラーを組み合わせたユニフォーム。どの型でもメインカラーとサブカラーの両方が入る。
 * home はホーム用（白系の胴に、メインカラーの肩とサブカラーのライン）、color はチームカラーの胴、alt はサブカラーの胴。
 */
export function outfit(t: TeamColors, kind: 'home' | 'color' | 'alt'): Outfit {
  if (kind === 'home') return [t.uniform, t.primary, t.secondary];
  if (kind === 'color') return [t.primary, t.secondary, t.secondary];
  return [t.secondary, t.primary, t.primary];
}

/** 部品の種類。シェーダーでの動かし方が変わる（胴は跳ねるだけ、頭は首を振る、腕は振り上げる）。 */
type PartKind = 'torso' | 'head' | 'armL' | 'armR';

/** いっしょに動く部品のまとまり。まとまりの部品は、同じ置き方（instanceMatrix）を共有する。 */
interface Rig {
  kind: PartKind;
  matrix: THREE.InstancedBufferAttribute;
}

/** 人によって持っていない部品（長い髪・帽子）。持っていない人の分はシェーダーで大きさ 0 にする。 */
type Optional = 'long' | 'cap';

/** 沸いたときのしぐさ（シェーダーに渡す番号）。0 = 両腕を突き上げて振る、1 = 胸の前で手をたたく、2 = あまり動かない。 */
const STYLES = [0, 1, 2];

/**
 * 観客の動きを頂点シェーダーで計算する部分。人ごとの値（跳ね方・しぐさ・首の向き）を属性で渡し、
 * 時刻と両チームの盛り上がりだけを毎フレーム uniform で渡す。数万人でも CPU の負担がない。
 */
const POSE_GLSL = /* glsl */ `
attribute vec4 aMove; // 跳ねる大きさ・速さ・ずれ、立ち上がるか
attribute vec4 aAct; // 応援するチーム（-1 / 0 / 1）、ふだんの腕の角度、しぐさ、タオルを掲げているか
attribute vec2 aLook; // ふだん見ている方向、きょろきょろする速さ
attribute vec2 aShow; // 長い髪・帽子があるか
uniform float uTime;
uniform vec2 uEx;
mat3 crowdRot;
float crowdLift;
mat3 crowdRotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 crowdRotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
mat3 crowdRotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
void crowdPose() {
  vec2 ex = min(uEx, 1.0);
  float fan = aAct.x;
  // 攻撃中のチームのファンは大きく、特にファンでない人は少し、相手のファンはほとんど沸かない。
  float e = fan < -0.5 ? max(ex.x, ex.y) * 0.45 : (fan < 0.5 ? ex.x + ex.y * 0.1 : ex.y + ex.x * 0.1);
  e = min(e, 1.0);
  crowdLift = e * (aMove.x * max(0.0, sin(uTime * aMove.y + aMove.z)) + 0.22 * aMove.w);
  crowdRot = mat3(1.0);
#if CROWD_PART == 1
  // 首：ゆっくりきょろきょろする。沸いているときはグラウンドのほうを向く。
  crowdRot = crowdRotY((aLook.x + 0.25 * sin(uTime * aLook.y + aMove.z)) * (1.0 - e));
#elif CROWD_PART == 2
  // 腕：a は前へ振り上げる角度（0 で真下、-π で真上）、spread は外へ開く大きさ。
  float a = aAct.y;
  float spread = -0.06;
  if (aAct.w > 0.5) {
    a = ${(RAISED + 0.1).toFixed(2)};
    spread = 0.35;
  } else if (e > 0.01) {
    float t = min(1.0, e * 1.5);
    if (aAct.z < 0.5) {
      a += (${RAISED.toFixed(2)} - a) * t;
      spread = 0.15 + 0.35 * t * (0.6 + 0.4 * sin(uTime * aMove.y * 0.5 + aMove.z));
    } else if (aAct.z < 1.5) {
      a += (-1.3 - a) * t;
      spread = -t * (0.08 + 0.22 * max(0.0, sin(uTime * 13.0 + aMove.z)));
    }
  }
  // 腕が上を向いているときは、開く向きが逆になる。
  crowdRot = crowdRotZ(CROWD_SIDE * spread * cos(a)) * crowdRotX(a);
#endif
}
`;

export class Crowd {
  readonly group = new THREE.Group();
  private readonly body: THREE.InstancedMesh;
  private readonly yoke: THREE.InstancedMesh;
  private readonly stripe: THREE.InstancedMesh;
  private readonly head: THREE.InstancedMesh;
  private readonly hair: THREE.InstancedMesh;
  private readonly longHair: THREE.InstancedMesh;
  private readonly cap: THREE.InstancedMesh;
  private readonly arms: THREE.InstancedMesh[];
  private readonly hands: THREE.InstancedMesh[];
  private readonly rigs: Rig[] = [];
  private readonly all: THREE.InstancedMesh[];
  private readonly seats: Seat[];
  /** 応援しているチーム（-1 は特にない）。setTeams で決まる。 */
  private readonly fan: Int8Array;
  /** 体の大きさ・肩幅（人ごと。子どもは小さい）。 */
  private readonly size: Float32Array;
  private readonly width: Float32Array;
  /** 席からのずれ（横・前後）と、体の向きのずれ。きっちり並びすぎないように。 */
  private readonly dx: Float32Array;
  private readonly dz: Float32Array;
  private readonly turn: Float32Array;
  /** シェーダーに渡す人ごとの値（POSE_GLSL の aMove・aAct・aLook）。 */
  private readonly move: THREE.InstancedBufferAttribute;
  private readonly act: THREE.InstancedBufferAttribute;
  private readonly lookAttr: THREE.InstancedBufferAttribute;
  private readonly show: THREE.InstancedBufferAttribute;
  private readonly uniforms = { uTime: { value: 0 }, uEx: { value: new THREE.Vector2() } };
  private readonly flags: { pole: THREE.Group; cloth: THREE.Mesh; team: TeamIndex; phase: number }[] = [];
  private readonly excitement: [number, number] = [0, 0];
  /** 試合の盛り上がり（core/tension.ts）による、攻撃中のチームのファンのふだんの沸き方。安打などの excitement と大きいほうを使う。 */
  private readonly tension: [number, number] = [0, 0];
  /** ラッキーセブンのジェット風船（飛んでいるあいだだけ）。 */
  private balloons: Balloons | null = null;
  /** 名前入りタオル。打席の選手が代わるたびに、その選手のファンが掲げる。 */
  private readonly towels: { mesh: THREE.Mesh; seat: number; phase: number }[] = [];
  private readonly towelGeo = new THREE.PlaneGeometry(TOWEL.w, TOWEL.h);
  private readonly towelMat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
  private towelKey = '';
  private teamColors: [TeamColors, TeamColors] | null = null;
  private time = 0;
  /** 観客の明るさ（1 = ふつう）。暗い球場では下げて、シルエットだけ見せる。 */
  private brightness = 1;

  constructor(seats: Seat[]) {
    this.seats = seats;
    const n = seats.length;
    this.move = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
    this.act = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
    this.lookAttr = new THREE.InstancedBufferAttribute(new Float32Array(n * 2), 2);
    this.show = new THREE.InstancedBufferAttribute(new Float32Array(n * 2), 2);
    const rigOf = (kind: PartKind) => {
      let rig = this.rigs.find((r) => r.kind === kind);
      if (!rig) this.rigs.push((rig = { kind, matrix: new THREE.InstancedBufferAttribute(new Float32Array(n * 16), 16) }));
      return rig;
    };
    const instanced = (geo: THREE.BufferGeometry, kind: PartKind, optional?: Optional) => {
      geo.setAttribute('aMove', this.move);
      geo.setAttribute('aAct', this.act);
      geo.setAttribute('aLook', this.lookAttr);
      geo.setAttribute('aShow', this.show);
      // 置き方はまとまりで共有するので、自前の行列は持たない（数を 0 で作ってから差しかえる）。
      const mesh = new THREE.InstancedMesh(geo, this.material(kind, optional), 0);
      mesh.instanceMatrix = rigOf(kind).matrix;
      mesh.count = n;
      return mesh;
    };
    // 部品の形は、胴は座面、頭は頭の中心、腕は肩を原点にして作り、同じまとまりの部品は同じ行列で置く。
    // 数万人を描くので、どの部品も面の数は少なめにする。
    const ellipse = (geo: THREE.BufferGeometry) => geo.scale(1, 1, TORSO.depth);
    const midY = TORSO.bottom + TORSO.h / 2;
    this.body = instanced(ellipse(new THREE.CylinderGeometry(TORSO.top, TORSO.waist, TORSO.h, 8).translate(0, midY, 0)), 'torso');
    // 肩と胸のラインは胴より少しだけ大きくして、胴の表面に重ねる。
    this.yoke = instanced(ellipse(new THREE.CylinderGeometry(TORSO.top + 0.012, TORSO.top - 0.003, 0.17, 8, 1, true).translate(0, TORSO.bottom + TORSO.h - 0.085, 0)), 'torso');
    const stripeR = (TORSO.top + TORSO.waist) / 2 + 0.012;
    this.stripe = instanced(ellipse(new THREE.CylinderGeometry(stripeR, stripeR - 0.003, 0.06, 8, 1, true).translate(0, midY + 0.02, 0)), 'torso');
    // 頭は少し縦長に、首をつける。
    const skull = new THREE.IcosahedronGeometry(HEAD_R, 1).scale(0.95, 1.1, 1);
    const neck = new THREE.CylinderGeometry(0.06, 0.07, 0.14, 5, 1, true).translate(0, -HEAD_R - 0.03, 0);
    this.head = instanced(mergeGeometries(skull, neck), 'head');
    // 髪：頭のてっぺんと後ろを覆う。長い髪は後ろに垂らす。
    this.hair = instanced(new THREE.SphereGeometry(HEAD_R * 1.07, 9, 4, 0, Math.PI * 2, 0, Math.PI * 0.52).scale(0.95, 1.1, 1).translate(0, 0.01, -0.012), 'head');
    this.longHair = instanced(new THREE.SphereGeometry(HEAD_R * 1.1, 6, 5, Math.PI, Math.PI, 0, Math.PI * 0.85).scale(0.98, 1.25, 1).translate(0, -0.02, -0.015), 'head', 'long');
    const capGeo = new THREE.SphereGeometry(HEAD_R * 1.12, 9, 3, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.03, 0);
    const brim = new THREE.BoxGeometry(0.2, 0.025, 0.13).translate(0, 0.04, HEAD_R * 0.95);
    this.cap = instanced(mergeGeometries(capGeo, brim), 'head', 'cap');
    const armGeo = () => new THREE.CylinderGeometry(0.065, 0.055, ARM_LEN, 5, 1, true).translate(0, -ARM_LEN / 2, 0);
    const handGeo = () => new THREE.IcosahedronGeometry(0.065, 0).translate(0, -ARM_LEN - 0.03, 0);
    this.arms = [instanced(armGeo(), 'armL'), instanced(armGeo(), 'armR')];
    this.hands = [instanced(handGeo(), 'armL'), instanced(handGeo(), 'armR')];
    this.fan = new Int8Array(n);
    this.size = new Float32Array(n);
    this.width = new Float32Array(n);
    this.dx = new Float32Array(n);
    this.dz = new Float32Array(n);
    this.turn = new Float32Array(n);
    this.all = [this.body, this.yoke, this.stripe, this.head, this.hair, this.longHair, this.cap, ...this.arms, ...this.hands];
    const show = this.show.array as Float32Array;
    const pick = <T>(list: T[]) => list[Math.floor(Math.random() * list.length)];
    const move = this.move.array as Float32Array;
    const act = this.act.array as Float32Array;
    const look = this.lookAttr.array as Float32Array;
    seats.forEach((_, i) => {
      // 子どもが少し混ざる。大人も背丈・肩幅がばらばら。
      const child = Math.random() < 0.06;
      this.size[i] = child ? 0.68 + Math.random() * 0.1 : 0.9 + Math.random() * 0.17;
      this.width[i] = 0.9 + Math.random() * 0.22;
      this.dx[i] = (Math.random() - 0.5) * 0.12;
      this.dz[i] = (Math.random() - 0.5) * 0.08;
      this.turn[i] = (Math.random() - 0.5) * 0.35;
      // 跳ねる大きさ（setTeams で決める）・速さ・ずれ、立ち上がるか。
      move[i * 4 + 1] = 9 + Math.random() * 5;
      move[i * 4 + 2] = Math.random() * Math.PI * 2;
      move[i * 4 + 3] = Math.random() < 0.7 ? 1 : 0;
      // ふだんの腕（膝の上あたり）と、沸いたときのしぐさ。
      act[i * 4 + 1] = -0.12 - Math.random() * 0.3;
      const r = Math.random();
      act[i * 4 + 2] = r < 0.55 ? STYLES[0] : r < 0.85 ? STYLES[1] : STYLES[2];
      // たいていはグラウンドを見ていて、ときどき隣の人と話す。
      look[i * 2] = Math.random() < 0.12 ? (Math.random() < 0.5 ? -1 : 1) * (0.6 + Math.random() * 0.5) : (Math.random() - 0.5) * 0.3;
      look[i * 2 + 1] = 0.15 + Math.random() * 0.35;
      show[i * 2] = !child && Math.random() < 0.3 ? 1 : 0;
      const skin = colorOf(pick(SKIN));
      this.head.setColorAt(i, skin);
      for (const h of this.hands) h.setColorAt(i, skin);
      // 白髪まじりは大人だけ。
      const hair = colorOf(HAIR[Math.floor(Math.random() * (child ? HAIR.length - 2 : HAIR.length))]);
      this.hair.setColorAt(i, hair);
      this.longHair.setColorAt(i, hair);
      this.place(i);
    });
    this.setTeams(null);
    // 観客は動くので、カメラの視野判定は球場全体で行う（境界球の再計算を省く）。
    for (const mesh of this.all) {
      mesh.frustumCulled = false;
      this.group.add(mesh);
    }
    this.buildFlags();
  }

  /** 部品の材質。ふつうの Lambert に、POSE_GLSL の動きを足す。 */
  private material(kind: PartKind, optional?: Optional): THREE.MeshLambertMaterial {
    const m = new THREE.MeshLambertMaterial();
    const defines = `#define CROWD_PART ${kind === 'torso' ? 0 : kind === 'head' ? 1 : 2}\n#define CROWD_SIDE ${kind === 'armL' ? '-1.0' : '1.0'}\n`;
    const shown = optional === 'long' ? '\ntransformed *= aShow.x;' : optional === 'cap' ? '\ntransformed *= aShow.y;' : '';
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${defines}${POSE_GLSL}`)
        .replace('#include <beginnormal_vertex>', 'crowdPose();\n#include <beginnormal_vertex>\nobjectNormal = crowdRot * objectNormal;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>\ntransformed = crowdRot * transformed;${shown}`)
        .replace(
          '#include <project_vertex>',
          'vec4 mvPosition = instanceMatrix * vec4(transformed, 1.0);\nmvPosition.y += crowdLift;\nmvPosition = modelViewMatrix * mvPosition;\ngl_Position = projectionMatrix * mvPosition;'
        );
    };
    m.customProgramCacheKey = () => `crowd-${kind}-${optional ?? ''}`;
    return m;
  }

  /** 外野の応援団に球団旗を立てる。 */
  private buildFlags() {
    const poleGeo = new THREE.CylinderGeometry(0.04, 0.04, 3.2, 6).translate(0, 1.6, 0);
    const clothGeo = new THREE.PlaneGeometry(1.8, 1.2).translate(0.9, 0, 0);
    const poleMat = new THREE.MeshLambertMaterial({ color: '#d0d0d0' });
    // 応援団の席（右翼・左翼のポール寄り）に立てる。
    const outfield = this.seats.filter((s) => s.outfield && Math.abs(s.x) > 40);
    for (let k = 0; k < 14; k++) {
      const s = outfield[Math.floor(((k + 0.5) / 14) * outfield.length)];
      if (!s) continue;
      const pole = new THREE.Group();
      pole.position.set(s.x, s.y + 0.4, s.z);
      pole.rotation.y = s.yaw;
      pole.add(new THREE.Mesh(poleGeo, poleMat));
      const cloth = new THREE.Mesh(clothGeo, new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }));
      cloth.position.y = 2.6;
      pole.add(cloth);
      this.group.add(pole);
      this.flags.push({ pole, cloth, team: sideOf(s), phase: Math.random() * 6 });
    }
  }

  /** 観客を暗くする（k は明るさ、1 = ふつう）。体・帽子・旗・タオルの色にかける。 */
  dim(k: number) {
    this.brightness = k;
    this.group.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshLambertMaterial | undefined;
      if (m?.color && !this.flags.some((f) => f.cloth === o)) m.color.setScalar(k);
    });
    this.towelMat.color.setScalar(k);
    for (const f of this.flags) (f.cloth.material as THREE.MeshLambertMaterial).color.multiplyScalar(k);
  }

  /**
   * 席ごとに、どちらのファンで何を着ているかを決める。観客は基本的にチームカラーを組み合わせたユニフォーム姿で、
   * 私服はわずか。試合がなければ私服。teams は [ビジター（先攻）, ホーム（後攻）]。
   */
  setTeams(teams: [TeamColors, TeamColors] | null) {
    this.teamColors = teams;
    this.setBatter(null);
    const color = new THREE.Color();
    // 同じ色の服でも、色あせや光の当たり方で少しずつ違って見えるようにする。
    const cloth = (mesh: THREE.InstancedMesh, i: number, c: string, shade: number) => mesh.setColorAt(i, color.copy(colorOf(c)).multiplyScalar(shade));
    const move = this.move.array as Float32Array;
    const act = this.act.array as Float32Array;
    const show = this.show.array as Float32Array;
    this.seats.forEach((s, i) => {
      const [home, visitor] = teams ? fanShare(s) : [0, 0];
      const r = Math.random();
      const fan: number = r < home ? 1 : r < home + visitor ? 0 : -1;
      this.fan[i] = fan;
      act[i * 4] = fan;
      const casual = CASUAL[Math.floor(Math.random() * CASUAL.length)];
      let wear: Outfit = [casual, casual, casual];
      let cap: string | null = null;
      if (teams && fan >= 0) {
        const t = teams[fan];
        // ホームのファンはホーム用とチームカラーのユニフォームが半々。ビジターのファンはチームカラーのものが多い。
        const k = Math.random();
        const kind = fan === 1 ? (k < 0.5 ? 'home' : k < 0.9 ? 'color' : 'alt') : k < 0.65 ? 'color' : k < 0.85 ? 'alt' : 'home';
        wear = outfit(t, kind);
        if (Math.random() < (s.outfield ? 0.7 : 0.5)) cap = t.cap;
      }
      const shade = 0.93 + Math.random() * 0.14;
      cloth(this.body, i, wear[0], shade);
      cloth(this.yoke, i, wear[1], shade);
      cloth(this.stripe, i, wear[2], shade);
      // 半袖の人は腕が肌の色。
      const sleeve = Math.random() < 0.6;
      for (const arm of this.arms) {
        if (sleeve) cloth(arm, i, wear[0], shade);
        else {
          this.head.getColorAt(i, color);
          arm.setColorAt(i, color);
        }
      }
      this.cap.setColorAt(i, colorOf(cap ?? '#000000'));
      show[i * 2 + 1] = cap ? 1 : 0;
      // 外野の応援団は大きく跳ねる。
      move[i * 4] = (fan >= 0 && s.outfield ? 0.45 : 0.25) + Math.random() * 0.3;
    });
    this.move.needsUpdate = true;
    this.act.needsUpdate = true;
    this.show.needsUpdate = true;
    for (const f of this.flags) {
      (f.cloth.material as THREE.MeshLambertMaterial).color.set(teams ? teams[f.team].primary : '#9e9e9e').multiplyScalar(this.brightness);
      f.pole.visible = !!teams;
    }
    for (const mesh of this.all) mesh.instanceColor!.needsUpdate = true;
  }

  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly sc = new THREE.Vector3();

  /** i 番目の観客を座らせる（動きはシェーダーで足す）。 */
  private place(i: number) {
    const s = this.seats[i];
    const k = this.size[i] * SCALE;
    const w = this.width[i];
    const x = s.x + this.dx[i];
    const z = s.z + this.dz[i];
    this.q.setFromAxisAngle(UP, s.yaw + this.turn[i]);
    for (const rig of this.rigs) {
      if (rig.kind === 'torso') this.v.set(x, s.y, z);
      else if (rig.kind === 'head') this.v.set(x, s.y + HEAD_Y * k, z);
      else this.v.set((rig.kind === 'armL' ? -1 : 1) * SHOULDER.x * w * k, SHOULDER.y * k, 0).applyQuaternion(this.q).add(this.sc.set(x, s.y, z));
      this.m.compose(this.v, this.q, this.sc.set(rig.kind === 'torso' ? k * w : k, k, k));
      (rig.matrix.array as Float32Array).set(this.m.elements, i * 16);
    }
  }

  /** その人がどれだけ沸いているか（0〜1）。POSE_GLSL と同じ計算。 */
  private heat(i: number): number {
    const ex0 = Math.min(1, this.ex(0));
    const ex1 = Math.min(1, this.ex(1));
    const fan = this.fan[i];
    if (fan < 0) return Math.max(ex0, ex1) * 0.45;
    return Math.min(1, fan === 0 ? ex0 + ex1 * 0.1 : ex1 + ex0 * 0.1);
  }

  /** 沸いて立ち上がり、跳ねる高さ。POSE_GLSL と同じ計算。 */
  private lift(i: number, e: number): number {
    const move = this.move.array as Float32Array;
    return e * (move[i * 4] * Math.max(0, Math.sin(this.time * move[i * 4 + 1] + move[i * 4 + 2])) + 0.22 * move[i * 4 + 3]);
  }

  /** タオルを掲げているか（腕を上げたままにする）。 */
  private setHolding(i: number, on: boolean) {
    (this.act.array as Float32Array)[i * 4 + 3] = on ? 1 : 0;
    this.act.needsUpdate = true;
  }

  /**
   * 打席の選手の名前（フルネーム）を書いたタオルを、そのチームのファンの何人かが頭の上に掲げる。
   * null ならタオルをしまう。同じ選手のあいだは同じ人が掲げ続ける。
   */
  setBatter(batter: { id: string; name: string; team: TeamIndex } | null) {
    const key = batter && this.teamColors ? `${batter.team}|${batter.id}` : '';
    if (key === this.towelKey) return;
    this.towelKey = key;
    for (const t of this.towels) {
      this.group.remove(t.mesh);
      this.setHolding(t.seat, false);
    }
    this.towels.length = 0;
    if (!batter || !this.teamColors) return;
    const colors = this.teamColors[batter.team];
    this.towelMat.map?.dispose();
    this.towelMat.map = towelTexture(batter.name, colors.primary, inkOn(colors.primary));
    this.towelMat.needsUpdate = true;
    // そのチームのファンの中から、内野と外野に散らばるように選ぶ。
    const fans = this.seats.map((_, i) => i).filter((i) => this.fan[i] === batter.team);
    for (let k = 0; k < TOWEL_HOLDERS && fans.length; k++) {
      const seat = fans[Math.floor(((k + Math.random()) / TOWEL_HOLDERS) * fans.length) % fans.length];
      const s = this.seats[seat];
      const mesh = new THREE.Mesh(this.towelGeo, this.towelMat);
      // 球場全体は左右反転して描くので、タオルだけ反転を戻して文字が読めるようにする。
      mesh.scale.set(-SCALE, SCALE, SCALE);
      mesh.rotation.y = s.yaw;
      this.towels.push({ mesh, seat, phase: Math.random() * Math.PI * 2 });
      this.group.add(mesh);
      this.setHolding(seat, true);
    }
    this.placeTowels();
  }

  /** タオルを持ち主の掲げた手の上に置く（沸いているときは振る）。 */
  private placeTowels() {
    for (const t of this.towels) {
      const i = t.seat;
      const s = this.seats[i];
      const e = Math.min(1, this.heat(i));
      const bob = Math.sin(this.time * 3 + t.phase);
      const k = this.size[i] * SCALE;
      t.mesh.position.set(s.x + this.dx[i], s.y + this.lift(i, e) + (SHOULDER.y + ARM_LEN + 0.1 + 0.03 * bob) * k, s.z + this.dz[i]);
      t.mesh.rotation.z = bob * (0.05 + 0.25 * e);
    }
  }

  /** 沸かせる。strength は 0.5（安打）〜 1.2（本塁打）くらい。team は攻撃中のチーム。 */
  cheer(strength: number, team: TeamIndex) {
    this.excitement[team] = Math.max(this.excitement[team], Math.min(1.3, strength));
  }

  /** 盛り上がり（0〜1）を伝える。team は攻撃中のチーム（相手のファンは落ち着く）。 */
  setTension(team: TeamIndex, level: number) {
    this.tension[team] = TENSION_SHARE * level;
    this.tension[team === 0 ? 1 : 0] = 0;
  }

  private ex(team: TeamIndex) {
    return Math.max(this.excitement[team], this.tension[team]);
  }

  /** ラッキーセブン：team のファンの席から、チームカラーのジェット風船を一斉に飛ばす。 */
  releaseBalloons(team: TeamIndex) {
    this.balloons?.dispose(this.group);
    const seats = this.seats.filter((_, i) => this.fan[i] === team);
    const colors = this.teamColors?.[team];
    this.balloons = seats.length ? new Balloons(seats, colors ? [colors.primary, colors.secondary, '#ffffff'] : ['#ffffff'], this.brightness) : null;
    if (this.balloons) this.group.add(this.balloons.mesh);
    this.cheer(1.1, team);
  }

  update(dt: number) {
    this.time += dt;
    for (const t of [0, 1] as const) this.excitement[t] = Math.max(0, this.excitement[t] - dt * 0.4);
    if (this.balloons && !this.balloons.update(dt)) {
      this.balloons.dispose(this.group);
      this.balloons = null;
    }
    // 旗はいつも少しなびき、沸いているチームの旗は大きく振る。
    for (const f of this.flags) {
      const e = Math.min(1, this.ex(f.team));
      f.cloth.rotation.y = Math.sin(this.time * 2 + f.phase) * 0.25;
      f.pole.rotation.z = Math.sin(this.time * 6 + f.phase) * 0.45 * e;
    }
    this.placeTowels();
    this.uniforms.uTime.value = this.time;
    this.uniforms.uEx.value.set(this.ex(0), this.ex(1));
  }
}

/** 盛り上がり 1 のときの沸き方（本塁打の 1.2 に対して）。 */
const TENSION_SHARE = 0.6;
/** ジェット風船：飛ばす数の上限、飛ぶ時間（秒）、上がる速さ（m/s）。 */
const BALLOONS = 1100;
const BALLOON_LIFE = 6.5;
const BALLOON_SPEED = 17;

/** ジェット風船の群れ。席から一斉に上がり、くねりながら飛んで、しぼんで落ちる。 */
class Balloons {
  readonly mesh: THREE.InstancedMesh;
  private time = 0;
  private readonly from: THREE.Vector3[] = [];
  private readonly vel: THREE.Vector3[] = [];
  private readonly delay: number[] = [];
  private readonly wiggle: number[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly p = new THREE.Vector3();
  private readonly sc = new THREE.Vector3();

  constructor(seats: Seat[], colors: string[], brightness: number) {
    const n = Math.min(BALLOONS, seats.length);
    // 細長い風船（上が丸く、下がすぼまる）。
    const geo = new THREE.CapsuleGeometry(0.17, 1.3, 4, 8);
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial(), n);
    this.mesh.frustumCulled = false;
    const c = new THREE.Color();
    for (let k = 0; k < n; k++) {
      const s = seats[Math.floor(Math.random() * seats.length)];
      this.from.push(new THREE.Vector3(s.x, s.y + 2.2, s.z));
      // 少しグラウンド側へ、ばらばらの向きに上がる。
      const out = 2 + Math.random() * 3;
      this.vel.push(new THREE.Vector3(Math.sin(s.yaw) * out + (Math.random() - 0.5) * 3, BALLOON_SPEED * (0.75 + Math.random() * 0.5), Math.cos(s.yaw) * out + (Math.random() - 0.5) * 3));
      this.delay.push(Math.random() * 0.6);
      this.wiggle.push(Math.random() * Math.PI * 2);
      this.mesh.setColorAt(k, c.set(colors[k % colors.length]).multiplyScalar(brightness));
    }
    this.update(0);
  }

  /** dt 秒進める。飛び終えたら false。 */
  update(dt: number): boolean {
    this.time += dt;
    for (let k = 0; k < this.from.length; k++) {
      const t = Math.max(0, this.time - this.delay[k]);
      const v = this.vel[k];
      // 空気が抜けるまでは上がり続けて減速し、抜けたら落ちる。
      const up = Math.min(t, 2.2);
      const fall = Math.max(0, t - 2.2);
      const y = v.y * up - 3.2 * up * up - 4.5 * fall * fall;
      const w = Math.sin(t * 9 + this.wiggle[k]);
      this.p.set(this.from[k].x + v.x * t * 0.6 + w * 0.6, this.from[k].y + Math.max(-2, y), this.from[k].z + v.z * t * 0.6 + Math.cos(t * 7 + this.wiggle[k]) * 0.6);
      // 上がるあいだは上を向いてくねり、しぼむと小さくなって転がる。
      this.e.set(w * 0.5 + fall * 2, this.wiggle[k], Math.cos(t * 9 + this.wiggle[k]) * 0.5 + fall * 3);
      this.q.setFromEuler(this.e);
      const size = t === 0 && this.time < this.delay[k] ? 0 : Math.max(0, 1 - fall / (BALLOON_LIFE - 2.2)) * (fall ? 0.6 : 1);
      this.sc.setScalar(size);
      this.m.compose(this.p, this.q, this.sc);
      this.mesh.setMatrixAt(k, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    return this.time < BALLOON_LIFE + 0.6;
  }

  dispose(group: THREE.Group) {
    group.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

/** 名前入りタオルの絵（チームカラーの地に名前、上下に細い線）。 */
function towelTexture(name: string, bg: string, ink: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const g = canvas.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, 512, 128);
  g.fillStyle = ink;
  g.fillRect(0, 10, 512, 6);
  g.fillRect(0, 112, 512, 6);
  g.font = 'bold 76px "Hiragino Sans", "Noto Sans JP", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(name, 256, 66, 480);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** 位置と法線だけの形を 1 つにまとめる。 */
function mergeGeometries(...geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  for (const g of geos) {
    const ng = g.index ? g.toNonIndexed() : g;
    pos.push(...(ng.getAttribute('position').array as Float32Array));
    nor.push(...(ng.getAttribute('normal').array as Float32Array));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return out;
}
