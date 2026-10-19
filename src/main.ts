import './style.css';
import * as THREE from 'three';
import raw from './data/teams.json' with { type: 'json' };
import { Match } from './core/match.ts';
import { parseTeams } from './core/teams.ts';
import { InputMap } from './input/actions.ts';
import { MatchView } from './render/view.ts';

const canvas = document.getElementById('view') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
const input = new InputMap(window);
const view = new MatchView();
const [away, home] = parseTeams(raw);
const match = new Match({ away, home, mode: 'auto' });
view.attach(match);

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  view.resize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', resize);
resize();

let last = performance.now();
function loop(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const f = input.frame();
  match.tick(dt, { move: f.move, primary: f.pressed.primary, secondary: f.pressed.secondary, switch: f.pressed.switch });
  view.update(dt);
  renderer.render(view.scene, view.camera);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
(window as unknown as { __bb: unknown }).__bb = { match };
