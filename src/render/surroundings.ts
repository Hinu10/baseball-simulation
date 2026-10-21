// 屋外の球場の、観客席の外に広がる景色。遠くの山並みや街並みは円筒に描いた絵（パノラマ）、近くのものは形で置く。
// 角度 a は上から見て中堅方向が 0、一塁側が +（core の座標）。乱数は球場ごとに固定して、毎回同じ景色にする。
import * as THREE from 'three';
import type { Park } from '../core/field.ts';
import { Rng } from '../core/rng.ts';
import { mat, mesh } from './materials.ts';
import { canvasTexture, LEAVES, Props, Quads, tree } from './parts.ts';

/** 景色を置くときに使う、球場の情報（stadium.ts の Shell の一部）。 */
export interface Site {
  group: THREE.Group;
  park: Park;
  look: { sky: string };
  /** 観客席までを囲む円（上から見て）。景色はこの外に置く。 */
  center: { x: number; z: number };
  radius: number;
}

export type Animate = (dt: number, time: number) => void;

/** 球場の外の地面の半径と、遠景（パノラマ）の半径。地面はパノラマの内側で終わらせる（霧で空の色に溶ける）。 */
export const GROUND_RADIUS = 460;
const PANORAMA_RADIUS = 470;
const PANORAMA_HEIGHT = 150;
/** 地面とパノラマの中心（本塁から中堅寄り）。 */
export const SCENERY_Z = 40;

const seedOf = (id: string) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

const polar = (s: Site, a: number, r: number) => ({ x: s.center.x + Math.sin(a) * r, z: s.center.z + Math.cos(a) * r });
/** 中心のほうを向く向き（ry）。 */
const facing = (s: Site, p: { x: number; z: number }) => Math.atan2(s.center.x - p.x, s.center.z - p.z);
/** 遠くのものほど空の色にかすませる。 */
const haze = (color: string, sky: string, t: number) => '#' + new THREE.Color(color).lerp(new THREE.Color(sky), t).getHexString();

/** 景色づくりの関数をまとめて1つにする（動きもまとめる）。 */
export function combine<S extends Site>(...parts: ((s: S) => Animate | void)[]) {
  return (s: S): Animate | void => {
    const anims = parts.map((f) => f(s)).filter((f): f is Animate => !!f);
    if (anims.length) return (dt, time) => anims.forEach((f) => f(dt, time));
  };
}

/**
 * 遠景。幅 4096・高さ 512 のキャンバスに描き、球場を囲む円筒の内側に貼る。下端が地面、上端が高さ PANORAMA_HEIGHT。
 * 霧の影響を受けない素材なので、色は draw の中で空の色にかすませておく。
 */
function panorama(s: Site, draw: (g: CanvasRenderingContext2D, W: number, H: number, rng: Rng) => void) {
  const W = 4096;
  const H = 512;
  const rng = new Rng(seedOf(s.park.id) + 1);
  const tex = canvasTexture(W, H, (g) => {
    draw(g, W, H, rng);
    // 下のほうは霧で空の色にかすむ（高い所から見ても、遠景が浮いて見えないように）。
    const fade = g.createLinearGradient(0, H - 150, 0, H);
    const sky = '#' + new THREE.Color(s.look.sky).getHexString();
    fade.addColorStop(0, `${sky}00`);
    fade.addColorStop(1, `${sky}ff`);
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = fade;
    g.fillRect(0, H - 150, W, 150);
    g.globalCompositeOperation = 'source-over';
  });
  tex.wrapS = THREE.RepeatWrapping;
  const m = mesh(
    new THREE.CylinderGeometry(PANORAMA_RADIUS, PANORAMA_RADIUS, PANORAMA_HEIGHT, 128, 1, true),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.BackSide, fog: false, depthWrite: false }),
    0,
    PANORAMA_HEIGHT / 2 - 3,
    SCENERY_Z
  );
  m.renderOrder = -1;
  s.group.add(m);
}

/** 横に続く山並み（尾根）を1本描く。base は下端からの高さ（px）、amp はでこぼこの大きさ。 */
function ridge(g: CanvasRenderingContext2D, W: number, H: number, rng: Rng, o: { base: number; amp: number; color: string; peaks: number; sharp?: boolean; snow?: string }) {
  const n = o.peaks;
  const pts: { x: number; y: number }[] = [];
  const phase = Array.from({ length: 3 }, () => rng.next() * Math.PI * 2);
  for (let i = 0; i <= 256; i++) {
    const x = (i / 256) * W;
    const t = (i / 256) * Math.PI * 2;
    let h = 0.55 * Math.sin(t * n + phase[0]) + 0.3 * Math.sin(t * n * 2.3 + phase[1]) + 0.15 * Math.sin(t * n * 5.1 + phase[2]);
    if (o.sharp) h = Math.max(-0.2, 1 - Math.abs(h) * 1.6);
    pts.push({ x, y: H - o.base - (h * 0.5 + 0.5) * o.amp });
  }
  g.fillStyle = o.color;
  g.beginPath();
  g.moveTo(0, H);
  for (const p of pts) g.lineTo(p.x, p.y);
  g.lineTo(W, H);
  g.fill();
  if (o.snow) {
    // 尾根の上のほうだけ白くする。
    const top = Math.min(...pts.map((p) => p.y));
    const line = top + o.amp * 0.28;
    g.save();
    g.beginPath();
    g.moveTo(0, H);
    for (const p of pts) g.lineTo(p.x, p.y);
    g.lineTo(W, H);
    g.clip();
    g.fillStyle = o.snow;
    g.beginPath();
    for (let i = 0; i <= 256; i++) g.lineTo((i / 256) * W, line + Math.sin(i * 1.7) * 6);
    g.lineTo(W, 0);
    g.lineTo(0, 0);
    g.fill();
    g.restore();
  }
}

