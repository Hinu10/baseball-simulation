// 色ごとのマテリアルを使い回す。
import * as THREE from 'three';

const cache = new Map<string, THREE.MeshLambertMaterial>();

export function mat(color: string | number, opts: { transparent?: boolean; opacity?: number; emissive?: string | number } = {}): THREE.MeshLambertMaterial {
  const key = `${color}|${opts.opacity ?? 1}|${opts.emissive ?? ''}`;
  let m = cache.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color, transparent: opts.transparent ?? (opts.opacity ?? 1) < 1, opacity: opts.opacity ?? 1 });
    if (opts.emissive !== undefined) m.emissive = new THREE.Color(opts.emissive);
    cache.set(key, m);
  }
  return m;
}

export function basic(color: string | number, opacity = 1): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });
}

export function mesh(geo: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  return m;
}
