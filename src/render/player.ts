// 3頭身のデフォルメ選手。基本図形を組み合わせ、帽子・頭・胴体・腕・脚・グラブ・バットで野球選手に見せる。
// 動作は「状態の名前」と「その状態になってからの秒」から毎フレーム姿勢を計算する（キーフレームのアセットは使わない）。
import * as THREE from 'three';
import { SWING_DURATION } from '../core/batting.ts';
import { WINDUP_TIME } from '../core/pitching.ts';
import { textColor } from '../core/teams.ts';
import { mat, mesh } from './materials.ts';

export type PoseName = 'idle' | 'run' | 'catch' | 'throw' | 'dive' | 'pitch' | 'bat' | 'swing' | 'bunt' | 'crouch';

export interface Pose {
  name: PoseName;
  /** その動作を始めてからの秒。 */
  t: number;
  /** 打席の左右（左打者は動きを左右反転）。 */
  bats?: 'R' | 'L';
  /** 投げる手（左投手は投球動作を左右反転）。 */
  throws?: 'R' | 'L';
}

export interface TeamLook {
  primary: string;
  secondary: string;
  uniform: string;
  cap: string;
}

const SKIN = '#f1c27d';
const GLOVE = '#8d5524';
const WOOD = '#d9a35f';
const SHOE = '#222222';

/** 胸マーク（球団の頭文字）のテクスチャ。球団・色ごとに使い回す。 */
const marks = new Map<string, THREE.MeshBasicMaterial>();
function markMaterial(letter: string, color: string): THREE.MeshBasicMaterial {
  const key = `${letter}|${color}`;
  let m = marks.get(key);
  if (!m) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    g.font = 'italic 900 54px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = color;
    g.fillText(letter, 32, 35);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    m = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false });
    marks.set(key, m);
  }
  return m;
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

  /** mark は胸の文字（球団の頭文字）。 */
  constructor(look: TeamLook, mark = '') {
    const uniform = mat(look.uniform);
    const team = mat(look.primary);
    const accent = mat(look.secondary);
    this.root.add(this.body);

    // 脚：腰から下がる。下半分はチームカラーのソックス、先に靴。
    for (const [leg, x] of [
      [this.legL, -0.12],
      [this.legR, 0.12]
    ] as const) {
      leg.position.set(x, 0.6, 0);
      leg.add(mesh(new THREE.CapsuleGeometry(0.1, 0.22, 4, 10), uniform, 0, -0.17, 0));
      leg.add(mesh(new THREE.CapsuleGeometry(0.085, 0.14, 4, 10), team, 0, -0.42, 0));
      leg.add(mesh(new THREE.BoxGeometry(0.16, 0.09, 0.26), mat(SHOE), 0, -0.56, 0.05));
      this.body.add(leg);
    }

    // 上半身：胴体・ベルト・胸のライン・頭・帽子・腕。
    this.upper.position.y = 0.6;
    this.body.add(this.upper);
    const torso = mesh(new THREE.CapsuleGeometry(0.23, 0.2, 6, 14), uniform, 0, 0.3, 0);
    torso.scale.set(1.1, 1, 0.82);
    this.upper.add(torso);
    this.upper.add(mesh(new THREE.CylinderGeometry(0.235, 0.235, 0.06, 16), accent, 0, 0.1, 0));
    if (mark) {
      const chest = mesh(new THREE.PlaneGeometry(0.26, 0.26), markMaterial(mark, textColor(look)), 0, 0.36, 0.196);
      // 球場は x を反転して表示するので、文字が裏返らないよう戻す。
      chest.scale.x = -1;
      this.upper.add(chest);
    }

    this.head.position.y = 0.82;
    this.upper.add(this.head);
    this.head.add(mesh(new THREE.SphereGeometry(0.27, 20, 16), mat(SKIN)));
    for (const x of [-0.09, 0.09]) this.head.add(mesh(new THREE.SphereGeometry(0.035, 8, 6), mat('#222222'), x, 0.02, 0.245));
    const cap = mesh(new THREE.SphereGeometry(0.285, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat(look.cap), 0, 0.05, 0);
    this.head.add(cap);
    const brim = mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.03, 16, 1, false, -Math.PI / 2, Math.PI), mat(look.cap), 0, 0.06, 0.2);
    this.head.add(brim);
    this.head.add(mesh(new THREE.BoxGeometry(0.08, 0.08, 0.02), accent, 0, 0.18, 0.26));

    for (const [arm, x] of [
      [this.armL, -0.3],
      [this.armR, 0.3]
    ] as const) {
      arm.position.set(x, 0.5, 0);
      arm.add(mesh(new THREE.CapsuleGeometry(0.075, 0.1, 4, 8), team, 0, -0.07, 0));
      arm.add(mesh(new THREE.CapsuleGeometry(0.06, 0.2, 4, 8), mat(SKIN), 0, -0.24, 0));
      this.upper.add(arm);
    }
    this.glove = mesh(new THREE.SphereGeometry(0.11, 12, 10), mat(GLOVE), 0, -0.4, 0.02);
    this.armL.add(this.glove);

    // バット：胸の前を軸に回す（batYaw が水平の振り、batTilt が立て具合）。
    this.batYaw.position.set(0, 0.35, 0.05);
    this.upper.add(this.batYaw);
    this.batYaw.add(this.batTilt);
    const bat = mesh(new THREE.CylinderGeometry(0.035, 0.02, 0.86, 10), mat(WOOD), 0, 0, 0.5);
    bat.rotation.x = Math.PI / 2;
    this.batTilt.add(bat);
    this.batYaw.visible = false;
  }

  private reset() {
    this.body.position.set(0, 0, 0);
    this.upper.position.y = 0.6;
    this.batYaw.position.y = 0.35;
    this.body.rotation.set(0, 0, 0);
    this.upper.rotation.set(0, 0, 0);
    this.head.rotation.set(0, 0, 0);
    for (const g of [this.legL, this.legR, this.armL, this.armR]) g.rotation.set(0, 0, 0);
    this.armL.rotation.z = -0.12;
    this.armR.rotation.z = 0.12;
    this.batYaw.visible = false;
    this.glove.visible = true;
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
        this.upper.position.y = 0.6 + b;
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
      case 'bat':
      case 'swing':
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
        // 構え：バットを肩の後ろで立てる。スイング：後ろから前へ水平に振り抜く。
        const s = p.name === 'swing' ? t / SWING_DURATION : 0;
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