/** パノラマの上のほうに浮かぶ雲。 */
function clouds(g: CanvasRenderingContext2D, W: number, rng: Rng, n: number) {
  g.fillStyle = 'rgba(255,255,255,0.75)';
  for (let i = 0; i < n; i++) {
    const x = rng.next() * W;
    const y = 40 + rng.next() * 150;
    for (let k = 0; k < 6; k++) {
      g.beginPath();
      g.ellipse(x + (k - 2.5) * 22 + rng.range(-8, 8), y + rng.range(-8, 8), rng.range(26, 46), rng.range(12, 22), 0, 0, Math.PI * 2);
      g.fill();
    }
  }
}

/** 低い丘（つぶした多面体）。 */
function hill(p: Props, x: number, z: number, w: number, h: number, color: string) {
  p.add(new THREE.IcosahedronGeometry(1, 1), color, x, -h * 0.25, z, { s: [w, h, w * 0.8], ry: x });
}

// ---- スカイパーク：高原の草原 -------------------------------------------------------------

export function highland(s: Site): Animate {
  const rng = new Rng(seedOf(s.park.id));
  const sky = s.look.sky;
  panorama(s, (g, W, H, r) => {
    clouds(g, W, r, 14);
    ridge(g, W, H, r, { base: 40, amp: 190, color: haze('#6f8fb3', sky, 0.45), peaks: 5, sharp: true, snow: haze('#ffffff', sky, 0.2) });
    ridge(g, W, H, r, { base: 20, amp: 90, color: haze('#5f9a6a', sky, 0.4), peaks: 9 });
    ridge(g, W, H, r, { base: 0, amp: 45, color: haze('#6faa5c', sky, 0.25), peaks: 14 });
  });
  const props = new Props();
  const greens = ['#7fb35c', '#8cbf63', '#74a954', '#93c56b'];
  for (let i = 0; i < 18; i++) {
    const p = polar(s, rng.range(0, Math.PI * 2), s.radius + rng.range(90, 260));
    hill(props, p.x, p.z, rng.range(40, 75), rng.range(12, 30), greens[i % greens.length]);
  }
  // 木立ち。
  for (let i = 0; i < 70; i++) {
    const p = polar(s, rng.range(0, Math.PI * 2), s.radius + rng.range(12, 140));
    tree(props, p.x, p.z, rng.range(8, 15), rng.chance(0.35) ? 'cone' : 'round', LEAVES[i % LEAVES.length]);
  }
  // 羊の群れ。
  for (let f = 0; f < 5; f++) {
    const a = rng.range(0, Math.PI * 2);
    const r0 = s.radius + rng.range(20, 70);
    for (let k = 0; k < 7; k++) {
      const p = polar(s, a + rng.range(-0.06, 0.06), r0 + rng.range(-8, 8));
      props.add(new THREE.IcosahedronGeometry(1, 1), '#f4f2ea', p.x, 1.1, p.z, { s: [1.3, 0.9, 0.9] });
      props.add(new THREE.BoxGeometry(0.6, 0.6, 0.7), '#2b2b2b', p.x + 1.2, 1.4, p.z);
    }
  }
  s.group.add(props.mesh());

  // 風車。羽根はゆっくり回る。
  const blades: THREE.Object3D[] = [];
  for (let i = 0; i < 5; i++) {
    const p = polar(s, -2.2 + i * 1.05 + rng.range(-0.15, 0.15), s.radius + rng.range(50, 110));
    const h = rng.range(26, 34);
    const tower = new Props();
    tower.add(new THREE.CylinderGeometry(0.7, 1.4, h, 10), '#f5f5f2', p.x, h / 2, p.z);
    tower.add(new THREE.BoxGeometry(2, 2, 3.4), '#e8e8e4', p.x, h + 0.6, p.z, { ry: facing(s, p) });
    s.group.add(tower.mesh());
    const hub = new THREE.Group();
    hub.position.set(p.x, h + 0.6, p.z);
    hub.rotation.y = facing(s, p);
    const rotor = new THREE.Group();
    rotor.position.z = 2;
    const fan = new Props();
    for (let b = 0; b < 3; b++) fan.add(new THREE.BoxGeometry(0.7, 15, 0.2), '#ffffff', Math.sin((b / 3) * Math.PI * 2) * 7.5, Math.cos((b / 3) * Math.PI * 2) * 7.5, 0, { rz: -(b / 3) * Math.PI * 2 });
    rotor.add(fan.mesh());
    rotor.rotation.z = rng.next() * 3;
    hub.add(rotor);
    s.group.add(hub);
    blades.push(rotor);
  }
  return (dt) => blades.forEach((b, i) => (b.rotation.z += dt * (0.8 + i * 0.07)));
}

