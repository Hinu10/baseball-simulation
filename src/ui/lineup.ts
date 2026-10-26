// 試合前のスタメン変更画面。先発選手を控えと入れ替え、必要なら打順・守備位置も変える。
// 相手は「打順を入れ替える」「控えと代える」「守備位置を入れ替える」から選べる。控えの選手を先に選んで、代える打順を選んでもよい。
// 組み替えは次の試合以降も残る。
import { applyLineupEdit, editOf, replaceSlot, swapOrder, swapPositions, type LineupEdit } from '../core/lineupEdit.ts';
import { lineupOf, roleOf, type TeamData } from '../core/teams.ts';
import { POSITION_LABEL } from '../core/types.ts';
import type { InputFrame } from '../input/actions.ts';
import { batterStats, pitcherStats } from './substitution.ts';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** 画面の1行。group が変わるところに見出しを出す。 */
interface Row {
  group?: string;
  html: string;
  pitcher?: boolean;
  act: () => void;
}

export interface LineupHost {
  /** 組み替える前のあなたのチーム（公示・調子を反映したもの）。 */
  team(): TeamData;
  edit(): LineupEdit | undefined;
  setEdit(e: LineupEdit | undefined): void;
  starter(): string;
  setStarter(id: string | null): void;
}

export class LineupPanel {
  readonly el = document.createElement('div');
  /** 選んでいる打順（0〜8）、先発投手なら 9、控えの選手ならその id。null なら最初の段階。 */
  private picked: number | string | null = null;
  private focus = 0;
  private repeat = 0;
  private message = '';
  onClose: () => void = () => {};
  private readonly host: LineupHost;

  constructor(host: LineupHost) {
    this.host = host;
    this.el.className = 'screen help-screen sub-screen';
  }

  open() {
    this.picked = null;
    this.focus = 0;
    const { repaired } = applyLineupEdit(this.host.team(), this.host.edit());
    this.message = repaired ? `1軍にいない選手がいたので、${repaired}人を入れ替えました` : '';
    this.render();
  }

  /** いまの組み替え（なければ元の打順）。1軍にいない選手は直したもの。 */
  private current(): LineupEdit {
    const t = this.host.team();
    return editOf(applyLineupEdit(t, this.host.edit()).team);
  }

  private set(e: LineupEdit, text: string) {
    this.host.setEdit(e);
    this.message = text;
    this.picked = null;
  }

  private rows(): Row[] {
    const t = this.host.team();
    const e = this.current();
    const byId = new Map(t.batters.map((b) => [b.id, b]));
    const name = (i: number) => byId.get(e.slots[i].id)!.name;
    const slotHtml = (i: number) => {
      const s = e.slots[i];
      const b = byId.get(s.id)!;
      const off = b.position !== s.pos ? `<em>本職 ${POSITION_LABEL[b.position]}</em>` : '';
      return `<span class="order">${i + 1}</span><span class="pos">${POSITION_LABEL[s.pos]}</span><span class="name">${esc(b.name)}${off}</span>${batterStats(b)}`;
    };
    const starter = t.pitchers.find((p) => p.id === this.host.starter())!;
    const bench = t.batters.filter((b) => !e.slots.some((s) => s.id === b.id));
    const benchHtml = (b: (typeof bench)[number]) => `<span class="order"></span><span class="pos">${POSITION_LABEL[b.position]}</span><span class="name">${esc(b.name)}</span>${batterStats(b)}`;
    if (this.picked === null) {
      return [
        ...e.slots.map((_, i) => ({ html: slotHtml(i), act: () => this.pick(i) })),
        { pitcher: true, html: `<span class="order"></span><span class="pos">投</span><span class="name">${esc(starter.name)}<em>先発</em></span>${pitcherStats(starter)}`, act: () => this.pick(9) },
        ...bench.map((b) => ({ group: '控え（選ぶと、代わりに出る打順を選べます）', html: benchHtml(b), act: () => this.pick(b.id) }))
      ];
    }
    const i = this.picked;
    if (typeof i === 'string') {
      const b = byId.get(i)!;
      return e.slots.map((_, j) => ({
        group: `${b.name} と代える選手（打順と守備位置はそのまま）`,
        html: slotHtml(j),
        act: () => {
          this.set(replaceSlot(e, j, b.id), `${name(j)} に代えて ${b.name} がスタメン`);
          this.focus = j;
        }
      }));
    }
    if (i === 9) {
      return t.pitchers
        .filter((p) => roleOf(p) === 'starter' && p.id !== starter.id)
        .map((p) => ({
          group: '先発させる投手',
          html: `<span class="order"></span><span class="pos">投</span><span class="name">${esc(p.name)}</span>${pitcherStats(p)}`,
          act: () => {
            this.host.setStarter(p.id);
            this.message = `先発　${starter.name} → ${p.name}`;
            this.picked = null;
          }
        }));
    }
    const others = e.slots.map((_, j) => j).filter((j) => j !== i);
    return [
      ...bench.map((b) => ({
        group: `先発を控えと代える（${POSITION_LABEL[e.slots[i].pos]}・${i + 1}番に入ります）`,
        html: benchHtml(b),
        act: () => this.set(replaceSlot(e, i, b.id), `${name(i)} に代えて ${b.name} がスタメン`)
      })),
      ...others.map((j) => ({ group: '打順を入れ替える', html: slotHtml(j), act: () => this.set(swapOrder(e, i, j), `${name(i)} を${j + 1}番、${name(j)} を${i + 1}番に`) })),
      ...others.map((j) => ({
        group: '守備位置を入れ替える',
        html: slotHtml(j),
        act: () => this.set(swapPositions(e, i, j), `${name(i)} が${POSITION_LABEL[e.slots[j].pos]}、${name(j)} が${POSITION_LABEL[e.slots[i].pos]}を守る`)
      }))
    ];
  }

