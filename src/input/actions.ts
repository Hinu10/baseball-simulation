// 入力のアクションマップ。ゲーム側はキー名ではなくアクション名で入力を読む。
// キーボードを優先し、Gamepad API（標準マッピング）でゲームパッドも同じアクションに割り当てる。

export type Action = 'primary' | 'secondary' | 'switch' | 'pause' | 'mode' | 'fast' | 'tactic1' | 'tactic2' | 'tactic3';

/** アクションごとのキー（KeyboardEvent.code）。 */
export const KEY_BINDINGS: Record<Action, string[]> = {
  primary: ['KeyJ'],
  secondary: ['KeyK'],
  switch: ['KeyL'],
  pause: ['Escape', 'KeyP'],
  mode: ['Tab'],
  fast: ['KeyF'],
  tactic1: ['Digit1'],
  tactic2: ['Digit2'],
  tactic3: ['Digit3']
};

const MOVE_KEYS = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight']
};

/** ゲームパッドのボタン番号（標準マッピング）。 */
const PAD_BUTTONS: Record<Action, number[]> = {
  primary: [0],
  secondary: [1],
  switch: [2],
  pause: [9],
  mode: [8],
  fast: [3],
  tactic1: [],
  tactic2: [],
  tactic3: []
};
const PAD_DPAD = { up: 12, down: 13, left: 14, right: 15 };
const STICK_DEADZONE = 0.25;

const ACTIONS = Object.keys(KEY_BINDINGS) as Action[];

export interface InputFrame {
  /** 移動・カーソル。x は右が +、y は上（W）が +。長さは 1 以下。 */
  move: { x: number; y: number };
  /** このフレームで押されたアクション。 */
  pressed: Record<Action, boolean>;
  /** 押し続けているアクション。 */
  held: Record<Action, boolean>;
}

const emptyRecord = (): Record<Action, boolean> =>
  Object.fromEntries(ACTIONS.map((a) => [a, false])) as Record<Action, boolean>;

export class InputMap {
  private readonly down = new Set<string>();
  /** 前回の frame() から今までに押されたキー。短い押下も取りこぼさない。 */
  private readonly tapped = new Set<string>();
  private padHeldBefore = emptyRecord();
  enabled = true;

  constructor(target: Window) {
    target.addEventListener('keydown', (e) => {
      if (this.isBound(e.code)) e.preventDefault();
      if (!e.repeat) this.tapped.add(e.code);
      this.down.add(e.code);
    });
    target.addEventListener('keyup', (e) => this.down.delete(e.code));
    // フォーカスが外れたら押しっぱなし扱いを解除する。
    target.addEventListener('blur', () => this.down.clear());
  }

  private isBound(code: string): boolean {
    return ACTIONS.some((a) => KEY_BINDINGS[a].includes(code)) || Object.values(MOVE_KEYS).some((k) => k.includes(code));
  }

  frame(): InputFrame {
    const pressed = emptyRecord();
    const held = emptyRecord();
    const any = (codes: string[]) => codes.some((c) => this.down.has(c));
    // 移動キーは、フレームの間に押して離した短い押下も 1 フレーム分の入力として数える。
    const anyMove = (codes: string[]) => codes.some((c) => this.down.has(c) || this.tapped.has(c));
    for (const a of ACTIONS) {
      held[a] = any(KEY_BINDINGS[a]);
      pressed[a] = KEY_BINDINGS[a].some((c) => this.tapped.has(c));
    }
    let x = (anyMove(MOVE_KEYS.right) ? 1 : 0) - (anyMove(MOVE_KEYS.left) ? 1 : 0);
    let y = (anyMove(MOVE_KEYS.up) ? 1 : 0) - (anyMove(MOVE_KEYS.down) ? 1 : 0);

    const pad = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads().find((p) => p) : null;
    const padHeld = emptyRecord();
    if (pad) {
      for (const a of ACTIONS) padHeld[a] = PAD_BUTTONS[a].some((i) => pad.buttons[i]?.pressed);
      const btn = (i: number) => (pad.buttons[i]?.pressed ? 1 : 0);
      const sx = pad.axes[0] ?? 0;
      const sy = pad.axes[1] ?? 0;
      x += Math.abs(sx) > STICK_DEADZONE ? sx : btn(PAD_DPAD.right) - btn(PAD_DPAD.left);
      y += Math.abs(sy) > STICK_DEADZONE ? -sy : btn(PAD_DPAD.up) - btn(PAD_DPAD.down);
      for (const a of ACTIONS) {
        held[a] ||= padHeld[a];
        pressed[a] ||= padHeld[a] && !this.padHeldBefore[a];
      }
    }
    this.padHeldBefore = padHeld;
    this.tapped.clear();

    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    if (!this.enabled) return { move: { x: 0, y: 0 }, pressed: emptyRecord(), held: emptyRecord() };
    return { move: { x, y }, pressed, held };
  }
}