// ---- マイカイ：山あいの森 -----------------------------------------------------------------

export function mountainForest(s: Site) {
  const rng = new Rng(seedOf(s.park.id));
  const sky = s.look.sky;
  panorama(s, (g, W, H, r) => {
    clouds(g, W, r, 8);
    ridge(g, W, H, r, { base: 50, amp: 200, color: haze('#3f6f55', sky, 0.55), peaks: 4 });
    ridge(g, W, H, r, { base: 25, amp: 150, color: haze('#356b42', sky, 0.38), peaks: 7 });
    ridge(g, W, H, r, { base: 0, amp: 90, color: haze('#2f6236', sky, 0.2), peaks: 11 });
    // 谷にかかる霧。
    const mist = g.createLinearGradient(0, H - 90, 0, H);
    mist.addColorStop(0, 'rgba(255,255,255,0)');
    mist.addColorStop(1, 'rgba(255,255,255,0.45)');
    g.fillStyle = mist;
    g.fillRect(0, H - 90, W, 90);
  });
  // 外側に針葉樹の森を重ねる（内側の木立ちは greenery が植える）。
  const props = new Props();
  const dark = ['#2f5f34', '#2a5530', '#376b3a', '#24502c'];
  for (let i = 0; i < 260; i++) {
    const p = polar(s, rng.range(0, Math.PI * 2), s.radius + rng.range(28, 170));
    tree(props, p.x, p.z, rng.range(14, 26), 'cone', dark[i % dark.length]);
  }
  for (let i = 0; i < 10; i++) {
    const p = polar(s, rng.range(0, Math.PI * 2), s.radius + rng.range(150, 260));
    hill(props, p.x, p.z, rng.range(50, 90), rng.range(30, 60), dark[i % dark.length]);
  }
  s.group.add(props.mesh());
}

// ---- ファクロム：都会のど真ん中 ------------------------------------------------------------

