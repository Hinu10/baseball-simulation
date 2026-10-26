// 等身に近い選手モデル。ユニフォームの切替と既存の姿勢アニメーションを共通の骨格で扱う。
// 動作は「状態の名前」と「その状態になってからの秒」から毎フレーム姿勢を計算する（キーフレームのアセットは使わない）。
import * as THREE from 'three';
import { SWING_DURATION } from '../core/batting.ts';
import { WINDUP_TIME } from '../core/pitching.ts';
import { textColor } from '../core/teams.ts';
import { mat, mesh } from './materials.ts';
import type { UniformLook } from './uniforms.ts';

export type PoseName =
  | 'idle'
  | 'run'
  | 'walk'
  | 'highfive'
  | 'hurt'
  | 'shove'
  | 'point'
  | 'catch'
  | 'throw'
  | 'dive'
  | 'pitch'
  | 'bat'
  | 'swing'
  | 'bunt'
  | 'warmup'
  | 'crouch'
  | 'call'
  | 'strikeout'
  | 'safe';

export interface Pose {
  name: PoseName;
  /** その動作を始めてからの秒。 */
  t: number;
  /** 打席の左右（左打者は動きを左右反転）。 */
  bats?: 'R' | 'L';
  /** 投げる手（左投手は投球動作を左右反転）。 */
  throws?: 'R' | 'L';
}

const SKIN = '#c99169';
const GLOVE = '#684026';
const WOOD = '#bd894f';
const SHOE = '#20242a';

const fabrics = new Map<string, THREE.MeshStandardMaterial>();
function jerseyMaterial(look: UniformLook): THREE.MeshStandardMaterial {
  const key = `${look.uniform}|${look.trim}|${look.pattern}`;
  let material = fabrics.get(key);
  if (material) return material;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const g = canvas.getContext('2d')!;
  g.fillStyle = look.uniform;
  g.fillRect(0, 0, 256, 256);
  if (look.pattern === 'pinstripe') {
    g.globalAlpha = 0.68;
    g.fillStyle = look.trim;
    for (let x = 8; x < 256; x += 26) g.fillRect(x, 0, 2, 256);
    g.globalAlpha = 1;
  } else if (look.pattern === 'side') {
    g.fillStyle = look.trim;
    g.fillRect(66, 0, 27, 256);
    g.fillRect(163, 0, 27, 256);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.91, metalness: 0 });
  fabrics.set(key, material);
  return material;
}

