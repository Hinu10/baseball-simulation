// キーボード（W/S で選ぶ、A/D で値を変える、J で決定）とマウスの両方で操作できるメニュー。
import type { InputFrame } from '../input/actions.ts';

export interface MenuOption<T = string> {
  value: T;
  label: string;
  /** 見出しをつけてまとめる組（リーグなど）。同じ組の選択肢は続けて並べておく。 */
  group?: string;
}

export type MenuItem =
  | { kind: 'choice'; label: string; options: MenuOption[]; get: () => string; set: (v: string) => void; hidden?: () => boolean }
  | { kind: 'button'; label: string; action: () => void; primary?: boolean; hidden?: () => boolean };

export class MenuList {
  readonly el: HTMLElement;
  private focus = 0;
  private repeat = 0;

  private readonly items: MenuItem[];

  constructor(items: MenuItem[]) {
    this.items = items;
    this.el = document.createElement('div');
    this.el.className = 'menu-list';
    this.render();
  }

  private visible(): MenuItem[] {
    return this.items.filter((i) => !i.hidden?.());
  }

  render() {
    const items = this.visible();
    this.focus = Math.min(this.focus, items.length - 1);
    this.el.innerHTML = '';
    items.forEach((item, idx) => {
      const row = document.createElement('div');
      row.className = `menu-row ${item.kind}${idx === this.focus ? ' focused' : ''}${item.kind === 'button' && item.primary ? ' primary' : ''}`;
      row.addEventListener('mouseenter', () => {
        this.focus = idx;
        this.mark();
      });
      if (item.kind === 'button') {
        const b = document.createElement('button');
        b.textContent = item.label;
        b.addEventListener('click', () => item.action());
        row.append(b);
      } else {
        const label = document.createElement('span');
        label.className = 'menu-label';
        label.textContent = item.label;
        const opts = document.createElement('span');
        opts.className = 'menu-options';
        // 組のある選択肢は、組ごとに見出しをつけて1行ずつ並べる。
        let box: HTMLElement = opts;
        let group: string | undefined;
        for (const o of item.options) {
          if (o.group && o.group !== group) {
            group = o.group;
            box = document.createElement('span');
            box.className = 'menu-group';
            const head = document.createElement('span');
            head.className = 'menu-group-label';
            head.textContent = o.group;
            box.append(head);
            opts.append(box);
          }
          const b = document.createElement('button');
          b.textContent = o.label;
          b.className = o.value === item.get() ? 'selected' : '';
          b.addEventListener('click', () => {
            item.set(o.value);
            this.render();
          });
          box.append(b);
        }
        row.append(label, opts);
      }
      this.el.append(row);
    });
  }

  private mark() {
    [...this.el.children].forEach((c, i) => c.classList.toggle('focused', i === this.focus));
    // 画面に収まらないメニューでは、選んだ項目が見えるようにスクロールする。
    this.el.children[this.focus]?.scrollIntoView({ block: 'nearest' });
  }

  /** 毎フレーム呼ぶ。 */
  handle(f: InputFrame, dt: number) {
    const items = this.visible();
    if (!items.length) return;
    // スティックを倒し続けたときは一定間隔でくり返す。
    this.repeat -= dt;
    const y = Math.abs(f.move.y) > 0.5 ? Math.sign(f.move.y) : 0;
    const x = Math.abs(f.move.x) > 0.5 ? Math.sign(f.move.x) : 0;
    if ((y || x) && this.repeat > 0) return;
    if (!y && !x) this.repeat = 0;
    if (y) {
      this.focus = (this.focus - y + items.length) % items.length;
      this.repeat = 0.2;
      this.mark();
    }
    const item = items[this.focus];
    if (x && item.kind === 'choice') {
      const i = item.options.findIndex((o) => o.value === item.get());
      item.set(item.options[(i + x + item.options.length) % item.options.length].value);
      this.repeat = 0.2;
      this.render();
    }
    if (f.pressed.primary && item.kind === 'button') item.action();
  }
}