/** ビルの壁の窓（白っぽい枠に、少し暗いガラス）。頂点色で色をつける。 */
function windowTexture() {
  const t = canvasTexture(64, 64, (g) => {
    g.fillStyle = '#f2f2f2';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#9fb3c4';
    for (let y = 6; y < 64; y += 16) for (let x = 5; x < 64; x += 16) g.fillRect(x, y, 10, 9);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** 看板の絵。 */
function billboard(text: string, bg: string, fg: string) {
  return canvasTexture(512, 256, (g) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, 512, 256);
    g.fillStyle = fg;
    g.fillRect(14, 14, 484, 6);
    g.fillRect(14, 236, 484, 6);
    g.font = 'bold 96px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 256, 132);
  });
}

export function city(s: Site): Animate {
  const rng = new Rng(seedOf(s.park.id));
  const sky = s.look.sky;
  panorama(s, (g, W, H, r) => {
    // 遠くのビル群（2層）と電波塔。
    for (const [layer, color, max] of [
      [0, haze('#5c6b80', sky, 0.55), 300],
      [1, haze('#4a5668', sky, 0.35), 200]
    ] as const) {
      let x = 0;
      while (x < W) {
        const w = r.range(30, 90);
        const h = r.range(40, max) * (layer ? 0.8 : 1);
        g.fillStyle = color;
        g.fillRect(x, H - h, w, h);
        if (r.chance(0.2)) g.fillRect(x + w / 2 - 2, H - h - 30, 4, 30);
        x += w + r.range(0, 12);
      }
    }
    const tx = W * 0.37;
    g.fillStyle = haze('#c0503c', sky, 0.45);
    g.beginPath();
    g.moveTo(tx - 40, H);
    g.lineTo(tx - 5, H - 420);
    g.lineTo(tx + 5, H - 420);
    g.lineTo(tx + 40, H);
    g.fill();
    g.fillRect(tx - 22, H - 300, 44, 18);
    g.fillRect(tx - 2, H - 500, 4, 80);
  });

  // 球場を囲む道路。
  const road = mesh(new THREE.RingGeometry(s.radius + 2, s.radius + 18, 96), mat('#3d4046'), s.center.x, 0.01, s.center.z);
  road.rotation.x = -Math.PI / 2;
  s.group.add(road);

  // ビル。外ほど高い。大通りの方向は空ける。
  const buildings = new Props();
  const roofs = new Props();
  const palette = ['#c9ced6', '#aab4c0', '#d8d2c6', '#8fa3b8', '#b7c4cf', '#9aa0a8', '#c2b8a8', '#7f92a8'];
  const tops: THREE.Vector3[] = [];
  const near: { x: number; z: number; w: number; h: number }[] = [];
  for (let ring = 0; ring < 4; ring++) {
    const r = s.radius + 34 + ring * 40;
    const n = Math.floor((2 * Math.PI * r) / 30);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + ring * 0.13;
      if (Math.abs(Math.sin(2 * (a - Math.PI / 4))) < 0.06) continue;
      const p = polar(s, a, r + rng.range(-6, 6));
      const w = rng.range(13, 24);
      const d = rng.range(13, 24);
      const h = (22 + ring * 26) * rng.range(0.55, 1.45);
      buildings.add(new THREE.BoxGeometry(w, h, d), rng.pick(palette), p.x, h / 2, p.z, { ry: facing(s, p), uv: [w / 4, h / 4] });
      roofs.add(new THREE.BoxGeometry(w * 0.4, 2.2, d * 0.4), '#7c8188', p.x, h + 1.1, p.z, { ry: facing(s, p) });
      if (h > 70) tops.push(new THREE.Vector3(p.x, h + 4, p.z));
      if (ring === 0) near.push({ ...p, w, h });
    }
  }
  s.group.add(buildings.mesh(new THREE.MeshLambertMaterial({ map: windowTexture(), vertexColors: true })));
  s.group.add(roofs.mesh());

  // 手前のビルの壁に、球場のほうを向いた看板。
  const ads = [
    ['FACROM', '#0a1a4a', '#ffffff'],
    ['ラーメン', '#d8322a', '#fff3c4'],
    ['COFFEE', '#2e1f17', '#f2c38b'],
    ['ビール', '#f2b705', '#2b2b2b'],
    ['BANK', '#1f6b4f', '#ffffff'],
    ['ゲーム', '#6a3fb5', '#ffffff']
  ];
  near
    .filter((b) => b.h > 26)
    .filter((_, i) => i % 4 === 1)
    .slice(0, ads.length)
    .forEach((b, i) => {
      const [text, bg, fg] = ads[i];
      const toward = facing(s, b);
      // 画面は左右反転して表示するので、看板の絵もあらかじめ反転しておく。
      const tex = billboard(text, bg, fg);
      tex.wrapS = THREE.RepeatWrapping;
      tex.repeat.x = -1;
      const sign = mesh(new THREE.PlaneGeometry(16, 8), new THREE.MeshBasicMaterial({ map: tex }), b.x + Math.sin(toward) * (b.w / 2 + 0.4), b.h * 0.7, b.z + Math.cos(toward) * (b.w / 2 + 0.4));
      sign.rotation.y = toward;
      s.group.add(sign);
    });

  // 高いビルの上の赤い航空障害灯。
  const lights = new Props();
  for (const t of tops) {
    lights.add(new THREE.CylinderGeometry(0.15, 0.15, 6, 4), '#d0d0d0', t.x, t.y - 1, t.z);
    lights.add(new THREE.SphereGeometry(0.9, 8, 6), '#ff3b30', t.x, t.y + 2.4, t.z);
  }
  const lightMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true });
  s.group.add(lights.mesh(lightMat));

  // 観客席の外をまわる高架と電車。
  const rail = s.radius + 24;
  const deckY = 21;
  const deck = new Quads();
  const inner: { x: number; z: number }[] = [];
  const outer: { x: number; z: number }[] = [];
  for (let i = 0; i <= 128; i++) {
    inner.push(polar(s, (i / 128) * Math.PI * 2, rail - 2.6));
    outer.push(polar(s, (i / 128) * Math.PI * 2, rail + 2.6));
  }
  deck.ribbon(inner, outer, () => deckY, () => deckY, false);
  s.group.add(new THREE.Mesh(deck.geometry(), new THREE.MeshLambertMaterial({ color: '#8a9099', side: THREE.DoubleSide })));
  const piers = new Props();
  for (let i = 0; i < 48; i++) {
    const p = polar(s, (i / 48) * Math.PI * 2, rail);
    piers.add(new THREE.BoxGeometry(1.6, deckY, 1.6), '#9aa0a8', p.x, deckY / 2, p.z);
  }
  s.group.add(piers.mesh());
  const train = new THREE.Group();
  const cars = 6;
  const carLen = 13;
  const gap = (carLen + 1) / rail;
  const carMeshes: THREE.Mesh[] = [];
  for (let c = 0; c < cars; c++) {
    const car = new Props();
    car.add(new THREE.BoxGeometry(3, 3.4, carLen), '#e8ecef', 0, 1.7, 0);
    car.add(new THREE.BoxGeometry(3.05, 0.6, carLen), '#18a058', 0, 1.2, 0);
    car.add(new THREE.BoxGeometry(3.05, 1, carLen * 0.9), '#2c3e50', 0, 2.5, 0);
    const m = car.mesh();
    carMeshes.push(m);
    train.add(m);
  }
  s.group.add(train);
  let pos = 0;
  return (dt, time) => {
    lightMat.opacity = Math.sin(time * 3) > 0 ? 1 : 0.15;
    pos += dt * (14 / rail);
    carMeshes.forEach((m, c) => {
      const a = pos - c * gap;
      const p = polar(s, a, rail);
      m.position.set(p.x, deckY, p.z);
      m.rotation.y = a + Math.PI / 2;
    });
  };
}

// ---- スマーリンズ：海沿い（砂浜・灯台・ヨットは stadium.ts の seaside） ------------------------------