  private pick(i: number | string) {
    this.picked = i;
    this.focus = 0;
    this.message = '';
  }

  private render() {
    const rows = this.rows();
    let group: string | undefined;
    const list = rows
      .map((r, i) => {
        const head = r.group !== group ? `<h4 class="sub-group">${esc(r.group ?? '')}</h4>` : '';
        group = r.group;
        return `${r.group ? head : ''}<button class="sub-row${i === this.focus ? ' focused' : ''}${r.pitcher ? ' pitcher' : ''}" data-i="${i}">${r.html}</button>`;
      })
      .join('');
    const e = this.current();
    const t = this.host.team();
    const p = this.picked;
    const title =
      p === null
        ? '組み替える選手を選んでください'
        : p === 9
          ? '先発投手を選んでください'
          : typeof p === 'string'
            ? `${esc(t.batters.find((b) => b.id === p)!.name)}（控え）を誰と代えますか`
            : `${esc(t.batters.find((b) => b.id === e.slots[p].id)!.name)}（${p + 1}番）をどうしますか`;
    const msg = this.message ? `<p class="sub-message">${esc(this.message)}</p>` : '';
    this.el.innerHTML = `<div class="panel help-card sub-card"><h2>スタメン・選手変更</h2><div class="sub-head">${esc(t.nameJa)}　この年度の次の試合から使います（先発投手はこの試合だけ）</div><h3>${title}</h3>${msg}<div class="sub-list">${list}</div>
      <p class="note">W/S で選ぶ　J で決定　K でもどる　L で元の打順にもどす</p><div class="pennant-buttons"><button class="reset">元の打順にもどす（L）</button><button class="close">${this.picked === null ? 'とじる（Esc）' : 'もどる（K）'}</button></div></div>`;
    this.el.querySelectorAll<HTMLButtonElement>('.sub-row').forEach((b) =>
      b.addEventListener('click', () => {
        this.focus = Number(b.dataset.i);
        this.decide();
      })
    );
    this.el.querySelector('.reset')!.addEventListener('click', () => this.reset());
    this.el.querySelector('.close')!.addEventListener('click', () => this.back());
    this.el.querySelector('.sub-row.focused')?.scrollIntoView({ block: 'nearest' });
  }

  private decide() {
    const row = this.rows()[this.focus];
    if (!row) return;
    const was = this.picked;
    row.act();
    if (this.picked === null && typeof was === 'number') this.focus = was;
    this.render();
  }

  private reset() {
    this.host.setEdit(undefined);
    this.host.setStarter(null);
    this.picked = null;
    this.focus = 0;
    this.message = `元の打順（${lineupOf(this.host.team())
      .map((b) => b.name.split(' ')[0])
      .slice(0, 3)
      .join('・')}…）にもどしました`;
    this.render();
  }

  private back() {
    if (this.picked !== null) {
      const was = this.picked;
      this.picked = null;
      // 控えを選んでいたなら、最初の一覧（打順9人・先発投手・控え）でその控えの行にもどる。
      const slots = this.current().slots;
      const bench = this.host.team().batters.filter((b) => !slots.some((s) => s.id === b.id));
      this.focus = typeof was === 'number' ? was : 10 + Math.max(0, bench.findIndex((b) => b.id === was));
      this.message = '';
      this.render();
      return;
    }
    this.onClose();
  }

  /** 毎フレーム呼ぶ。 */
  handle(f: InputFrame, dt: number) {
    if (f.pressed.pause) return this.onClose();
    if (f.pressed.secondary) return this.back();
    if (f.pressed.primary) return this.decide();
    if (f.pressed.switch) return this.reset();
    this.repeat -= dt;
    const y = Math.abs(f.move.y) > 0.5 ? Math.sign(f.move.y) : 0;
    if (!y) this.repeat = 0;
    if (!y || this.repeat > 0) return;
    const n = this.rows().length;
    if (!n) return;
    this.focus = (this.focus - y + n) % n;
    this.repeat = 0.2;
    this.render();
  }
}
