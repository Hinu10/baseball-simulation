import './style.css';
import { InputMap } from './input/actions.ts';

const ui = document.getElementById('ui')!;
const input = new InputMap(window);

ui.innerHTML = '<div class="screen"><h1>Baseball Simulation</h1><p>準備中</p></div>';

function loop() {
  input.frame();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