export function islands(s: Site): Animate {
  const sky = s.look.sky;
  panorama(s, (g, W, H, r) => {
    clouds(g, W, r, 10);
    // 水平線の近くに、遠くの島と大きな船。
    for (let i = 0; i < 7; i++) {
      const x = r.next() * W;
      const w = r.range(120, 380);
      const h = r.range(18, 60);
      g.fillStyle = haze(i % 2 ? '#4f7d6a' : '#5d8a72', sky, 0.5);
      g.beginPath();
      g.moveTo(x - w / 2, H - 10);
      g.quadraticCurveTo(x - w / 4, H - 10 - h, x, H - 10 - h);
      g.quadraticCurveTo(x + w / 4, H - 10 - h, x + w / 2, H - 10);
      g.fill();
    }
    const sx = W * 0.62;
    g.fillStyle = haze('#ffffff', sky, 0.25);
    g.fillRect(sx, H - 34, 160, 18);
    g.fillRect(sx + 20, H - 50, 110, 16);
    g.fillRect(sx + 40, H - 62, 60, 12);
    g.fillStyle = haze('#2f5f8f', sky, 0.35);
    g.fillRect(sx, H - 20, 160, 8);
  });
  // カモメが球場の上空を円を描いて飛ぶ。
  const rng = new Rng(seedOf(s.park.id));
  const gulls: { g: THREE.Group; wings: THREE.Mesh[]; r: number; y: number; a: number; v: number }[] = [];
  for (let i = 0; i < 10; i++) {
    const bird = new THREE.Group();
    const wings = [-1, 1].map((side) => {
      const w = mesh(new THREE.BoxGeometry(2.2, 0.08, 0.6), mat('#fafafa'), side * 1.1, 0, 0);
      w.geometry.translate(side * 1.1, 0, 0);
      w.position.x = 0;
      bird.add(w);
      return w;
    });
    bird.add(mesh(new THREE.BoxGeometry(0.4, 0.35, 1.2), mat('#ececec')));
    s.group.add(bird);
    gulls.push({ g: bird, wings, r: s.radius + rng.range(-40, 60), y: rng.range(32, 55), a: rng.range(0, Math.PI * 2), v: rng.range(0.04, 0.08) * (rng.chance(0.5) ? 1 : -1) });
  }
  return (dt, time) => {
    gulls.forEach((b, i) => {
      b.a += b.v * dt;
      const p = polar(s, b.a, b.r);
      b.g.position.set(p.x, b.y + Math.sin(time * 0.7 + i) * 2, p.z);
      b.g.rotation.y = b.a + (b.v > 0 ? Math.PI / 2 : -Math.PI / 2) + Math.PI / 2;
      const flap = Math.sin(time * 6 + i * 1.3) * 0.5;
      b.wings[0].rotation.z = -flap;
      b.wings[1].rotation.z = flap;
    });
  };
}

// ---- メリー：テーマパーク（観覧車は stadium.ts の ferrisWheel） ------------------------------------

/** しま模様のテクスチャ（テント・屋根）。 */
function stripes(a: string, b: string, n = 12) {
  return canvasTexture(256, 32, (g) => {
    for (let i = 0; i < n; i++) {
      g.fillStyle = i % 2 ? a : b;
      g.fillRect((i / n) * 256, 0, 256 / n + 1, 32);
    }
  });
}

