// 試合中の HUD（DOM）。Match の状態を読んで表示するだけ。
import { STRATEGY_LABEL } from '../core/ai.ts';
import { basePos } from '../core/field.ts';
import { addLines, addPitchingLines, battingTeam, currentBatter, currentBatterPosition, currentPitcher, emptyLine, emptyPitchingLine, fieldingTeam, score, type GameState } from '../core/gameState.ts';
import type { Match } from '../core/match.ts';
import { PITCHES, staminaLeft } from '../core/pitching.ts';
import { accentColor } from '../core/teams.ts';
import { POSITION_LABEL } from '../core/types.ts';
import type { MatchView } from '../render/view.ts';
import { conditionBadge } from './roster.ts';
import { formatAverage, formatEra, formatInnings, type SeasonPitching, type SeasonStats } from './season.ts';

export const MODE_LABEL = { manual: '手動', manager: '監督', auto: '自動' } as const;

const CONTACT_LABEL = { sweet: '芯！', handle: '詰まった', tip: '先っぽ' } as const;
/** 場内アナウンスのテロップを出しておく秒（試合の時間で）。 */
const ANNOUNCE_TIME = 3.2;
/** 合間の場面（J でとばせる）。 */
const SCENES: readonly string[] = ['change', 'relief', 'warmup', 'replay'];
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function bar(v: number, cls = '') {
  return `<span class="bar ${cls}"><span style="width:${Math.max(0, Math.min(100, v))}%"></span></span>`;
}

