// 観客席の観客。数千人を InstancedMesh で描き、安打・得点・本塁打のときに跳ねて沸く。
// 観客は基本的に応援する球団のユニフォーム姿（チームカラーを組み合わせたもの）。プロ野球の球場のように全体ではホームのファンが多く、
// 右翼はホームの応援団、左翼のポール寄りはビジターの応援団。沸くのは攻撃中のチームのファンが中心。
import * as THREE from 'three';
import type { TeamColors } from '../core/teams.ts';
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
const BODY = { w: 0.5, h: 0.62, d: 0.38 };
const HEAD_R = 0.15;
const SKIN = ['#f1c9a5', '#e8b996', '#d9a47c', '#f6d7bd', '#c68a62'];
/** 私服（ユニフォームを着ていない少数の人。落ち着いた色が多い）。 */
const CASUAL = ['#f5f5f5', '#e8e0d0', '#2b2b2b', '#3e4a61', '#8a8f98', '#5d6d7e', '#c8b79a', '#6d4c41', '#a5b4c4', '#b0413e'];

/** 一塁側（core の +x）がホーム（後攻）。 */
const sideOf = (s: Seat): TeamIndex => (s.x > 0 ? 1 : 0);

/**
 * その席に座るファンの割合 [ホーム, ビジター]（残りは私服）。プロ野球の球場のように全体ではホームが多く、
 * ビジターのファンは三塁側の内野と左翼のポール寄り（ビジター応援団）に集まる。
 */