export function themePark(s: Site): Animate {
  const rng = new Rng(seedOf(s.park.id));
  const sky = s.look.sky;
  panorama(s, (g, W, H, r) => {
    clouds(g, W, r, 12);
    ridge(g, W, H, r, { base: 0, amp: 70, color: haze('#7fb87a', sky, 0.45), peaks: 6 });
    // 遠くのアトラクションの影。
    for (let i = 0; i < 6; i++) {
      const x = r.next() * W;
      g.fillStyle = haze(['#e76f9a', '#6cc3d5', '#9b7fd1'][i % 3], sky, 0.55);
      if (i % 2) {
        g.beginPath();
        g.moveTo(x - 30, H - 40);
        g.lineTo(x, H - 140);
        g.lineTo(x + 30, H - 40);
        g.fill();
      } else {
        g.fillRect(x - 5, H - 170, 10, 130);
        g.fillRect(x - 18, H - 120, 36, 10);
      }
    }
  });

  const props = new Props();
  // 城：右中間の奥。白い壁に、とんがり屋根の塔。
  const castle = polar(s, 0.55, s.radius + 75);
  const towers: [number, number, number, number][] = [
    [0, 0, 7, 46],
    [-14, -6, 4.5, 32],
    [14, -6, 4.5, 32],
    [-9, 9, 4, 38],
    [9, 9, 4, 38]
  ];
  const yaw = facing(s, castle);
  const local = (dx: number, dz: number) => ({ x: castle.x + Math.cos(yaw) * dx + Math.sin(yaw) * dz, z: castle.z - Math.sin(yaw) * dx + Math.cos(yaw) * dz });
  props.add(new THREE.BoxGeometry(34, 16, 22), '#f6eef4', castle.x, 8, castle.z, { ry: yaw });
  for (const [dx, dz, r, h] of towers) {
    const p = local(dx, dz);
    props.add(new THREE.CylinderGeometry(r, r, h, 14), '#fbf7fa', p.x, h / 2, p.z);
    props.add(new THREE.ConeGeometry(r * 1.25, r * 3, 14), dx === 0 ? '#6c8fe0' : '#e77fb0', p.x, h + r * 1.5, p.z);
  }
  // サーカスのテント。
  const tentTex = stripes('#e84a5f', '#fff6e6', 16);
  for (let i = 0; i < 3; i++) {
    const p = polar(s, -0.95 + i * 0.22, s.radius + 40 + i * 12);
    s.group.add(mesh(new THREE.CylinderGeometry(8, 8, 6, 24), new THREE.MeshLambertMaterial({ map: tentTex }), p.x, 3, p.z));
    s.group.add(mesh(new THREE.ConeGeometry(9.5, 9, 24), new THREE.MeshLambertMaterial({ map: tentTex }), p.x, 10.5, p.z));
  }
  // 屋台と木。
  for (let i = 0; i < 40; i++) {
    const p = polar(s, rng.range(0, Math.PI * 2), s.radius + rng.range(10, 120));
    if (Math.hypot(p.x - castle.x, p.z - castle.z) < 30) continue;
    if (i % 3) tree(props, p.x, p.z, rng.range(7, 11), 'round', LEAVES[i % LEAVES.length]);
    else props.add(new THREE.BoxGeometry(4, 3, 3), rng.pick(['#f2b544', '#6cc3d5', '#e76f9a']), p.x, 1.5, p.z, { ry: facing(s, p) });
  }
  s.group.add(props.mesh());

  // ジェットコースター：一塁側の奥をまわる、起伏のあるコース。
  const course: THREE.Vector3[] = [];
  const N = 20;
  for (let i = 0; i < N; i++) {
    const t = i / N;
    const a = 1.15 + Math.sin(t * Math.PI * 2) * 0.45;
    const r = s.radius + 55 + Math.cos(t * Math.PI * 2) * 28;
    const p = polar(s, a, r);
    const y = i === 2 ? 42 : 10 + 14 * (0.5 + 0.5 * Math.sin(t * Math.PI * 6 + 1)) + (i < 3 ? 14 : 0);
    course.push(new THREE.Vector3(p.x, y, p.z));
  }
  const curve = new THREE.CatmullRomCurve3(course, true);
  s.group.add(mesh(new THREE.TubeGeometry(curve, 300, 0.6, 6, true), mat('#d6457a')));
  const legs = new Props();
  for (let i = 0; i < 60; i++) {
    const p = curve.getPointAt(i / 60);
    legs.add(new THREE.CylinderGeometry(0.25, 0.25, p.y, 5), '#f2f2f2', p.x, p.y / 2, p.z);
  }
  s.group.add(legs.mesh());
  const coaster: THREE.Mesh[] = [];
  for (let c = 0; c < 4; c++) {
    const car = mesh(new THREE.BoxGeometry(2.2, 1.5, 3), mat(['#f2b544', '#6cc3d5', '#9b7fd1', '#e76f9a'][c]));
    coaster.push(car);
    s.group.add(car);
  }

  // メリーゴーラウンド：回りながら馬が上下する。
  const mgr = polar(s, -0.4, s.radius + 30);
  const carousel = new THREE.Group();
  carousel.position.set(mgr.x, 0, mgr.z);
  carousel.add(mesh(new THREE.CylinderGeometry(9, 9, 1, 24), mat('#f3dbe5'), 0, 0.5, 0));
  carousel.add(mesh(new THREE.CylinderGeometry(0.8, 0.8, 8, 10), mat('#f2b544'), 0, 4.5, 0));
  carousel.add(mesh(new THREE.ConeGeometry(10, 4, 24), new THREE.MeshLambertMaterial({ map: stripes('#9b7fd1', '#ffffff', 12) }), 0, 9.5, 0));
  const horses: THREE.Mesh[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const h = mesh(new THREE.BoxGeometry(0.8, 1.4, 2), mat(i % 2 ? '#ffffff' : '#f2b544'), Math.sin(a) * 6.5, 2.5, Math.cos(a) * 6.5);
    h.rotation.y = a + Math.PI / 2;
    horses.push(h);
    carousel.add(h);
  }
  s.group.add(carousel);

  // フリーフォール：ゆっくり上がって、一気に落ちる。
  const ft = polar(s, -1.35, s.radius + 50);
  s.group.add(mesh(new THREE.CylinderGeometry(1.4, 1.8, 62, 10), mat('#6cc3d5'), ft.x, 31, ft.z));
  s.group.add(mesh(new THREE.ConeGeometry(2.4, 5, 10), mat('#e76f9a'), ft.x, 64.5, ft.z));
  const seat = mesh(new THREE.TorusGeometry(2.8, 0.7, 8, 20), mat('#f2b544'), ft.x, 4, ft.z);
  seat.rotation.x = Math.PI / 2;
  s.group.add(seat);

  // 熱気球が空をただよう。
  const balloons: { g: THREE.Group; a: number; r: number; y: number }[] = [];
  ['#e76f9a', '#f2b544', '#6cc3d5'].forEach((c, i) => {
    const b = new THREE.Group();
    b.add(mesh(new THREE.SphereGeometry(6, 16, 12), mat(c), 0, 8, 0));
    b.add(mesh(new THREE.ConeGeometry(4.5, 5, 16), mat(c), 0, 2.6, 0).rotateX(Math.PI));
    b.add(mesh(new THREE.BoxGeometry(2, 1.6, 2), mat('#8b6b47'), 0, -1, 0));
    s.group.add(b);
    balloons.push({ g: b, a: -1 + i * 1.6, r: s.radius + 110 + i * 25, y: 70 + i * 12 });
  });

  return (dt, time) => {
    const u = (time * 0.035) % 1;
    coaster.forEach((car, c) => {
      const t = (u - c * 0.006 + 1) % 1;
      const p = curve.getPointAt(t);
      const ahead = curve.getPointAt((t + 0.002) % 1);
      car.position.set(p.x, p.y + 1, p.z);
      car.lookAt(ahead.x, ahead.y + 1, ahead.z);
    });
    carousel.rotation.y = time * 0.5;
    horses.forEach((h, i) => (h.position.y = 2.5 + Math.sin(time * 2 + i) * 0.6));
    // 8 秒で1回：6 秒かけて上がり、少し止まって、一気に落ちる。
    const c = time % 8;
    seat.position.y = c < 6 ? 4 + (c / 6) * 52 : c < 7 ? 56 : 56 - 52 * Math.min(1, (c - 7) / 0.6) ** 2;
    balloons.forEach((b, i) => {
      const p = polar(s, b.a + time * 0.004 * (i % 2 ? 1 : -1), b.r);
      b.g.position.set(p.x, b.y + Math.sin(time * 0.3 + i) * 3, p.z);
    });
  };
}