export class Hud {
  readonly el: HTMLElement;
  private readonly parts: Record<string, HTMLElement> = {};
  private readonly cache = new Map<string, string>();
  private bannerKey = '';
  /** 場内アナウンス：いま出しているテロップと、紹介済みの打者（チーム・打順ごと）・投手（チームごと）。 */
  private announce: { html: string; until: number } | null = null;
  private announcedBatter: Record<string, string> = {};
  private announcedPitcher: Record<number, string> = {};
  private batterKey = '';
  private match: Match | null = null;
  /** これまでの試合の通算成績（この試合の分は含まない）。 */
  season: SeasonStats = {};
  /** これまでの試合の投手成績（この試合の分は含まない）。 */
  seasonPitching: SeasonPitching = {};
  /** 通算にこの試合の成績を足すか（過去の年度の練習試合では、その年の成績をそのまま出す）。 */
  countToday = true;

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
      <div class="announce" data-p="announce"></div>
      <div class="replay-badge" data-p="replay">REPLAY</div>
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
    const total = addLines(this.season[id] ?? emptyLine(), this.countToday ? today : emptyLine());
    const todayText = today.pa ? `今日 ${today.ab}打数${today.h}安打${today.hr ? ` ${today.hr}本塁打` : ''}${today.rbi ? ` ${today.rbi}打点` : ''}` : '今日 初打席';
    return `<div class="season"><span>打率<b>${formatAverage(total)}</b></span><span>本塁打<b>${total.hr}</b></span><span>打点<b>${total.rbi}</b></span></div><div class="today">${todayText}</div>`;
  }

  /** 防御率・勝敗・奪三振（通算＋この試合）と、この試合の投球内容。 */
  private pitchingLine(s: GameState, id: string): string {
    const today = s.pitching[id] ?? emptyPitchingLine();
    const total = addPitchingLines(this.seasonPitching[id] ?? emptyPitchingLine(), this.countToday ? today : emptyPitchingLine());
    const todayText = today.outs || today.h || today.bb || today.hbp || today.r ? `今日 ${formatInnings(today.outs)} ${today.h}安打 ${today.so}奪三振${today.bb ? ` ${today.bb}四球` : ''}${today.hbp ? ` ${today.hbp}死球` : ''} ${today.r}失点` : '今日 初登板';
    return `<div class="season"><span>防御率<b>${formatEra(total)}</b></span><span>勝敗<b>${total.w}-${total.l}</b></span><span>奪三振<b>${total.so}</b></span></div><div class="today">${todayText}</div>`;
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
        return `<tr class="${live ? 'batting' : ''}"><th style="--team:${accentColor(t.team.colors)}">${esc(t.team.shortName)}</th>${cells}<td class="r">${score(s, i as 0 | 1)}</td><td>${t.hits}</td></tr>`;
      })
      .join('');
    return head + rows;
  }

  /**
   * 場内アナウンス：打者が打席に入るとき「3番 センター 物垣」、代打なら「代打」、投手が代わったら「〇〇に代わりまして ピッチャー △△」。
   * 試合が変わったら紹介済みの記録を消す。
   */
  private updateAnnounce(m: Match) {
    const s = m.state;
    if (m !== this.match) {
      this.match = m;
      this.announce = null;
      this.announcedBatter = {};
      this.batterKey = '';
      this.announcedPitcher = { 0: s.teams[0].pitcher.id, 1: s.teams[1].pitcher.id };
    }
    if (s.over) return;
    const def = fieldingTeam(s);
    const pitcher = currentPitcher(s);
    const before = this.announcedPitcher[def];
    if (before !== pitcher.id) {
      const old = s.teams[def].team.pitchers.find((p) => p.id === before);
      this.announcedPitcher[def] = pitcher.id;
      this.announce = { html: `<small>${old ? `${esc(old.name)}に代わりまして` : ''}</small>ピッチャー　<b>${esc(pitcher.name)}</b><small>背番号 ${pitcher.number}</small>`, until: m.clock + ANNOUNCE_TIME };
      return;
    }
    if (m.phase !== 'pre-pitch') return;
    const off = battingTeam(s);
    const t = s.teams[off];
    const batter = currentBatter(s);
    // 同じ打者の打席が続くあいだ（投球ごと）は出し直さない。続けて同じ打者が打席に入ることはない（間に別の打者か相手の攻撃がはさまる）。
    const slot = `${off}|${t.battingIndex}`;
    const key = `${slot}|${batter.id}`;
    if (key === this.batterKey) return;
    this.batterKey = key;
    const pinch = this.announcedBatter[slot] !== undefined && this.announcedBatter[slot] !== batter.id;
    this.announcedBatter[slot] = batter.id;
    const role = pinch ? `<small>${t.battingIndex + 1}番</small>代打` : `${t.battingIndex + 1}番　${POSITION_LABEL[currentBatterPosition(s)]}`;
    this.announce = { html: `${role}　<b>${esc(batter.name)}</b><small>背番号 ${batter.number}</small>`, until: m.clock + ANNOUNCE_TIME };
  }

  update(m: Match, view: MatchView, width: number, height: number, speed: number) {
    const s = m.state;
    this.updateAnnounce(m);
    const ann = this.announce && m.clock < this.announce.until ? this.announce.html : '';
    this.html('announce', ann);
    this.parts.announce.classList.toggle('show', !!ann);
    this.parts.replay.classList.toggle('show', m.phase === 'replay');
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
      `<div class="role" style="--team:${accentColor(bt.team.colors)}">${bt.battingIndex + 1}番 ${POSITION_LABEL[currentBatterPosition(s)]}　${batter.bats === 'R' ? '右打' : '左打'}</div>
       <div class="name">${esc(batter.name)}${conditionBadge(batter.condition)}</div>
       ${this.seasonLine(s, batter.id)}
       <div class="stats"><span>ミート</span>${bar(batter.meet)}<span>パワー</span>${bar(batter.power, 'pow')}<span>走力</span>${bar(batter.speed, 'spd')}</div>`
    );
    const stamina = Math.round(staminaLeft(pitcher, ft.pitchCount) * 100);
    this.html(
      'pitcher',
      `<div class="role" style="--team:${accentColor(ft.team.colors)}">投手　${pitcher.throws === 'R' ? '右投' : '左投'}</div>
       <div class="name">${esc(pitcher.name)}${conditionBadge(pitcher.condition)}</div>
       ${this.pitchingLine(s, pitcher.id)}
       <div class="stats"><span>球数</span><em>${ft.pitchCount}</em><span>スタミナ</span>${bar(stamina, stamina < 40 ? 'low' : 'sta')}<span>最速</span><em>${pitcher.velocity}km/h</em></div>`
    );

    // 投球の球種と球速。
    const p = m.pitch;
    // 打ったあとは、バットのどこに当たったかも出す。
    const spot = m.lastContact && m.lastContact !== 'normal' ? `<small>　${CONTACT_LABEL[m.lastContact]}</small>` : '';
    this.html(
      'pitchInfo',
      p && (m.phase === 'pitch' || m.phase === 'play' || m.phase === 'result') ? `${Math.round(p.speedKmh)}<small>km/h</small> ${PITCHES[p.type].label}${spot}` : ''
    );

    // 人が投げる・打つときの選択。
    let select = '';
    if (m.humanPitching && (m.phase === 'pre-pitch' || m.phase === 'windup')) {
      select = `<div class="title">球種（L）</div>${pitcher.pitches.map((t) => `<div class="opt ${t === m.pitchType ? 'on' : ''}">${PITCHES[t].label}</div>`).join('')}`;
    } else if (m.humanBatting && m.phase !== 'play' && m.phase !== 'result' && !SCENES.includes(m.phase)) {
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
    // 投手カードの高さは成績の行で変わるので、選択はその上に置く（カードを出さない狭い画面は CSS のまま）。
    const card = this.parts.pitcher;
    this.parts.select.style.bottom = select && card.offsetHeight ? `${this.el.clientHeight - card.offsetTop + 8}px` : '';

    // 結果の文字。結果の表示がないときは、選手交代の知らせを少しのあいだ出す。
    const notice = m.notice && m.clock - m.notice.clock < 2.5 ? { text: m.notice.text, kind: 'info' as const } : null;
    // プレー中でも、フライを捕った・一塁でアウトにした・本塁打が決まった瞬間に出す（終わったら結果の文言に出し直す）。
    const call = m.phase === 'play' ? m.play?.call : null;
    const live = call ? { text: call, kind: call.includes('ホームラン') ? ('run' as const) : ('out' as const) } : null;
    // 死球の後、両軍がもみ合っているあいだは「乱闘！」。
    const brawling = m.phase === 'result' && m.brawl?.brawling(m.phaseTime) ? { text: '乱闘！', kind: 'out' as const } : null;
    const msg = brawling ?? ((m.phase === 'result' || m.phase === 'change') && m.message ? m.message : m.phase === 'replay' ? null : (live ?? notice));
    // プレー中の文言は、結果の記録（log と投球数）が増える前に出るので、出し直しで同じ文言なら出しなおさないよう数をそろえる。
    const ahead = live ? 1 : 0;
    const key = msg ? `${msg.text}|${s.log.length + ahead}|${s.teams[1].pitchCount + s.teams[0].pitchCount + ahead}` : '';
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
      g.push(`J 進塁`, `K 帰塁`, `L 走者切替（いま：${esc(sel)}）`, `走塁：${m.running === 'auto' ? 'オート' : '手動'}`);
    } else if (m.humanPitching && m.phase === 'pre-pitch') {
      g.push('WASD コース', 'Q/E プレートの位置', 'L 球種', 'J 投球');
    } else if (m.humanBatting && (m.phase === 'pre-pitch' || m.phase === 'windup' || m.phase === 'pitch')) {
      if (m.easyBatting) g.push('J スイング（タイミングだけ）', 'W＋J フライ', 'S＋J ゴロ', 'L ミート/強振', 'K バント');
      else g.push('WASD カーソル', 'J スイング', 'L ミート/強振', 'K バント');
      if (m.phase !== 'pitch') g.push('Q/E 立ち位置（緑の帯がバットの芯）');
      if (m.stealers.length) g.push(m.phase === 'pre-pitch' ? '盗塁のサイン中（R で取り消し）' : '盗塁！');
      else if (m.phase !== 'pitch' && m.stealCandidates().length) g.push('R 盗塁');
    }
    if ((m.phase === 'result' && (m.trot || m.brawl)) || SCENES.includes(m.phase)) g.push('J スキップ');
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