export function fanShare(s: Pick<Seat, 'x' | 'z' | 'outfield'>): [number, number] {
  if (s.outfield) {
    if (s.x > 0) return [0.96, 0.02];
    // 左翼はポール寄りがビジター応援団、中堅寄りはホームのファン。
    return s.x < -35 ? [0.12, 0.84] : [0.7, 0.26];
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

/** 観客の体の部品。y は座面からの高さ（拡大前）。 */
interface Part {
  mesh: THREE.InstancedMesh;
  y: number;
}

export class Crowd {
  readonly group = new THREE.Group();
  private readonly body: THREE.InstancedMesh;
  private readonly yoke: THREE.InstancedMesh;
  private readonly stripe: THREE.InstancedMesh;
  private readonly head: THREE.InstancedMesh;
  private readonly cap: THREE.InstancedMesh;
  private readonly parts: Part[];
  private readonly seats: Seat[];
  private readonly baseY: Float32Array;
  /** 応援しているチーム（-1 は特にない）。setTeams で決まる。 */
  private readonly fan: Int8Array;
  /** 帽子をかぶっているか。 */
  private readonly capped: Uint8Array;
  /** 跳ねる大きさ・速さ・ずれ（人ごと）。 */
  private readonly amp: Float32Array;
  private readonly rate: Float32Array;
  private readonly phase: Float32Array;
  private readonly flags: { pole: THREE.Group; cloth: THREE.Mesh; team: TeamIndex; phase: number }[] = [];
  private readonly excitement: [number, number] = [0, 0];
  private moving = false;
  private time = 0;

  constructor(seats: Seat[]) {
    this.seats = seats;
    const n = seats.length;
    const instanced = (geo: THREE.BufferGeometry) => new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial(), n);
    this.body = instanced(new THREE.BoxGeometry(BODY.w, BODY.h, BODY.d));
    // 肩と胸のラインは胴より少しだけ大きくして、胴の表面に重ねる。
    this.yoke = instanced(new THREE.BoxGeometry(BODY.w + 0.02, 0.17, BODY.d + 0.02));
    this.stripe = instanced(new THREE.BoxGeometry(BODY.w + 0.015, 0.06, BODY.d + 0.015));
    this.head = instanced(new THREE.IcosahedronGeometry(HEAD_R, 1));
    const capGeo = new THREE.SphereGeometry(HEAD_R * 1.08, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2);
    const brim = new THREE.BoxGeometry(0.2, 0.025, 0.13).translate(0, 0.01, HEAD_R * 0.95);
    this.cap = instanced(mergeGeometries(capGeo, brim));
    const bodyY = BODY.h / 2 + 0.2;
    const headY = BODY.h + 0.2 + HEAD_R * 0.9;
    this.parts = [
      { mesh: this.body, y: bodyY },
      { mesh: this.yoke, y: bodyY + BODY.h / 2 - 0.08 },
      { mesh: this.stripe, y: bodyY + 0.02 },
      { mesh: this.head, y: headY },
      { mesh: this.cap, y: headY + 0.02 / SCALE }
    ];
    this.baseY = new Float32Array(n);
    this.fan = new Int8Array(n);
    this.capped = new Uint8Array(n);
    this.amp = new Float32Array(n);
    this.rate = new Float32Array(n);
    this.phase = new Float32Array(n);
    const color = new THREE.Color();
    seats.forEach((s, i) => {
      this.baseY[i] = s.y;
      this.head.setColorAt(i, color.set(SKIN[i % SKIN.length]));
      this.rate[i] = 9 + Math.random() * 5;
      this.phase[i] = Math.random() * Math.PI * 2;
    });
    this.setTeams(null);
    // 観客は動くので、カメラの視野判定は球場全体で行う（境界球の再計算を省く）。
    for (const { mesh } of this.parts) {
      mesh.frustumCulled = false;
      this.group.add(mesh);
    }
    this.buildFlags();
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

  /**
   * 席ごとに、どちらのファンで何を着ているかを決める。観客は基本的にチームカラーを組み合わせたユニフォーム姿で、
   * 私服はわずか。試合がなければ私服。teams は [ビジター（先攻）, ホーム（後攻）]。
   */
  setTeams(teams: [TeamColors, TeamColors] | null) {
    const color = new THREE.Color();
    this.seats.forEach((s, i) => {
      const [home, visitor] = teams ? fanShare(s) : [0, 0];
      const r = Math.random();
      const fan: number = r < home ? 1 : r < home + visitor ? 0 : -1;
      this.fan[i] = fan;
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
      this.body.setColorAt(i, color.set(wear[0]));
      this.yoke.setColorAt(i, color.set(wear[1]));
      this.stripe.setColorAt(i, color.set(wear[2]));
      this.cap.setColorAt(i, color.set(cap ?? '#000000'));
      this.capped[i] = cap ? 1 : 0;
      // 外野の応援団は大きく跳ねる。
      this.amp[i] = (fan >= 0 && s.outfield ? 0.45 : 0.25) + Math.random() * 0.3;
      this.place(i);
    });
    for (const f of this.flags) {
      (f.cloth.material as THREE.MeshLambertMaterial).color.set(teams ? teams[f.team].primary : '#9e9e9e');
      f.pole.visible = !!teams;
    }
    for (const { mesh } of this.parts) {
      mesh.instanceColor!.needsUpdate = true;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly one = new THREE.Vector3(SCALE, SCALE, SCALE);
  private readonly none = new THREE.Vector3(0, 0, 0);

  /** i 番目の観客の部品を座面に置く（帽子をかぶらない人は帽子を大きさ 0 にする）。 */
  private place(i: number) {
    const s = this.seats[i];
    this.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, s.yaw);
    for (const { mesh, y } of this.parts) {
      const size = mesh === this.cap && !this.capped[i] ? this.none : this.one;
      this.m.compose(this.v.set(s.x, this.baseY[i] + y * SCALE, s.z), this.q, size);
      mesh.setMatrixAt(i, this.m);
    }
  }

  /** 沸かせる。strength は 0.5（安打）〜 1.2（本塁打）くらい。team は攻撃中のチーム。 */
  cheer(strength: number, team: TeamIndex) {
    this.excitement[team] = Math.max(this.excitement[team], Math.min(1.3, strength));
  }

  update(dt: number) {
    this.time += dt;
    for (const t of [0, 1] as const) this.excitement[t] = Math.max(0, this.excitement[t] - dt * 0.4);
    // 旗はいつも少しなびき、沸いているチームの旗は大きく振る。
    for (const f of this.flags) {
      const e = Math.min(1, this.excitement[f.team]);
      f.cloth.rotation.y = Math.sin(this.time * 2 + f.phase) * 0.25;
      f.pole.rotation.z = Math.sin(this.time * 6 + f.phase) * 0.45 * e;
    }
    const active = this.excitement[0] > 0 || this.excitement[1] > 0;
    if (!active && !this.moving) return;
    // 跳ねる高さだけを、各部品の行列の y 成分（添字 13）に書き込む。
    const parts = this.parts.map((p) => ({ a: p.mesh.instanceMatrix.array as Float32Array, y: p.y * SCALE }));
    const ex = [Math.min(1, this.excitement[0]), Math.min(1, this.excitement[1])];
    const neutral = Math.max(ex[0], ex[1]) * 0.45;
    for (let i = 0; i < this.seats.length; i++) {
      const fan = this.fan[i];
      // 攻撃中のチームのファンは大きく、特にファンでない人は少し、相手のファンはほとんど跳ねない。
      const e = fan < 0 ? neutral : ex[fan] + ex[1 - fan] * 0.1;
      const y = this.baseY[i] + e * this.amp[i] * Math.max(0, Math.sin(this.time * this.rate[i] + this.phase[i]));
      for (const p of parts) p.a[i * 16 + 13] = y + p.y;
    }
    for (const { mesh } of this.parts) mesh.instanceMatrix.needsUpdate = true;
    this.moving = active;
  }
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