// ---- オネタール：城下町 -------------------------------------------------------------------

/** 切妻屋根の家（三角柱の屋根）。 */
function house(p: Props, x: number, z: number, yaw: number, w: number, d: number, h: number, wall: string, roof: string) {
  p.add(new THREE.BoxGeometry(w, h, d), wall, x, h / 2, z, { ry: yaw });
  // 3本の辺の円柱を横に倒し、角を上に向けて、屋根の三角柱にする。
  const prism = new THREE.CylinderGeometry(d * 0.62, d * 0.62, w + 0.8, 3).rotateZ(Math.PI / 2).rotateX(-Math.PI / 2).scale(1, 0.55, 1);
  p.add(prism, roof, x, h + d * 0.15, z, { ry: yaw });
}

export function castleTown(s: Site) {
  const rng = new Rng(seedOf(s.park.id));
  const sky = s.look.sky;
  panorama(s, (g, W, H, r) => {
    clouds(g, W, r, 9);
    ridge(g, W, H, r, { base: 30, amp: 170, color: haze('#4d7a5f', sky, 0.5), peaks: 5 });
    ridge(g, W, H, r, { base: 0, amp: 90, color: haze('#3f7050', sky, 0.3), peaks: 9 });
  });
  const props = new Props();
  // 天守閣：左中間の奥、石垣の上に5層。
  const c = polar(s, -0.5, s.radius + 85);
  const yaw = facing(s, c);
  props.add(new THREE.CylinderGeometry(19, 27, 16, 4), '#8d8a82', c.x, 8, c.z, { ry: yaw + Math.PI / 4 });
  let y = 16;
  for (let k = 0; k < 5; k++) {
    const w = 26 - k * 4.2;
    const h = k === 0 ? 7 : 5.5;
    props.add(new THREE.BoxGeometry(w, h, w * 0.8), '#f7f5ef', c.x, y + h / 2, c.z, { ry: yaw });
    props.add(new THREE.CylinderGeometry(w * 0.45, w * 0.85, 2.6, 4), '#4f6f6a', c.x, y + h + 1, c.z, { ry: yaw + Math.PI / 4, s: [1, 1, 0.8] });
    y += h + 2;
  }
  props.add(new THREE.ConeGeometry(4, 4, 4), '#4f6f6a', c.x, y + 1.5, c.z, { ry: yaw + Math.PI / 4 });
  for (const side of [-1, 1]) props.add(new THREE.BoxGeometry(0.8, 1.6, 1.2), '#e0b23c', c.x + Math.cos(yaw) * side * 2.5, y + 3.6, c.z - Math.sin(yaw) * side * 2.5);
  // 五重塔：右中間の奥。
  const t = polar(s, 0.75, s.radius + 70);
  let ty = 0;
  for (let k = 0; k < 5; k++) {
    const w = 10 - k * 1.2;
    props.add(new THREE.BoxGeometry(w * 0.7, 4.2, w * 0.7), '#a8452f', t.x, ty + 2.1, t.z);
    props.add(new THREE.CylinderGeometry(w * 0.3, w * 0.8, 1.6, 4), '#3f3f45', t.x, ty + 4.9, t.z, { ry: Math.PI / 4 });
    ty += 5.7;
  }
  props.add(new THREE.CylinderGeometry(0.25, 0.25, 9, 6), '#c9a640', t.x, ty + 4.5, t.z);
  // 松。
  for (let i = 0; i < 26; i++) {
    const p = polar(s, -0.5 + rng.range(-0.3, 0.3), s.radius + rng.range(55, 120));
    if (Math.hypot(p.x - c.x, p.z - c.z) < 26) continue;
    props.add(new THREE.CylinderGeometry(0.4, 0.6, 6, 5), '#5b4033', p.x, 3, p.z);
    for (let k = 0; k < 3; k++) props.add(new THREE.IcosahedronGeometry(2.6 - k * 0.5, 0), '#2f5a3a', p.x + rng.range(-1.5, 1.5), 6 + k * 2, p.z + rng.range(-1.5, 1.5), { s: [1.4, 0.6, 1.4] });
  }
  // 瓦屋根の町並み。
  const walls = ['#efe7d6', '#d9cbb0', '#8a6a4c', '#f3efe6'];
  for (let i = 0; i < 320; i++) {
    const a = rng.range(0, Math.PI * 2);
    const p = polar(s, a, s.radius + rng.range(10, 170));
    if (Math.hypot(p.x - c.x, p.z - c.z) < 32 || Math.hypot(p.x - t.x, p.z - t.z) < 12) continue;
    house(props, p.x, p.z, facing(s, p) + (rng.chance(0.5) ? 0 : Math.PI / 2), rng.range(6, 11), rng.range(5, 8), rng.range(3.5, 6.5), rng.pick(walls), rng.chance(0.8) ? '#4a4e57' : '#6b4f3a');
  }
  s.group.add(props.mesh());
}

