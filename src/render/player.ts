// 選手の見た目（仮）。#3 でデフォルメ選手に置き換える。
import * as THREE from 'three';
import { mat, mesh } from './materials.ts';

export type PoseName = 'idle' | 'run' | 'catch' | 'throw' | 'dive' | 'pitch' | 'bat' | 'swing' | 'bunt' | 'crouch';

export interface Pose {
  name: PoseName;
  /** その動作を始めてからの秒。 */
  t: number;
}

export interface TeamLook {
  primary: string;
  secondary: string;
  uniform: string;
  cap: string;
}

export class PlayerFigure {
  readonly root = new THREE.Group();

  constructor(look: TeamLook) {
    this.root.add(mesh(new THREE.CapsuleGeometry(0.3, 0.9, 4, 12), mat(look.uniform), 0, 0.75, 0));
    this.root.add(mesh(new THREE.SphereGeometry(0.28, 16, 12), mat('#f1c27d'), 0, 1.45, 0));
    this.root.add(mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.12, 16), mat(look.cap), 0, 1.65, 0));
  }

  pose(_p: Pose) {}
}
