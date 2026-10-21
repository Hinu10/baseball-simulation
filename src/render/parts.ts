// 球場と景色で使う、形をまとめる道具。
import * as THREE from 'three';

/** 平らな四角形・縦の四角形を三角形で積む。色を渡すと頂点色も積む。 */
export class Quads {
  readonly pos: number[] = [];
  readonly colors: number[] = [];
  quad(a: THREE.Vector3Like, b: THREE.Vector3Like, c: THREE.Vector3Like, d: THREE.Vector3Like, color?: THREE.Color) {
    for (const p of [a, b, c, a, c, d]) {
      this.pos.push(p.x, p.y, p.z);
      if (color) this.colors.push(color.r, color.g, color.b);
    }
  }
  /** 折れ線 inner・outer の間（高さはそれぞれ yi・yo）を帯にする。 */
  ribbon(inner: { x: number; z: number }[], outer: { x: number; z: number }[], yi: (i: number) => number, yo: (i: number) => number, closed = true) {
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
    if (this.colors.length) g.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    g.computeVertexNormals();
    return g;
  }
}

/** 木・照明塔などの小物を、頂点色つきの1つの形にまとめて描く（描画の回数を減らす）。 */
export class Props {
  private readonly parts: THREE.BufferGeometry[] = [];
  /** uv を渡すと、テクスチャの繰り返し回数（横・縦）をその倍率にする（ビルの窓など）。 */
  add(geo: THREE.BufferGeometry, color: string, x: number, y: number, z: number, o: { rx?: number; ry?: number; rz?: number; s?: number | [number, number, number]; uv?: [number, number] } = {}) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    const uv = g.getAttribute('uv') as THREE.BufferAttribute | undefined;
    if (uv && o.uv) {
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * o.uv[0], uv.getY(i) * o.uv[1]);
    }
    const s = o.s ?? 1;
    const scale = typeof s === 'number' ? new THREE.Vector3(s, s, s) : new THREE.Vector3(...s);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0, 'YXZ'));
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, scale));
    const c = new THREE.Color(color);
    const n = g.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    this.parts.push(g);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  mesh(material: THREE.Material = new THREE.MeshLambertMaterial({ vertexColors: true })): THREE.Mesh {
    const pos: number[] = [];
    const nor: number[] = [];
    const col: number[] = [];
    const uvs: number[] = [];
    const withUv = this.parts.every((g) => g.getAttribute('uv'));
    for (const g of this.parts) {
      if (withUv) uvs.push(...(g.getAttribute('uv').array as Float32Array));
      pos.push(...(g.getAttribute('position').array as Float32Array));
      nor.push(...(g.getAttribute('normal').array as Float32Array));
      col.push(...(g.getAttribute('color').array as Float32Array));
      g.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    if (withUv) out.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    return new THREE.Mesh(out, material);
  }
}

export function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** 木を1本植える。round は広葉樹、cone は針葉樹。 */
export function tree(props: Props, x: number, z: number, h: number, kind: 'round' | 'cone', leaf: string) {
  props.add(new THREE.CylinderGeometry(0.25 * h * 0.08 + 0.15, 0.35 * h * 0.08 + 0.2, h * 0.45, 6), '#6d4c35', x, h * 0.225, z);
  if (kind === 'round') props.add(new THREE.IcosahedronGeometry(h * 0.3, 0), leaf, x, h * 0.65, z, { ry: x * 0.7, s: [1, 0.85, 1] });
  else props.add(new THREE.ConeGeometry(h * 0.24, h * 0.75, 7), leaf, x, h * 0.6, z, { ry: z });
}

export const LEAVES = ['#3f7d3a', '#4a8f3f', '#356b32', '#5b9a46', '#2f6a3a'];