// ---- サックスターズ：荒野 -----------------------------------------------------------------

export function desert(s: Site): Animate {
  const rng = new Rng(seedOf(s.park.id));
  const sky = s.look.sky;
  panorama(s, (g, W, H, r) => {
    // 遠くの台地（上が平らな岩山）。
    for (const [layer, color] of [
      [0, haze('#c77b4f', sky, 0.55)],
      [1, haze('#b5643c', sky, 0.35)]
    ] as const) {
      g.fillStyle = color;
      let x = r.range(0, 200);
      while (x < W) {
        const w = r.range(120, 360) * (layer ? 0.7 : 1);
        const h = r.range(150, 280) * (layer ? 0.75 : 1);
        g.beginPath();
        g.moveTo(x, H);
        g.lineTo(x + w * 0.12, H - h);
        g.lineTo(x + w * 0.88, H - h);
        g.lineTo(x + w, H);
        g.fill();
        x += w + r.range(80, 400);
      }
    }
  });
  const props = new Props();
  // 台地と岩の塔（赤い地層のしま）。
  const reds = ['#b5643c', '#c4744a', '#a35633', '#cf8457'];
  for (let i = 0; i < 12; i++) {
    const p = polar(s, rng.range(0, Math.PI * 2), s.radius + rng.range(80, 260));
    const rad = rng.range(12, 34);
    const h = rng.range(22, 58);
    let y = 0;
    for (let k = 0; k < 3; k++) {
      const part = h * [0.45, 0.35, 0.2][k];
      const rr = rad * (1 - k * 0.07);
      props.add(new THREE.CylinderGeometry(rr * 0.97, rr, part, 7), reds[(i + k) % reds.length], p.x, y + part / 2, p.z, { ry: i });
      y += part;
    }
    props.add(new THREE.DodecahedronGeometry(rad * 0.5, 0), '#9c5a3a', p.x + rad, 2, p.z, { s: [1, 0.5, 1] });
  }
  // サボテンと岩。
  for (let i = 0; i < 90; i++) {
    const p = polar(s, rng.range(0, Math.PI * 2), s.radius + rng.range(8, 150));
    if (i % 4 === 0) {
      props.add(new THREE.DodecahedronGeometry(rng.range(1, 3), 0), '#a7684a', p.x, 0.6, p.z, { s: [1, 0.6, 1] });
      continue;
    }
    const h = rng.range(4, 9);
    props.add(new THREE.CylinderGeometry(0.55, 0.65, h, 8), '#5f8f4e', p.x, h / 2, p.z);
    for (const side of [-1, 1]) {
      if (!rng.chance(0.7)) continue;
      const ay = h * rng.range(0.35, 0.6);
      const ry = facing(s, p);
      const dx = Math.cos(ry) * side * 1.3;
      const dz = -Math.sin(ry) * side * 1.3;
      props.add(new THREE.CylinderGeometry(0.35, 0.35, 1.6, 6), '#5f8f4e', p.x + dx * 0.6, ay, p.z + dz * 0.6, { ry, rz: Math.PI / 2 });
      props.add(new THREE.CylinderGeometry(0.38, 0.38, h * 0.35, 6), '#5f8f4e', p.x + dx, ay + h * 0.17, p.z + dz);
    }
  }
  s.group.add(props.mesh());
  // 転がる枯れ草。
  const weeds: { m: THREE.Mesh; a: number; r: number }[] = [];
  for (let i = 0; i < 6; i++) {
    const m = mesh(new THREE.IcosahedronGeometry(0.9, 1), new THREE.MeshLambertMaterial({ color: '#a8875a', wireframe: true }));
    s.group.add(m);
    weeds.push({ m, a: rng.range(0, Math.PI * 2), r: s.radius + rng.range(10, 40) });
  }
  return (dt) => {
    for (const w of weeds) {
      w.a += dt * (4 / w.r);
      const p = polar(s, w.a, w.r);
      w.m.position.set(p.x, 0.9 + Math.abs(Math.sin(w.a * 40)) * 0.6, p.z);
      w.m.rotation.x += dt * 4;
    }
  };
}

