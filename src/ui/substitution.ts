// 選手交代の画面。下げる選手（打順の9人か投手）を選び、次に控えから入れる選手を選ぶ。
import { battingTeam, benchBatters, benchPitchers, type TeamGameState } from '../core/gameState.ts';
import type { Match } from '../core/match.ts';
import { fatigue } from '../core/pitching.ts';
import type { Substitution } from '../core/rules.ts';
import type { Batter, Pitcher } from '../core/teams.ts';
import { POSITION_LABEL } from '../core/types.ts';
import type { InputFrame } from '../input/actions.ts';
import { rank } from './roster.ts';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const stat = (label: string, v: number) => `<span class="sub-stat r-${rank(v)}">${label}<b>${rank(v)}</b></span>`;

/** 下げる選手。slot が -1 なら投手。 */
interface OutRow {
  slot: number;
  label: string;
  html: string;
  candidates: number;
}

export class SubstitutionPanel {
  readonly el = document.createElement('div');
  private match: Match | null = null;
  /** 選んでいる下げる選手（null なら下げる選手を選ぶ段階）。 */
  private out: OutRow | null = null;
  private focus = 0;
  private repeat = 0;
  private message = '';
  onClose: () => void = () => {};

  constructor() {
    this.el.className = 'screen help-screen sub-screen';
  }

  open(m: Match) {
    this.match = m;
    this.out = null;
    this.focus = 0;
    this.message = '';
    this.render();
  }

  private get team(): TeamGameState {
    const m = this.match!;
    return m.state.teams[m.humanTeam];
  }

  private outRows(): OutRow[] {
    const t = this.team;
    const s = this.match!.state;
    const atBat = battingTeam(s) === this.match!.humanTeam ? t.battingIndex : -1;
    const bench = benchBatters(t).length;
    const rows: OutRow[] = t.lineup.map((b, i) => {
      const where = i === atBat ? '<em>打席</em>' : s.bases.includes(b.id) && atBat >= 0 ? `<em>${s.bases.indexOf(b.id)}塁</em>` : '';
      return {
        slot: i,
        label: `${i + 1}番 ${b.name}`,
        html: `<span class="order">${i + 1}</span><span class="pos">${POSITION_LABEL[t.positions[i]]}</span><span class="name">${esc(b.name)}${where}</span>${batterStats(b)}`,
        candidates: bench
      };
    });
    const p = t.pitcher;
    const sta = Math.round((1 - fatigue(p, t.pitchCount)) * 100);
    rows.push({
      slot: -1,
      label: `投手 ${p.name}`,
      html: `<span class="order"></span><span class="pos">投</span><span class="name">${esc(p.name)}<em>${t.pitchCount}球・スタミナ${sta}%</em></span>${pitcherStats(p)}`,
      candidates: benchPitchers(t).length
    });
    return rows;
  }

  private inRows(): { id: string; html: string }[] {
    const t = this.team;
    if (this.out!.slot < 0) return benchPitchers(t).map((p) => ({ id: p.id, html: `<span class="pos">投</span><span class="name">${esc(p.name)}</span>${pitcherStats(p)}` }));
    return benchBatters(t).map((b) => ({ id: b.id, html: `<span class="pos">${POSITION_LABEL[b.position]}</span><span class="name">${esc(b.name)}</span>${batterStats(b)}` }));
  }

  private render() {
    const m = this.match;
    if (!m) return;
    const s = m.state;
    const head = `${s.inning}回${s.half === 'top' ? '表' : '裏'}　${s.outs}アウト`;
    let title: string;
    let rows: string;
    if (!this.out) {
      title = '下げる選手を選んでください';
      rows = this.outRows()
        .map((r, i) => `<button class="sub-row${i === this.focus ? ' focused' : ''}${r.slot < 0 ? ' pitcher' : ''}" data-i="${i}" ${r.candidates ? '' : 'disabled'}>${r.html}</button>`)
        .join('');
    } else {
      const pos = this.out.slot < 0 ? '投手' : `${POSITION_LABEL[this.team.positions[this.out.slot]]}・${this.out.slot + 1}番`;
      title = `${esc(this.out.label)} に代えて入れる選手（${pos}に入ります）`;
      rows = this.inRows()
        .map((r, i) => `<button class="sub-row${i === this.focus ? ' focused' : ''}" data-i="${i}">${r.html}</button>`)
        .join('');
    }
    const msg = this.message ? `<p class="sub-message">${esc(this.message)}</p>` : '';
    this.el.innerHTML = `<div class="panel help-card sub-card"><h2>選手交代</h2><div class="sub-head">${head}</div><h3>${title}</h3>${msg}<div class="sub-list">${rows}</div>
      <p class="note">W/S で選ぶ　J で決定　K でもどる　一度下がった選手は再出場できません</p><button class="close">${this.out ? 'もどる（K）' : 'とじる（Esc）'}</button></div>`;
    this.el.querySelectorAll<HTMLButtonElement>('.sub-row').forEach((b) =>
      b.addEventListener('click', () => {
        this.focus = Number(b.dataset.i);
        this.decide();
      })
    );
    this.el.querySelector('.close')!.addEventListener('click', () => this.back());
  }

  private decide() {
    if (!this.out) {
      const row = this.outRows()[this.focus];
      if (!row?.candidates) return;
      this.out = row;
      this.focus = 0;
      this.message = '';
      this.render();
      return;
    }
    const pick = this.inRows()[this.focus];
    if (!pick) return;
    const sub: Substitution = this.out.slot < 0 ? { kind: 'pitcher', playerId: pick.id } : { kind: 'batter', slot: this.out.slot, playerId: pick.id };
    const error = this.match!.substitute(sub);
    const done = this.out.slot;
    this.out = null;
    this.focus = done < 0 ? 9 : done;
    this.message = error ?? this.match!.notice?.text ?? '';
    this.render();
  }

  private back() {
    if (this.out) {
      this.focus = this.out.slot < 0 ? 9 : this.out.slot;
      this.out = null;
      this.render();
      return;
    }
    this.onClose();
  }

  /** 毎フレーム呼ぶ。 */
  handle(f: InputFrame, dt: number) {
    if (f.pressed.pause) {
      this.onClose();
      return;
    }
    if (f.pressed.secondary) {
      this.back();
      return;
    }
    if (f.pressed.primary) {
      this.decide();
      return;
    }
    this.repeat -= dt;
    const y = Math.abs(f.move.y) > 0.5 ? Math.sign(f.move.y) : 0;
    if (!y) this.repeat = 0;
    if (!y || this.repeat > 0) return;
    const n = this.out ? this.inRows().length : this.outRows().length;
    if (!n) return;
    this.focus = (this.focus - y + n) % n;
    this.repeat = 0.2;
    this.render();
  }
}

function batterStats(b: Batter) {
  return `<span class="sub-stats">${stat('ミ', b.meet)}${stat('パ', b.power)}${stat('走', b.speed)}${stat('肩', b.arm)}${stat('守', b.fielding)}</span>`;
}

function pitcherStats(p: Pitcher) {
  return `<span class="sub-stats"><span class="sub-stat">${p.velocity}km/h</span>${stat('制', p.control)}${stat('ス', p.stamina)}${stat('変', p.breaking)}</span>`;
}
