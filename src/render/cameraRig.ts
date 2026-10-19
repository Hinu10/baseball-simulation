// 2.5D のカメラ。3台の仮想カメラ（A：投打、B：打球追従、C：守備・走塁の俯瞰）が毎フレーム
// 「いたい位置と見る点」を計算し、実カメラはそこへなめらかに寄っていく（Cinemachine のブレンドに相当）。
// 計算は core の座標系で行い、表示用に x を反転する（render/view.ts の root と同じ）。
import * as THREE from 'three';
import { BASES } from '../core/field.ts';
import type { Vec3 } from '../core/math.ts';

export type CameraMode = 'A' | 'B' | 'C';

export interface CameraFocus {
  ball: Vec3;
  /** 打球の高さに応じて視野を変えるため。 */
  ballAirborne: boolean;
  /** 人が操作している選手（俯瞰で画面に入れる）。 */
  player?: Vec3 | null;
}

const toView = (x: number, y: number, z: number) => new THREE.Vector3(-x, y, z);
const DIAMOND_CENTER = { x: 0, y: 0, z: BASES[2].z / 2 };

export class CameraRig {
  mode: CameraMode = 'A';
  private readonly pos = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private initialized = false;

  readonly camera: THREE.PerspectiveCamera;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
  }

  setMode(m: CameraMode) {
    this.mode = m;
  }

  /** 仮想カメラ A：打者の後ろ斜め上。投手とストライクゾーンが入る。 */
  private shotA(): [THREE.Vector3, THREE.Vector3] {
    return [toView(0, 6.2, -11.5), toView(0, 0.4, 11)];
  }

  /** 仮想カメラ B：打球の方向へ寄り、ボールを追う。フライは高く引き、ゴロは低く。 */
  private shotB(f: CameraFocus): [THREE.Vector3, THREE.Vector3] {
    const b = f.ball;
    const dist = Math.hypot(b.x, b.z);
    const dir = dist > 1 ? { x: b.x / dist, z: b.z / dist } : { x: 0, z: 1 };
    const back = f.ballAirborne ? 16 + dist * 0.25 : 12 + dist * 0.2;
    const height = f.ballAirborne ? 7 + b.y * 0.6 + dist * 0.08 : 6 + dist * 0.12;
    const px = b.x - dir.x * back;
    const pz = Math.max(-12, b.z - dir.z * back);
    return [toView(px, height, pz), toView(b.x, Math.max(0.5, b.y * 0.8), b.z)];
  }

  /** 仮想カメラ C：本塁側の斜め上から俯瞰。ボールと操作選手とダイヤモンドが入るよう高さを変える。 */
  private shotC(f: CameraFocus): [THREE.Vector3, THREE.Vector3] {
    const pts = [f.ball, DIAMOND_CENTER, ...(f.player ? [f.player] : [])];
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cz = pts.reduce((s, p) => s + p.z, 0) / pts.length;
    const spread = Math.max(...pts.map((p) => Math.hypot(p.x - cx, p.z - cz)));
    const h = THREE.MathUtils.clamp(14 + spread * 0.55, 18, 46);
    return [toView(cx, h, cz - h * 0.95), toView(cx, 0, cz + 3)];
  }

  update(dt: number, f: CameraFocus) {
    const [p, l] = this.mode === 'A' ? this.shotA() : this.mode === 'B' ? this.shotB(f) : this.shotC(f);
    if (!this.initialized) {
      this.pos.copy(p);
      this.look.copy(l);
      this.initialized = true;
    }
    // 切替直後も急に飛ばず、数百ミリ秒かけて寄る。A に戻るときは少し速く。
    const rate = this.mode === 'A' ? 5 : 3.2;
    const k = 1 - Math.exp(-rate * dt);
    this.pos.lerp(p, k);
    this.look.lerp(l, Math.min(1, k * 1.6));
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
  }

  /** すぐにその視点へ（試合開始時など）。 */
  snap(f: CameraFocus) {
    this.initialized = false;
    this.update(0, f);
  }
}
