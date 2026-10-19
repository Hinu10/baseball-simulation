// 試合中の HUD（DOM）。Match の状態を読んで表示するだけ。
import { STRATEGY_LABEL } from '../core/ai.ts';
import { basePos } from '../core/field.ts';
import { addLines, battingTeam, currentBatter, currentBatterPosition, currentPitcher, emptyLine, fieldingTeam, score, type GameState } from '../core/gameState.ts';
import type { Match } from '../core/match.ts';
import { fatigue, PITCHES } from '../core/pitching.ts';
import { POSITION_LABEL } from '../core/types.ts';
import type { MatchView } from '../render/view.ts';
import { conditionBadge } from './roster.ts';
import { formatAverage, type SeasonStats } from './season.ts';

export const MODE_LABEL = { manual: '手動', manager: '監督', auto: '自動' } as const;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function bar(v: number, cls = '') {
  return `<span class="bar ${cls}"><span style="width:${Math.max(0, Math.min(100, v))}%"></span></span>`;
}

export class Hud {
  readonly el: HTMLElement;
  private readonly parts: Record<string, HTMLElement> = {};
  private readonly cache = new Map<string, string>();
  private bannerKey = '';
  /** これまでの試合の通算成績（この試合の分は含まない）。 */
  season: SeasonStats = {};

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'hud';
    this.el.innerHTML = `
      <div class="panel scorebox">
        <div class="inning" data-p="inning"></div>
        <table data-p="lines"></table>
        <div class="count-row">
          <div class="bso" data-p="bso"></div>
          <svg class="diamond" viewBox="0 0 60 60" data-p="bases">
            <rect class="base b2" x="24" y="4" width="12" height="12" transform="rotate(45 30 10)"/>
            <rect class="base b1" x="44" y="24" width="12" height="12" transform="rotate(45 50 30)"/>
            <rect class="base b3" x="4" y="24" width="12" height="12" transform="rotate(45 10 30)"/>
            <path class="home" d="M24 44 h12 v6 l-6 6 l-6 -6z"/>
          </svg>
        </div>
      </div>
      <div class="panel mode" data-p="mode"></div>
      <div class="banner" data-p="banner"></div>
      <div class="pitch-info" data-p="pitchInfo"></div>
      <div class="panel card batter" data-p="batter"></div>
      <div class="panel card pitcher" data-p="pitcher"></div>
      <div class="panel select" data-p="select"></div>
      <div class="guide" data-p="guide"></div>
      <div class="throw-labels" data-p="throws"></div>
    `;
    for (const e of this.el.querySelectorAll<HTMLElement>('[data-p]')) this.parts[e.dataset.p!] = e;
  }

  /** 中身が変わったときだけ書き換える。 */
  private html(part: string, html: string) {
    if (this.cache.get(part) === html) return;
    this.cache.set(part, html);
    this.parts[part].innerHTML = html;
  }

  /** 打率・本塁打・打点（通算＋この試合）と、この試合の打席結果。 */
  private seasonLine(s: GameState, id: string): string {
    const today = s.batting[id] ?? emptyLine();
    const total = addLines(this.season[id] ?? emptyLine(), today);
    const todayText = today.pa ? `今日 ${today.ab}打数${today.h}安打${today.hr ? ` ${today.hr}本塁打` : ''}${today.rbi ? ` ${today.rbi}打点` : ''}` : '今日 初打席';
    return `<div class="season"><span>打率<b>${formatAverage(total)}</b></span><span>本塁打<b>${total.hr}</b></span><span>打点<b>${total.rbi}</b></span></div><div class="today">${todayText}</div>`;
  }

  private lines(s: GameState): string {
    // 延長に入ったら列を足す。
    const cols = Array.from({ length: Math.max(s.innings, s.inning) }, (_, i) => i + 1);
    const head = `<tr><th></th>${cols.map((c) => `<th>${c}</th>`).join('')}<th>R</th><th>H</th></tr>`;
    const rows = s.teams
      .map((t, i) => {
        const live = (i === 0 ? 'top' : 'bottom') === s.half && !s.over;
        const cells = cols
          .map((c) => {
            const v = t.runsByInning[c - 1];
            const now = live && c === s.inning;
            return `<td class="${now ? 'now' : ''}">${v ?? (now ? 0 : '')}</td>`;
          })
          .join('');
        return `<tr class="${live ? 'batting' : ''}"><th style="--team:${t.team.colors.primary}">${esc(t.team.shortName)}</th>${cells}<td class="r">${score(s, i as 0 | 1)}</td><td>${t.hits}</td></tr>`;
      })
      .join('');
    return head + rows;
  }

  update(m: Match, view: MatchView, width: number, height: number, speed: number) {
    const s = m.state;
    this.html('inning', `${s.inning}回${s.half === 'top' ? '表' : '裏'}`);
    this.html('lines', this.lines(s));
    const lamp = (n: number, max: number, cls: string) => Array.from({ length: max }, (_, i) => `<i class="${i < n ? cls : ''}"></i>`).join('');
    this.html('bso', `<div><b>B</b>${lamp(s.balls, 3, 'g')}</div><div><b>S</b>${lamp(s.strikes, 2, 'y')}</div><div><b>O</b>${lamp(s.outs, 2, 'r')}</div>`);
    const bases = this.parts.bases;
    for (const b of [1, 2, 3]) {
      const on = m.play && m.phase === 'play' ? m.play.runners.some((r) => r.state === 'active' && Math.abs(r.u - b) < 0.05) : !!s.bases[b as 1];
      bases.querySelector(`.b${b}`)!.classList.toggle('on', on);
    }

    // モード表示。予約があれば「次の投球から」。
    const next = m.pendingMode ? `<div class="next">次の投球から ${MODE_LABEL[m.pendingMode]}モード</div>` : '';
    const strat =
      m.mode === 'manager'
        ? `<div class="strat"><span>1 攻撃:${STRATEGY_LABEL.offense[m.strategy.offense]}</span><span>2 投球:${STRATEGY_LABEL.pitching[m.strategy.pitching]}</span><span>3 走塁:${STRATEGY_LABEL.running[m.strategy.running]}</span></div>`
        : '';
    const ff = m.mode === 'auto' ? `<span class="ff">×${speed}</span>` : '';
    const you = m.state.teams[m.humanTeam].team.shortName;
    this.html('mode', `<div class="mode-name">${MODE_LABEL[m.mode]}モード ${ff}</div><div class="you">あなた：${esc(you)}</div>${strat}${next}`);

    // 打者と投手。
    const batter = currentBatter(s);
    const bt = s.teams[battingTeam(s)];
    const pitcher = currentPitcher(s);
    const ft = s.teams[fieldingTeam(s)];
    this.html(
      'batter',
      `<div class="role" style="--team:${bt.team.colors.primary}">${bt.battingIndex + 1}番 ${POSITION_LABEL[currentBatterPosition(s)]}　${batter.bats === 'R' ? '右打' : '左打'}</div>
       <div class="name">${esc(batter.name)}${conditionBadge(batter.condition)}</div>
       ${this.seasonLine(s, batter.id)}
       <div class="stats"><span>ミート</span>${bar(batter.meet)}<span>パワー</span>${bar(batter.power, 'pow')}<span>走力</span>${bar(batter.speed, 'spd')}</div>`
    );
    const stamina = Math.round((1 - fatigue(pitcher, ft.pitchCount)) * 100);
    this.html(
      'pitcher',
      `<div class="role" style="--team:${ft.team.colors.primary}">投手　${pitcher.throws === 'R' ? '右投' : '左投'}</div>
       <div class="name">${esc(pitcher.name)}${conditionBadge(pitcher.condition)}</div>
       <div class="stats"><span>球数</span><em>${ft.pitchCount}</em><span>スタミナ</span>${bar(stamina, stamina < 40 ? 'low' : 'sta')}<span>最速</span><em>${pitcher.velocity}km/h</em></div>`
    );

    // 投球の球種と球速。
    const p = m.pitch;
    this.html('pitchInfo', p && (m.phase === 'pitch' || m.phase === 'result') ? `${Math.round(p.speedKmh)}<small>km/h</small> ${PITCHES[p.type].label}` : '');

    // 人が投げる・打つときの選択。
    let select = '';
    if (m.humanPitching && (m.phase === 'pre-pitch' || m.phase === 'windup')) {
      select = `<div class="title">球種（L）</div>${pitcher.pitches.map((t) => `<div class="opt ${t === m.pitchType ? 'on' : ''}">${PITCHES[t].label}</div>`).join('')}`;
    } else if (m.humanBatting && m.phase !== 'play' && m.phase !== 'result') {
      const cur = m.buntStance ? 'bunt' : m.swingMode;
      select = `<div class="title">${m.easyBatting ? 'かんたん打撃' : '打撃'}（L / K）</div>${[
        ['meet', 'ミート'],
        ['power', '強振'],
        ['bunt', 'バント']
      ]
        .map(([k, l]) => `<div class="opt ${k === cur ? 'on' : ''} ${k}">${l}</div>`)
        .join('')}`;
    }
    this.html('select', select);
    this.parts.select.style.display = select ? '' : 'none';

    // 結果の文字。結果の表示がないときは、選手交代の知らせを少しのあいだ出す。
    const notice = m.notice && m.clock - m.notice.clock < 2.5 ? { text: m.notice.text, kind: 'info' as const } : null;
    const msg = m.phase === 'result' && m.message ? m.message : notice;
    const key = msg ? `${msg.text}|${s.log.length}|${s.teams[1].pitchCount + s.teams[0].pitchCount}` : '';
    if (key !== this.bannerKey) {
      this.bannerKey = key;
      this.parts.banner.className = `banner ${msg ? `show ${msg.kind}` : ''}`;
      this.parts.banner.textContent = msg?.text ?? '';
    }

    // 操作ガイド。
    const g: string[] = [];
    const play = m.phase === 'play' ? m.play : null;
    if (play && play.controlled >= 0) {
      const f = play.fielders[play.controlled];
      g.push(f.hasBall ? 'J＋方向 送球（W 二塁・D 一塁・A 三塁・S 本塁、J だけ＝おすすめ）' : 'WASD 移動', 'K ダイブ', 'L 選手切替');
    } else if (play && m.isHuman(battingTeam(s))) {
      const sel = play.selectedRunner < 0 ? '全員' : play.runners[play.selectedRunner]?.name ?? '全員';
      g.push(`J 進塁`, `K 帰塁`, `L 走者切替（いま：${esc(sel)}）`);
    } else if (m.humanPitching && m.phase === 'pre-pitch') {
      g.push('WASD コース', 'L 球種', 'J 投球');
    } else if (m.humanBatting && (m.phase === 'pre-pitch' || m.phase === 'windup' || m.phase === 'pitch')) {
      if (m.easyBatting) g.push('J スイング（タイミングだけ）', 'W＋J フライ', 'S＋J ゴロ', 'L ミート/強振', 'K バント');
      else g.push('WASD カーソル', 'J スイング', 'L ミート/強振', 'K バント');
    }
    if (m.mode === 'auto') g.push('F 早送り');
    if (m.timeoutRequested) g.push('タイム要求中（次の投球前に選手交代）');
    g.push('Tab モード切替', 'Esc ポーズ');
    this.html('guide', g.map((x) => `<span>${x}</span>`).join(''));

    // 送球先ガイド：人の守備選手がボールを持っているとき、塁の上にキーを出す。
    let throws = '';
    if (play && play.controlled >= 0 && play.fielders[play.controlled].hasBall) {
      const marks: [number, string][] = [
        [2, 'W 二塁'],
        [1, 'D 一塁'],
        [3, 'A 三塁'],
        [4, 'S 本塁']
      ];
      for (const [b, label] of marks) {
        const pt = view.project({ ...basePos(b), y: 2.5 }, width, height);
        if (!pt) continue;
        // 画面の外の塁は端に寄せて出す。
        const x = Math.min(width - 70, Math.max(70, pt.x));
        const y = Math.min(height - 60, Math.max(40, pt.y));
        throws += `<div class="throw-label${x !== pt.x || y !== pt.y ? ' edge' : ''}" style="left:${x}px;top:${y}px">${label}</div>`;
      }
    }
    this.html('throws', throws);
  }
}