/** 胸マーク（球団の頭文字）のテクスチャ。球団・色ごとに使い回す。 */
const marks = new Map<string, THREE.MeshBasicMaterial>();
function markMaterial(letter: string, color: string): THREE.MeshBasicMaterial {
  const key = `${letter}|${color}`;
  let m = marks.get(key);
  if (!m) {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 64;
    const g = c.getContext('2d')!;
    g.font = `italic 900 ${letter.length > 1 ? 43 : 54}px sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 4;
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.fillStyle = color;
    g.strokeText(letter, 64, 35);
    g.fillText(letter, 64, 35);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    m = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false });
    marks.set(key, m);
  }
  return m;
}

const numbers = new Map<string, THREE.MeshBasicMaterial>();
function numberMaterial(number: number, color: string): THREE.MeshBasicMaterial {
  const key = `${number}|${color}`;
  let material = numbers.get(key);
  if (material) return material;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const g = canvas.getContext('2d')!;
  g.font = '900 50px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 5;
  g.strokeStyle = 'rgba(0,0,0,0.4)';
  g.fillStyle = color;
  g.strokeText(String(number), 32, 35);
  g.fillText(String(number), 32, 35);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false });
  numbers.set(key, material);
  return material;
}

const smooth = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** 時刻 t でのキーの間を補間する（[時刻, 値] の列）。 */
function keys(t: number, k: [number, number][]): number {
  if (t <= k[0][0]) return k[0][1];
  for (let i = 1; i < k.length; i++) {
    if (t <= k[i][0]) return lerp(k[i - 1][1], k[i][1], smooth((t - k[i - 1][0]) / (k[i][0] - k[i - 1][0])));
  }
  return k[k.length - 1][1];
}

/** 素振りの進み（スイングの 0〜1.8 と同じ尺度）：WARMUP_CYCLE 秒ごとに、構えてからゆっくり振り、構えへ戻る。 */
const WARMUP_CYCLE = 3;
function practiceSwing(t: number): number {
  const c = t % WARMUP_CYCLE;
  return keys(c, [
    [0, 0],
    [1.6, 0],
    [2.3, 1.8],
    [2.6, 1.8],
    [3, 0]
  ]);
}

export class PlayerFigure {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly upper = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly legL = new THREE.Group();
  private readonly legR = new THREE.Group();
  private readonly armL = new THREE.Group();
  private readonly armR = new THREE.Group();
  private readonly batYaw = new THREE.Group();
  private readonly batTilt = new THREE.Group();
  private readonly glove: THREE.Mesh;
  private readonly backNumber: THREE.Mesh;
  private readonly numberColor: string;
  private shownNumber = -1;
  /** 監督：チームカラーのジャンパーを着て、グラブを持たない。 */
  private readonly manager: boolean;

  /** mark は胸の文字（球団の頭文字）。manager なら監督の姿にする。 */
  constructor(look: UniformLook, mark = '', o: { manager?: boolean } = {}) {
    this.manager = !!o.manager;
    const uniform = jerseyMaterial(look);
    const pants = mat(look.pants);
    const team = mat(look.primary);
    const accent = mat(look.trim);
    const skin = mat(SKIN);
    const shoe = mat(SHOE);
    this.numberColor = look.lettering;
    this.root.add(this.body);

    // 脚は胴より長く、膝から裾に向かって少し絞る。裾・スパイクにも色を分ける。
    for (const [leg, x, direction] of [
      [this.legL, -0.13, -1],
      [this.legR, 0.13, 1]
    ] as const) {
      leg.position.set(x, 0.94, 0);
      leg.add(mesh(new THREE.CapsuleGeometry(0.105, 0.32, 5, 12), pants, 0, -0.25, 0));
      leg.add(mesh(new THREE.CapsuleGeometry(0.086, 0.28, 5, 12), pants, 0, -0.64, 0));
      leg.add(mesh(new THREE.BoxGeometry(0.012, 0.57, 0.012), accent, direction * 0.097, -0.49, 0.015));
      leg.add(mesh(new THREE.CylinderGeometry(0.092, 0.085, 0.07, 12), accent, 0, -0.83, 0));
      leg.add(mesh(new THREE.BoxGeometry(0.17, 0.1, 0.29), shoe, 0, -0.9, 0.075));
      this.body.add(leg);
    }

    // ジャージーは肩から腰へ絞り、襟・前立て・ベルトを重ねる。
    this.upper.position.y = 0.94;
    this.body.add(this.upper);
    const torso = mesh(new THREE.CylinderGeometry(this.manager ? 0.285 : 0.255, this.manager ? 0.25 : 0.18, 0.57, 20), this.manager ? team : uniform, 0, 0.33, 0);
    torso.scale.z = 0.78;
    this.upper.add(torso);
    this.upper.add(mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.055, 16), mat('#272727'), 0, 0.035, 0));
    this.upper.add(mesh(new THREE.BoxGeometry(0.075, 0.045, 0.012), accent, 0, 0.035, 0.18));
    this.upper.add(mesh(new THREE.CylinderGeometry(0.115, 0.115, 0.08, 14), accent, 0, 0.625, 0));
    this.upper.add(mesh(new THREE.BoxGeometry(0.014, 0.48, 0.015), accent, 0, 0.32, 0.201));
    if (look.pattern === 'piping') {
      for (const x of [-0.105, 0.105]) this.upper.add(mesh(new THREE.BoxGeometry(0.011, 0.46, 0.013), accent, x, 0.33, 0.165));
    }
    if (look.pattern === 'shoulder') {
      for (const x of [-0.2, 0.2]) {
        const panel = mesh(new THREE.SphereGeometry(0.17, 12, 8), accent, x, 0.53, 0);
        panel.scale.set(0.8, 0.37, 0.86);
        this.upper.add(panel);
      }
    }
    if (mark) {
      const chest = mesh(new THREE.PlaneGeometry(0.33, 0.17), markMaterial(mark, look.lettering || textColor(look)), 0, 0.4, 0.185);
      // 球場は x を反転して表示するので、文字が裏返らないよう戻す。
      chest.scale.x = -1;
      this.upper.add(chest);
    }
    this.backNumber = mesh(new THREE.PlaneGeometry(0.25, 0.25), numberMaterial(0, this.numberColor), 0, 0.37, -0.19);
    this.backNumber.rotation.y = Math.PI;
    this.backNumber.visible = false;
    this.upper.add(this.backNumber);

    this.head.position.y = 0.78;
    this.upper.add(this.head);
    const face = mesh(new THREE.SphereGeometry(0.145, 20, 16), skin);
    face.scale.set(0.91, 1.04, 0.87);
    this.head.add(face);
    for (const x of [-0.135, 0.135]) {
      const ear = mesh(new THREE.SphereGeometry(0.028, 8, 6), skin, x, -0.01, 0);
      ear.scale.set(0.6, 1, 0.6);
      this.head.add(ear);
    }
    const nose = mesh(new THREE.SphereGeometry(0.025, 10, 8), skin, 0, -0.018, 0.128);
    nose.scale.set(0.72, 0.8, 1.25);
    this.head.add(nose);
    for (const x of [-0.048, 0.048]) {
      const eye = mesh(new THREE.SphereGeometry(0.01, 8, 6), mat('#252126'), x, 0.015, 0.118);
      eye.scale.y = 0.56;
      this.head.add(eye);
      this.head.add(mesh(new THREE.BoxGeometry(0.035, 0.006, 0.008), mat('#5b382b'), x, 0.047, 0.122));
    }
    const cap = mesh(new THREE.SphereGeometry(0.155, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat(look.cap), 0, 0.025, 0);
    this.head.add(cap);
    const brim = mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.018, 18, 1, false, -Math.PI / 2, Math.PI), mat(look.cap), 0, 0.045, 0.12);
    brim.scale.z = 0.65;
    this.head.add(brim);
    this.head.add(mesh(new THREE.BoxGeometry(0.06, 0.065, 0.009), accent, 0, 0.105, 0.127));

    for (const [arm, x] of [
      [this.armL, -0.275],
      [this.armR, 0.275]
    ] as const) {
      arm.position.set(x, 0.54, 0);
      arm.add(mesh(new THREE.CapsuleGeometry(0.082, 0.15, 5, 10), this.manager ? team : uniform, 0, -0.12, 0));
      arm.add(mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.028, 12), accent, 0, -0.25, 0));
      arm.add(mesh(new THREE.CapsuleGeometry(0.055, 0.18, 5, 10), this.manager ? team : skin, 0, -0.38, 0));
      arm.add(mesh(new THREE.SphereGeometry(0.055, 10, 8), skin, 0, -0.53, 0));
      this.upper.add(arm);
    }
    this.glove = mesh(new THREE.SphereGeometry(0.115, 12, 10), mat(GLOVE), 0, -0.53, 0.035);
    this.glove.scale.set(1.2, 0.95, 0.7);
    this.armL.add(this.glove);

    // バット：胸の前を軸に回す（batYaw が水平の振り、batTilt が立て具合）。
    this.batYaw.position.set(0, 0.45, 0.09);
    this.upper.add(this.batYaw);
    this.batYaw.add(this.batTilt);
    const bat = mesh(new THREE.CylinderGeometry(0.027, 0.045, 0.92, 12), mat(WOOD), 0, 0, 0.5);
    bat.rotation.x = Math.PI / 2;
    this.batTilt.add(bat);
    this.batYaw.visible = false;
  }

  setNumber(number: number | undefined) {
    this.backNumber.visible = number !== undefined && !this.manager;
    if (number === undefined || number === this.shownNumber) return;
    this.backNumber.material = numberMaterial(number, this.numberColor);
    this.shownNumber = number;
  }

  private reset() {
    this.body.position.set(0, 0, 0);
    this.upper.position.y = 0.94;
    this.batYaw.position.y = 0.45;
    this.body.rotation.set(0, 0, 0);
    this.upper.rotation.set(0, 0, 0);
    this.head.rotation.set(0, 0, 0);
    for (const g of [this.legL, this.legR, this.armL, this.armR]) g.rotation.set(0, 0, 0);
    this.armL.rotation.z = -0.12;
    this.armR.rotation.z = 0.12;
    this.batYaw.visible = false;
    this.glove.visible = !this.manager;
    this.armL.add(this.glove);
    this.batYaw.rotation.set(0, 0, 0);
    this.batTilt.rotation.set(0, 0, 0);
  }

  pose(p: Pose) {
    this.reset();
    const t = p.t;
    const side = p.bats === 'L' ? -1 : 1;
    switch (p.name) {
      case 'idle': {
        const b = Math.sin(t * 2.2) * 0.015;
        this.upper.position.y = 0.94 + b;
        this.armL.rotation.x = -0.15;
        this.armR.rotation.x = -0.05;
        break;
      }
      case 'run': {
        const w = Math.sin(t * 11);
        this.legL.rotation.x = w * 0.9;
        this.legR.rotation.x = -w * 0.9;
        this.armL.rotation.x = -w * 0.8;
        this.armR.rotation.x = w * 0.8;
        this.body.rotation.x = 0.22;
        this.body.position.y = Math.abs(Math.cos(t * 11)) * 0.06;
        break;
      }
      case 'walk': {
        const w = Math.sin(t * 6.5);
        this.legL.rotation.x = w * 0.45;
        this.legR.rotation.x = -w * 0.45;
        this.armL.rotation.x = -w * 0.35;
        this.armR.rotation.x = w * 0.35;
        this.body.position.y = Math.abs(Math.cos(t * 6.5)) * 0.025;
        break;
      }
      case 'highfive': {
        // 右手を高く上げ、相手の手に合わせて振り下ろす（打者と出迎えの仲間）。
        this.armR.rotation.x = keys(t, [
          [0, -0.3],
          [0.25, -2.9],
          [0.38, -2.5],
          [0.7, -0.4]
        ]);
        this.armR.rotation.z = keys(t, [
          [0, 0],
          [0.25, 0.25],
          [0.7, 0]
        ]);
        this.armL.rotation.x = -0.2;
        this.body.rotation.x = keys(t, [
          [0, 0],
          [0.35, -0.08],
          [0.7, 0]
        ]);
        this.body.position.y = keys(t, [
          [0, 0],
          [0.3, 0.08],
          [0.45, 0],
          [0.7, 0]
        ]);
        break;
      }
      case 'hurt': {
        // 死球：当たった腕を押さえて前かがみになり、少しよろける。
        const k = smooth(t / 0.25);
        this.body.rotation.x = 0.55 * k;
        this.body.rotation.z = Math.sin(t * 6) * 0.06 * k;
        this.body.position.y = -0.08 * k;
        this.legL.rotation.x = -0.35 * k;
        this.legR.rotation.x = 0.2 * k;
        this.armL.rotation.x = -0.4 * k;
        this.armR.rotation.x = -1.3 * k;
        this.armR.rotation.z = -0.7 * k;
        this.glove.visible = false;
        break;
      }
      case 'shove': {
        // 乱闘：両腕を前に突き出して押し合う。足を踏ん張り、前後に揺れる。
        const w = Math.sin(t * 5);
        this.body.rotation.x = 0.3 + w * 0.08;
        this.legL.rotation.x = -0.45;
        this.legR.rotation.x = 0.35;
        this.armL.rotation.x = -1.45 + w * 0.25;
        this.armR.rotation.x = -1.45 - w * 0.25;
        this.armL.rotation.z = 0.15;
        this.armR.rotation.z = -0.15;
        this.head.rotation.y = Math.sin(t * 2.3) * 0.25;
        this.glove.visible = false;
        break;
      }
      case 'point': {
        // 抗議：片手で相手を指さし、もう片手を振り回す。
        this.armR.rotation.x = -1.55 + Math.sin(t * 7) * 0.15;
        this.armL.rotation.x = keys(t % 1.6, [
          [0, -0.3],
          [0.4, -2.2],
          [0.8, -0.6],
          [1.2, -1.9],
          [1.6, -0.3]
        ]);
        this.body.rotation.x = 0.12 + Math.sin(t * 3) * 0.05;
        this.head.rotation.x = Math.sin(t * 9) * 0.06;
        break;
      }
      case 'catch': {
        const k = keys(t, [
          [0, 0],
          [0.12, 1],
          [0.45, 0.6]
        ]);
        this.armL.rotation.x = -1.7 * k;
        this.armL.rotation.z = -0.1;
        this.armR.rotation.x = -0.9 * k;
        this.body.rotation.x = 0.25 * k;
        break;
      }
      case 'throw': {
        this.armR.rotation.x = keys(t, [
          [0, 2.3],
          [0.12, 2.6],
          [0.28, -1.4],
          [0.45, -0.8]
        ]);
        this.armL.rotation.x = keys(t, [
          [0, -1.2],
          [0.28, 0.3]
        ]);
        this.upper.rotation.y = keys(t, [
          [0, 0.5],
          [0.28, -0.5]
        ]);
        this.legL.rotation.x = -0.5;
        this.body.rotation.x = keys(t, [
          [0, -0.1],
          [0.3, 0.3]
        ]);
        break;
      }
      case 'dive': {
        const k = smooth(t / 0.2);
        this.body.rotation.x = 1.35 * k;
        this.body.position.y = -0.25 * k;
        this.armL.rotation.x = -2.9 * k;
        this.armR.rotation.x = -2.6 * k;
        this.legL.rotation.x = 0.3 * k;
        this.legR.rotation.x = 0.5 * k;
        break;
      }
      case 'pitch': {
        // セット（胸の前で両手を合わせる）→ 脚を高く上げて体を閉じる → 踏み出して沈み込み、腕を後ろへ引いてトップを作る
        // → 体を開きながら前へ倒れ込んでリリース → 腕を振り抜き、軸足が後ろから跳ね上がる → 守備の構えへ戻る。
        // 左投手は左右を反転する（投げる腕・上げる脚・グラブの手が入れ替わる）。
        const w = WINDUP_TIME;
        const hand = p.throws === 'L' ? -1 : 1;
        const [arm, gloveArm] = hand === 1 ? [this.armR, this.armL] : [this.armL, this.armR];
        const [lead, back] = hand === 1 ? [this.legL, this.legR] : [this.legR, this.legL];
        gloveArm.add(this.glove);
        lead.rotation.x = keys(t, [
          [0, 0],
          [w * 0.12, -0.15],
          [w * 0.45, -1.7],
          [w * 0.62, -1.3],
          [w * 0.85, -0.75],
          [w + 0.1, -0.55],
          [w + 0.6, -0.15],
          [w + 1.0, 0]
        ]);
        lead.rotation.z = -hand * keys(t, [
          [0, 0],
          [w * 0.45, 0.25],
          [w * 0.85, 0],
          [w + 0.6, 0.12]
        ]);
        back.rotation.x = keys(t, [
          [0, 0],
          [w * 0.45, 0.05],
          [w * 0.85, 0.45],
          [w, 0.7],
          [w + 0.25, 1.25],
          [w + 0.5, 0.1],
          [w + 1.0, 0]
        ]);
        // 投げる腕：手を合わせた位置 → 下から後ろへ回す → 頭の後ろ（トップ）→ 前へ振り下ろす → 体の前で止める。
        arm.rotation.x = keys(t, [
          [0, -0.85],
          [w * 0.45, -1.05],
          [w * 0.6, 0.6],
          [w * 0.85, 2.75],
          [w, -1.45],
          [w + 0.15, -0.6],
          [w + 0.5, -0.3],
          [w + 1.0, 0]
        ]);
        arm.rotation.z =
          hand *
          keys(t, [
            [0, -0.35],
            [w * 0.45, -0.3],
            [w * 0.6, 0.5],
            [w * 0.85, 0.65],
            [w, 0.35],
            [w + 0.2, -0.35],
            [w + 0.8, 0.12]
          ]);
        // グラブの腕：本塁へ向けて伸ばし、リリースで胸に引きつける。
        gloveArm.rotation.x = keys(t, [
          [0, -0.85],
          [w * 0.45, -1.05],
          [w * 0.62, -1.2],
          [w * 0.85, -1.55],
          [w + 0.05, -0.4],
          [w + 0.25, -0.9],
          [w + 1.0, -0.15]
        ]);
        gloveArm.rotation.z = -hand * keys(t, [
          [0, -0.35],
          [w * 0.45, -0.3],
          [w * 0.85, 0.1],
          [w + 0.05, 0.4],
          [w + 1.0, 0.12]
        ]);
        // 体：脚を上げるあいだは横向き（グラブ側を本塁へ）、リリースで正面を越えるまで開く。
        this.body.rotation.y =
          hand *
          keys(t, [
            [0, 0.15],
            [w * 0.45, 1.15],
            [w * 0.85, 0.8],
            [w, -0.2],
            [w + 0.3, -0.35],
            [w + 1.0, 0]
          ]);
        this.upper.rotation.y =
          hand *
          keys(t, [
            [0, 0],
            [w * 0.6, 0.35],
            [w * 0.85, 0.3],
            [w + 0.05, -0.45],
            [w + 1.0, 0]
          ]);
        this.body.rotation.x = keys(t, [
          [0, 0],
          [w * 0.45, -0.12],
          [w * 0.85, 0.05],
          [w + 0.05, 0.5],
          [w + 0.3, 0.6],
          [w + 1.0, 0.1]
        ]);
        // 踏み出しで前へ出て、沈み込む。
        this.body.position.z = keys(t, [
          [0, 0],
          [w * 0.45, -0.05],
          [w * 0.85, 0.45],
          [w + 0.3, 0.6],
          [w + 1.0, 0.35]
        ]);
        this.body.position.y = keys(t, [
          [0, 0],
          [w * 0.45, 0.04],
          [w * 0.85, -0.12],
          [w + 0.2, -0.16],
          [w + 1.0, -0.04]
        ]);
        // 頭は本塁を見続ける。
        this.head.rotation.y = -this.body.rotation.y - this.upper.rotation.y;
        break;
      }
      case 'call': {
        // 審判のストライク・アウト：右の拳を握って上へ突き上げ、少し止める。
        this.armR.rotation.x = keys(t, [
          [0, -0.2],
          [0.16, -2.7],
          [0.3, -2.3],
          [0.9, -2.3],
          [1.2, -0.2]
        ]);
        this.armR.rotation.z = keys(t, [
          [0, 0],
          [0.16, 0.5],
          [1.2, 0]
        ]);
        this.body.rotation.x = keys(t, [
          [0, 0.1],
          [0.2, -0.05],
          [1.2, 0]
        ]);
        this.glove.visible = false;
        break;
      }
      case 'strikeout': {
        // 見逃し三振などの大きなコール：一塁側へ踏み出し、体をひねって右腕を横へ突き出す。
        this.legR.rotation.x = keys(t, [
          [0, 0],
          [0.2, -0.5],
          [1.2, 0]
        ]);
        this.upper.rotation.y = keys(t, [
          [0, 0],
          [0.25, -0.9],
          [1.0, -0.7],
          [1.4, 0]
        ]);
        this.armR.rotation.x = keys(t, [
          [0, -0.2],
          [0.15, -1.2],
          [0.3, -1.6],
          [1.1, -1.5],
          [1.4, -0.2]
        ]);
        this.armR.rotation.z = keys(t, [
          [0, 0],
          [0.3, 1.2],
          [1.1, 1.1],
          [1.4, 0]
        ]);
        this.armL.rotation.x = -0.6;
        this.body.position.y = keys(t, [
          [0, 0],
          [0.25, -0.12],
          [1.2, 0]
        ]);
        this.glove.visible = false;
        break;
      }
      case 'safe': {
        // セーフ：胸の前で交差させた両腕を、真横へ大きく広げる。
        const k = keys(t, [
          [0, 0],
          [0.12, 0],
          [0.3, 1],
          [0.9, 1],
          [1.2, 0.2]
        ]);
        this.armL.rotation.x = -1.5 * (1 - k * 0.1);
        this.armR.rotation.x = -1.5 * (1 - k * 0.1);
        this.armL.rotation.y = 0;
        this.armL.rotation.z = 0.9 - k * 2.4;
        this.armR.rotation.z = -0.9 + k * 2.4;
        this.body.rotation.x = 0.25;
        this.body.position.y = -0.08;
        this.glove.visible = false;
        break;
      }
      case 'bat':
      case 'swing':
      case 'warmup':
      case 'bunt': {
        this.batYaw.visible = true;
        this.glove.visible = false;
        this.legL.rotation.z = -0.15;
        this.legR.rotation.z = 0.15;
        this.armL.rotation.x = -1.1;
        this.armR.rotation.x = -1.1;
        this.armL.rotation.z = 0.4;
        this.armR.rotation.z = -0.4;
        if (p.name === 'bunt') {
          this.batYaw.rotation.y = side * 0.15;
          this.batYaw.position.y = 0.3;
          this.armL.rotation.x = -1.4;
          this.armR.rotation.x = -1.4;
          this.body.rotation.x = 0.2;
          break;
        }
        this.batYaw.position.y = 0.4;
        // 構え：バットを肩の後ろで立てる。スイング：後ろから前へ水平に振り抜く。素振り：構えてはゆっくり振る、をくり返す。
        const s = p.name === 'swing' ? t / SWING_DURATION : p.name === 'warmup' ? practiceSwing(t) : 0;
        const yaw = keys(s, [
          [0, 1.75],
          [1, 0],
          [1.8, -2.3]
        ]);
        const tilt = keys(s, [
          [0, -1.25],
          [0.7, -0.1],
          [1, 0],
          [1.8, -0.6]
        ]);
        this.batYaw.rotation.y = side * yaw;
        this.batTilt.rotation.x = tilt;
        this.upper.rotation.y = side * yaw * 0.45;
        this.head.rotation.y = -side * yaw * 0.45 + side * 1.2 * (1 - smooth(s));
        this.armL.rotation.y = side * yaw * 0.3;
        this.armR.rotation.y = side * yaw * 0.3;
        break;
      }
      case 'crouch': {
        this.body.position.y = -0.3;
        this.legL.rotation.x = -1.3;
        this.legR.rotation.x = -1.3;
        this.legL.rotation.z = -0.35;
        this.legR.rotation.z = 0.35;
        this.body.rotation.x = 0.15;
        this.armL.rotation.x = -1.2;
        this.armR.rotation.x = -0.3;
        break;
      }
    }
  }
}
