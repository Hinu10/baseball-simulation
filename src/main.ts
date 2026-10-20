// 画面の切り替え（メインメニュー → 試合 → 結果）と、毎フレームの更新。
import './style.css';
import * as THREE from 'three';
import raw from './data/teams.json' with { type: 'json' };
import { Sound } from './audio/sound.ts';
import { DIFFICULTY_LABEL, STRATEGY_LABEL, type Strategy } from './core/ai.ts';
import { battingTeam, EXTRA_INNINGS, INNINGS_OPTIONS, score, type Innings, type MatchMode, type TeamIndex } from './core/gameState.ts';
import { conditionedTeam, initialConditions } from './core/condition.ts';
import { managedTeam } from './core/manager.ts';
import { registeredTeam } from './core/registration.ts';
import { parkOf } from './core/field.ts';
import { addGame, advanceDay, emptyPennant, emptyRecord, gamesPlayed, pairOthers, seasonOver, standings, type GameResult, type Pennant } from './core/pennant.ts';
import { Match, type BattingControl, type FieldingControl, type Phase } from './core/match.ts';
import type { PlaySim } from './core/play.ts';
import { parseTeams, roleOf, rotationStarter, teamStyle, type TeamData } from './core/teams.ts';
import { InputMap, type InputFrame } from './input/actions.ts';
import { MatchView } from './render/view.ts';
import { HELP_HTML } from './ui/help.ts';
import { Hud, MODE_LABEL } from './ui/hud.ts';
import { MenuList, type MenuItem, type MenuOption } from './ui/menuList.ts';
import { RANK_NOTE, rosterHtml } from './ui/roster.ts';
import { PENNANT_TABS, pennantHtml, pennantProgress, pennantSummaryHtml, rankOf } from './ui/pennant.ts';
import { loadPennant, savePennant } from './ui/season.ts';
import { loadSettings, saveSettings, type Settings } from './ui/settings.ts';
import { SubstitutionPanel } from './ui/substitution.ts';

const teams = parseTeams(raw);

/** 調子がまだなければ（開幕前・以前の保存データ）、開幕時の調子を決める。 */
const withConditions = (p: Pennant): Pennant => (Object.keys(p.condition).length ? p : { ...p, condition: initialConditions(teams) });
const MODES: MatchMode[] = ['manual', 'manager', 'auto'];
const SPEEDS = [1, 2, 4];
const FIELDING_OPTIONS = [
  { value: 'manual', label: '手動' },
  { value: 'auto', label: 'オート' }
];
const BATTING_OPTIONS = [
  { value: 'standard', label: '標準' },
  { value: 'easy', label: 'かんたん' }
];
const cycle = <T,>(list: readonly T[], v: T) => list[(list.indexOf(v) + 1) % list.length];

type Screen = 'menu' | 'match' | 'result';

class App {
  screen: Screen = 'menu';
  match: Match | null = null;
  paused = false;
  helpOpen = false;
  rosterOpen = false;
  pennantOpen = false;
  /** ペナントの画面で表示しているタブ（PENNANT_TABS の添字）。 */
  pennantTab = 0;
  /** 「新しいシーズン」を一度押した（もう一度押すとリセット）。 */
  private resetArmed = false;
  /** メニューで選んだ、あなたのチームの先発（チームを変えたら無効）。試合が終わったら選び直し。 */
  private starterPick: { team: string; id: string } | null = null;
  subsOpen = false;
  /** 選手・打順の画面で表示しているチーム（rosterTeams() の添字）。 */
  rosterIndex = 0;
  private rosterMoveX = 0;
  speed = 1;
  settings: Settings = loadSettings();

  private readonly renderer: THREE.WebGLRenderer;
  readonly view = new MatchView();
  private readonly input = new InputMap(window);
  private readonly sound = new Sound();
  private heardPlay: PlaySim | null = null;
  private heardEvents = 0;
  /** いまのプレーで攻撃しているチーム（そのファンが沸く）。 */
  private heardTeam: TeamIndex = 0;
  /** ペナントレースの経過。試合が終わるたびに、他球場の試合も行って足して保存する。 */
  private pennant = withConditions(loadPennant());
  private readonly hud = new Hud();
  private readonly ui = document.getElementById('ui')!;
  private readonly menuEl = document.createElement('div');
  private readonly pauseEl = document.createElement('div');
  private readonly resultEl = document.createElement('div');
  private readonly helpEl = document.createElement('div');
  private readonly rosterEl = document.createElement('div');
  private readonly pennantEl = document.createElement('div');
  private readonly progressEl = document.createElement('div');
  private readonly subs = new SubstitutionPanel();
  private readonly menu: MenuList;
  private readonly pauseMenu: MenuList;
  private resultMenu: MenuList | null = null;
  private overTime = 0;
  private last = performance.now();

  constructor(canvas: HTMLCanvasElement) {
    this.sound.enabled = this.settings.sound;
    window.addEventListener('pointerdown', () => this.sound.unlock());
    window.addEventListener('keydown', () => this.sound.unlock());
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));

    const teamOptions = teams.map((t) => ({ value: t.id, label: t.nameJa }));
    const owner = this;
    const mainItems: MenuItem[] = [
      { kind: 'choice', label: 'あなたのチーム', options: teamOptions, get: () => this.settings.team, set: (v) => this.set({ team: v }) },
      {
        kind: 'choice',
        label: '相手',
        options: teamOptions,
        get: () => this.opponent().id,
        set: (v) => {
          // 自分のチームは選べないので、送った向きにもう1つ進める。
          if (v === this.settings.team) {
            const n = teams.length;
            const from = teams.indexOf(this.opponent());
            const at = teams.findIndex((t) => t.id === v);
            v = teams[(at + ((at - from + n) % n === 1 ? 1 : -1) + n) % n].id;
          }
          this.set({ opponent: v });
        }
      },
      {
        kind: 'choice',
        label: '先攻・後攻',
        options: [
          { value: 'away', label: '先攻' },
          { value: 'home', label: '後攻' }
        ],
        get: () => this.settings.side,
        set: (v) => this.set({ side: v as Settings['side'] })
      },
      {
        kind: 'choice',
        label: '先発投手',
        // あなたのチームの先発候補。既定はローテーションの順番の投手で、試合ごとに選び直せる。
        get options() {
          return owner.starterOptions();
        },
        get: () => this.myStarter(),
        set: (v) => (this.starterPick = { team: this.settings.team, id: v })
      },
      { kind: 'choice', label: 'モード', options: MODES.map((m) => ({ value: m, label: MODE_LABEL[m] })), get: () => this.settings.mode, set: (v) => this.set({ mode: v as MatchMode }) },
      {
        kind: 'choice',
        label: '守備',
        options: FIELDING_OPTIONS,
        get: () => this.settings.fielding,
        set: (v) => this.set({ fielding: v as FieldingControl }),
        hidden: () => this.settings.mode !== 'manual'
      },
      {
        kind: 'choice',
        label: '打撃',
        options: BATTING_OPTIONS,
        get: () => this.settings.batting,
        set: (v) => this.set({ batting: v as BattingControl }),
        hidden: () => this.settings.mode !== 'manual'
      },
      {
        kind: 'choice',
        label: 'CPU の強さ',
        options: (['easy', 'normal', 'hard'] as const).map((d) => ({ value: d, label: DIFFICULTY_LABEL[d] })),
        get: () => this.settings.difficulty,
        set: (v) => this.set({ difficulty: v as Settings['difficulty'] })
      },
      {
        kind: 'choice',
        label: 'イニング',
        options: INNINGS_OPTIONS.map((n) => ({ value: String(n), label: `${n}回（延長${EXTRA_INNINGS[n]}回まで）` })),
        get: () => String(this.settings.innings),
        set: (v) => this.set({ innings: Number(v) as Innings })
      },
      { kind: 'choice', label: '効果音', options: [{ value: 'on', label: 'オン' }, { value: 'off', label: 'オフ' }], get: () => this.settings.sound ? 'on' : 'off', set: (v) => this.setSound(v === 'on') },
      { kind: 'button', label: 'プレイボール！', primary: true, action: () => this.start() },
      { kind: 'button', label: 'ペナント（順位・タイトル）', action: () => this.showPennant(true) },
      { kind: 'button', label: '選手・打順', action: () => this.showRoster(true) },
      { kind: 'button', label: '操作説明', action: () => this.showHelp(true) }
    ];
    this.menu = new MenuList(mainItems);
    this.menuEl.className = 'screen title-screen';
    this.menuEl.innerHTML = `<div class="title-card"><div class="logo">Baseball<br><span>Simulation</span></div><div class="sub">3・7・9回の CPU 戦 ／ Sky Park Stadium</div></div>`;
    this.progressEl.className = 'pennant-progress';
    this.menuEl.querySelector('.title-card')!.append(this.progressEl, this.menu.el);

    const strategyItem = (key: keyof Strategy, label: string): MenuItem => ({
      kind: 'choice',
      label,
      options: Object.entries(STRATEGY_LABEL[key]).map(([value, l]) => ({ value, label: l })),
      get: () => this.match?.strategy[key] ?? 'normal',
      set: (v) => this.match?.setStrategy({ [key]: v } as Partial<Strategy>)
    });
    const isAuto = () => this.match?.nextMode !== 'auto';
    this.pauseMenu = new MenuList([
      { kind: 'button', label: '試合にもどる', primary: true, action: () => this.setPaused(false) },
      { kind: 'choice', label: 'モード', options: MODES.map((m) => ({ value: m, label: MODE_LABEL[m] })), get: () => this.match?.nextMode ?? 'manual', set: (v) => this.match?.requestMode(v as MatchMode) },
      {
        kind: 'choice',
        label: '守備',
        options: FIELDING_OPTIONS,
        get: () => this.match?.fielding ?? 'manual',
        set: (v) => {
          if (this.match) this.match.fielding = v as FieldingControl;
          this.set({ fielding: v as FieldingControl });
        },
        hidden: () => this.match?.nextMode !== 'manual'
      },
      {
        kind: 'choice',
        label: '打撃',
        options: BATTING_OPTIONS,
        get: () => this.match?.batting ?? 'easy',
        set: (v) => {
          if (this.match) this.match.batting = v as BattingControl;
          this.set({ batting: v as BattingControl });
        },
        hidden: () => this.match?.nextMode !== 'manual'
      },
      { kind: 'choice', label: '効果音', options: [{ value: 'on', label: 'オン' }, { value: 'off', label: 'オフ' }], get: () => this.settings.sound ? 'on' : 'off', set: (v) => this.setSound(v === 'on') },
      strategyItem('offense', '攻撃方針'),
      strategyItem('pitching', '投球方針'),
      strategyItem('running', '走塁方針'),
      {
        kind: 'choice',
        label: '早送り',
        options: SPEEDS.map((s) => ({ value: String(s), label: `×${s}` })),
        get: () => String(this.speed),
        set: (v) => (this.speed = Number(v)),
        hidden: isAuto
      },
      { kind: 'button', label: '試合終了までスキップ', action: () => this.skip(), hidden: isAuto },
      { kind: 'button', label: '選手交代', action: () => this.substitution() },
      { kind: 'button', label: '選手・打順', action: () => this.showRoster(true) },
      { kind: 'button', label: '操作説明', action: () => this.showHelp(true) },
      { kind: 'button', label: 'メインメニューへ', action: () => this.toMenu() }
    ]);
    this.pauseEl.className = 'screen pause-screen';
    this.pauseEl.innerHTML = '<div class="panel pause-card"><h2>ポーズ</h2><p class="note">モードの切り替えは次の投球から、守備の切り替えは次の打球から反映されます。投球中・プレー中に選手交代を選ぶと、次の投球前に交代画面が開きます。</p></div>';
    this.pauseEl.querySelector('.pause-card')!.append(this.pauseMenu.el);

    this.resultEl.className = 'screen result-screen';
    this.helpEl.className = 'screen help-screen';
    this.helpEl.innerHTML = `<div class="panel help-card">${HELP_HTML}<button class="close">とじる（Esc）</button></div>`;
    this.helpEl.querySelector('.close')!.addEventListener('click', () => this.showHelp(false));

    this.rosterEl.className = 'screen help-screen roster-screen';
    this.pennantEl.className = 'screen help-screen roster-screen';

    this.subs.onClose = () => this.showSubs(false);

    this.ui.append(this.hud.el, this.menuEl, this.pauseEl, this.resultEl, this.helpEl, this.rosterEl, this.pennantEl, this.subs.el);
    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.showHelp(false);
    this.showRoster(false);
    this.showPennant(false);
    this.showSubs(false);
    this.showScreen('menu');
    requestAnimationFrame((t) => this.loop(t));
  }

  private set(p: Partial<Settings>) {
    this.settings = { ...this.settings, ...p };
    saveSettings(this.settings);
    if (('team' in p || 'opponent' in p || 'side' in p) && !this.match) this.dressCrowd();
  }

  /** 設定のチームと先攻・後攻から [先攻, 後攻]。 */
  private matchup(st: Settings): [TeamData, TeamData] {
    const mine = teams.find((t) => t.id === st.team) ?? teams[0];
    const other = teams.find((t) => t.id === st.opponent && t !== mine) ?? teams.find((t) => t !== mine)!;
    return st.side === 'home' ? [other, mine] : [mine, other];
  }

  private opponent(): TeamData {
    const [away, home] = this.matchup(this.settings);
    return this.settings.side === 'home' ? away : home;
  }

  /** メニューの背景を、次の試合の球場（ホームの本拠地）と2チームのファンにする。 */
  private dressCrowd() {
    const [away, home] = this.matchup(this.settings);
    this.view.setPark(parkOf(home.id), [away.colors, home.colors]);
  }

  private setSound(enabled: boolean) {
    this.sound.enabled = enabled;
    this.set({ sound: enabled });
    if (enabled) this.sound.unlock();
  }

  private resize() {
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.view.resize(window.innerWidth, window.innerHeight);
  }

  private showScreen(s: Screen) {
    this.screen = s;
    this.menuEl.style.display = s === 'menu' ? '' : 'none';
    this.resultEl.style.display = s === 'result' ? '' : 'none';
    this.hud.el.style.display = s === 'match' ? '' : 'none';
    this.pauseEl.style.display = 'none';
    if (s === 'menu') {
      this.renderProgress();
      this.menu.render();
      this.dressCrowd();
    }
  }

  private showHelp(open: boolean) {
    this.helpOpen = open;
    this.helpEl.style.display = open ? '' : 'none';
  }

  /** 選手の今日の調子を反映した球団。先発はローテーションで回し、あなたのチームはメニューで選んだ投手にする。 */
  private today(t: TeamData): TeamData {
    const starter = t.id === this.settings.team ? this.myStarter() : this.rotation(t);
    const team = { ...conditionedTeam(this.registered(t), this.pennant.condition), startingPitcher: starter };
    // あなたのチーム以外は、CPU の監督がひどく調子を落とした選手を2軍に落とし、打順を少し組み替える。
    return t.id === this.settings.team ? team : managedTeam(team).team;
  }

  /** 出場選手登録（公示）を反映した球団。1軍・2軍・育成が入れ替わっている。 */
  private registered(t: TeamData): TeamData {
    return registeredTeam(t, this.pennant.registrations[t.id]);
  }

  /** ローテーションで次に投げる先発（その球団のこれまでの試合数で決まる）。 */
  private rotation(t: TeamData): string {
    return rotationStarter(this.registered(t), gamesPlayed(this.pennant.teams[t.id] ?? emptyRecord()));
  }

  /** メニューで選んだ、あなたのチームの先発（選んでいなければローテーションの順番）。 */
  myStarter(): string {
    const mine = this.registered(teams.find((t) => t.id === this.settings.team) ?? teams[0]);
    const pick = this.starterPick;
    return pick && pick.team === mine.id && mine.pitchers.some((p) => p.id === pick.id) ? pick.id : this.rotation(mine);
  }

  /** 先発投手の選択肢：先発の投手（ローテーションの順番の投手に印）。 */
  starterOptions(): MenuOption[] {
    const mine = this.registered(teams.find((t) => t.id === this.settings.team) ?? teams[0]);
    const next = this.rotation(mine);
    return mine.pitchers
      .filter((p) => roleOf(p) === 'starter')
      .map((p) => ({ value: p.id, label: `${p.name.split(' ')[0]}${p.id === next ? '（順番）' : ''}` }));
  }

  /** 選手・打順の画面に出すチーム。試合中は先攻・後攻、試合前はあなたのチーム・相手・ほかの球団の順。 */
  private rosterTeams(): TeamData[] {
    if (this.match) return this.match.state.teams.map((t) => t.team);
    const mine = teams.find((t) => t.id === this.settings.team) ?? teams[0];
    const other = this.opponent();
    return [mine, other, ...teams.filter((t) => t !== mine && t !== other)].map((t) => this.today(t));
  }

  private showRoster(open: boolean) {
    this.rosterOpen = open;
    this.rosterEl.style.display = open ? '' : 'none';
    if (!open) return;
    // 試合中はあなたのチームから見せる。
    this.rosterIndex = this.match ? this.match.humanTeam : 0;
    this.renderRoster();
  }

  private renderRoster() {
    const list = this.rosterTeams();
    const team = list[this.rosterIndex];
    const m = this.match;
    const live = m ? { state: m.state, index: this.rosterIndex as 0 | 1 } : undefined;
    const you = m ? m.state.teams[m.humanTeam].team : list[0];
    const tabs = list
      .map((t, i) => `<button class="${i === this.rosterIndex ? 'selected' : ''}" data-i="${i}" style="${teamStyle(t.colors)}">${t.shortName}${t === you ? '<small>あなた</small>' : ''}</button>`)
      .join('');
    this.rosterEl.innerHTML = `<div class="panel help-card roster-card"><h2>選手・打順</h2><div class="roster-tabs">${tabs}</div>${rosterHtml(team, live, this.pennant)}<p class="note">${RANK_NOTE}　成績はペナントの通算（今日の試合は終わってから加わる）　A/D でチーム切り替え</p><button class="close">とじる（Esc）</button></div>`;
    this.rosterEl.querySelectorAll<HTMLButtonElement>('.roster-tabs button').forEach((b) =>
      b.addEventListener('click', () => {
        this.rosterIndex = Number(b.dataset.i);
        this.renderRoster();
      })
    );
    this.rosterEl.querySelector('.close')!.addEventListener('click', () => this.showRoster(false));
  }

  private handleRoster(f: InputFrame) {
    if (f.pressed.pause || f.pressed.secondary || f.pressed.primary) {
      this.showRoster(false);
      return;
    }
    const x = Math.abs(f.move.x) > 0.5 ? Math.sign(f.move.x) : 0;
    if (x && x !== this.rosterMoveX) {
      const n = this.rosterTeams().length;
      this.rosterIndex = (this.rosterIndex + x + n) % n;
      this.renderRoster();
    }
    this.rosterMoveX = x;
  }

  /** メニューに出す、ペナントの進み具合とあなたのチームの順位。 */
  private renderProgress() {
    const mine = teams.find((t) => t.id === this.settings.team) ?? teams[0];
    const rank = this.pennant.teams[mine.id] ? `　${mine.shortName} ${rankOf(this.pennant, teams, mine.id)}位` : '';
    this.progressEl.textContent = `ペナント ${pennantProgress(this.pennant, teams)}${rank}`;
  }

  private showPennant(open: boolean) {
    this.pennantOpen = open;
    this.pennantEl.style.display = open ? '' : 'none';
    this.resetArmed = false;
    if (open) this.renderPennant();
    else if (this.screen === 'menu') this.renderProgress();
  }

  private renderPennant() {
    const you = this.match ? this.match.state.teams[this.match.humanTeam].team.id : this.settings.team;
    const tabs = PENNANT_TABS.map((label, i) => `<button class="${i === this.pennantTab ? 'selected' : ''}" data-i="${i}">${label}</button>`).join('');
    const over = seasonOver(this.pennant, teams);
    const champion = over ? `<p class="pennant-champion">🏆 ${standings(this.pennant, teams)[0].team.nameJa} 優勝！</p>` : '';
    const reset = this.resetArmed ? 'もう一度押すとリセット' : '新しいシーズンを始める';
    this.pennantEl.innerHTML = `<div class="panel help-card roster-card pennant-card"><h2>ペナント<small>${pennantProgress(this.pennant, teams)}</small></h2>${champion}<div class="roster-tabs pennant-tabs">${tabs}</div>${pennantHtml(this.pennant, teams, this.pennantTab, you)}<p class="note">あなたの試合が終わるたびに、ほかの4球団も1試合ずつ行い、各球団はたまに出場選手登録を入れ替えます（公示）。勝率は引き分けを除いて計算し、失点はすべて自責点として扱います。　A/D でタブ切り替え</p><div class="pennant-buttons"><button class="reset${this.resetArmed ? ' armed' : ''}">${reset}</button><button class="close">とじる（Esc）</button></div></div>`;
    this.pennantEl.querySelectorAll<HTMLButtonElement>('.pennant-tabs button').forEach((b) =>
      b.addEventListener('click', () => {
        this.pennantTab = Number(b.dataset.i);
        this.renderPennant();
      })
    );
    this.pennantEl.querySelector('.reset')!.addEventListener('click', () => this.resetPennant());
    this.pennantEl.querySelector('.close')!.addEventListener('click', () => this.showPennant(false));
  }

  private resetPennant() {
    if (!this.resetArmed) {
      this.resetArmed = true;
      this.renderPennant();
      return;
    }
    this.pennant = withConditions(emptyPennant());
    savePennant(this.pennant);
    this.hud.season = this.pennant.batting;
    this.hud.seasonPitching = this.pennant.pitching;
    this.resetArmed = false;
    this.renderPennant();
  }

  private handlePennant(f: InputFrame) {
    if (f.pressed.pause || f.pressed.secondary || f.pressed.primary) {
      this.showPennant(false);
      return;
    }
    const x = Math.abs(f.move.x) > 0.5 ? Math.sign(f.move.x) : 0;
    if (x && x !== this.rosterMoveX) {
      const n = PENNANT_TABS.length;
      this.pennantTab = (this.pennantTab + x + n) % n;
      this.renderPennant();
    }
    this.rosterMoveX = x;
  }

  /**
   * 終わった試合をペナントに足し、同じ節の他球場の試合も自動で行う。
   * シーズンが終わっていれば数えない。数えたら true。
   */
  private recordPennant(): boolean {
    const m = this.match!;
    const s = m.state;
    if (seasonOver(this.pennant, teams)) return false;
    const result = (g: typeof s): GameResult => ({ away: g.teams[0].team.id, home: g.teams[1].team.id, awayRuns: score(g, 0), homeRuns: score(g, 1) });
    let p = addGame(this.pennant, s);
    const round = [result(s)];
    const games = [s];
    for (const [away, home] of pairOthers(this.pennant, teams, [round[0].away, round[0].home])) {
      const other = new Match({ away: this.today(away), home: this.today(home), innings: s.innings, mode: 'auto', difficulty: 'normal' });
      other.skipToEnd();
      p = addGame(p, other.state);
      round.push(result(other.state));
      games.push(other.state);
    }
    // 1日が終わったら、その日の出来も踏まえて全選手の調子が変わり、たまに出場選手登録が入れ替わる（公示）。
    this.pennant = advanceDay({ ...p, lastRound: round }, teams, games);
    savePennant(this.pennant);
    return true;
  }

  private showSubs(open: boolean) {
    this.subsOpen = open;
    this.subs.el.style.display = open ? '' : 'none';
    if (open && this.match) this.subs.open(this.match);
  }

  /** ポーズの「選手交代」。投球前ならすぐ開き、そうでなければタイムをかけて試合にもどる。 */
  private substitution() {
    const m = this.match;
    if (!m || m.phase === 'over') return;
    if (m.canSubstitute) {
      this.showSubs(true);
      return;
    }
    m.requestTimeout();
    this.setPaused(false);
  }

  private setPaused(p: boolean) {
    this.paused = p;
    this.pauseEl.style.display = p ? '' : 'none';
    if (p) this.pauseMenu.render();
  }

  /** メニューの設定で試合を始める。 */
  start(overrides: Partial<Settings> & { seed?: number } = {}) {
    const st = { ...this.settings, ...overrides };
    const humanTeam = st.side === 'home' ? 1 : 0;
    const [away, home] = this.matchup(st).map((t) => this.today(t));
    this.match = new Match({ away, home, innings: st.innings, mode: st.mode, fielding: st.fielding, batting: st.batting, humanTeam, difficulty: st.difficulty, seed: overrides.seed });
    this.heardPlay = null;
    this.heardEvents = 0;
    this.hud.season = this.pennant.batting;
    this.hud.seasonPitching = this.pennant.pitching;
    this.view.attach(this.match);
    this.speed = 1;
    this.overTime = 0;
    this.setPaused(false);
    this.showHelp(false);
    this.showSubs(false);
    this.showScreen('match');
  }

  private skip() {
    this.setPaused(false);
    this.match?.skipToEnd();
  }

  private toMenu() {
    this.setPaused(false);
    this.showSubs(false);
    this.match = null;
    this.heardPlay = null;
    this.showScreen('menu');
  }

  private showResult() {
    // 先発は試合ごとに選ぶので、次の試合はローテーションの順番に戻す。
    this.starterPick = null;
    const m = this.match!;
    const s = m.state;
    // 最後まで終わった試合だけペナントに数える（途中でメニューに戻った試合は数えない）。
    const counted = this.recordPennant();
    const a = score(s, 0);
    const h = score(s, 1);
    const winner = s.winner === null ? null : s.teams[s.winner].team;
    const you = s.teams[m.humanTeam].team;
    const headline = winner === null ? '引き分け' : `${winner.nameJa}の勝ち！`;
    const extra = s.inning > s.innings ? `延長${s.inning}回` : `${s.inning}回`;
    const sub = winner === null ? `${extra}終了で同点` : winner === you ? 'あなたの勝ちです！' : 'あなたの負けです…';
    const reason = s.endReason === 'walkoff' ? `（${extra}サヨナラ）` : s.endReason === 'skip-bottom' ? `（${s.inning}回裏は行いません）` : s.inning > s.innings ? `（${extra}）` : '';
    const lines = this.hudLines();
    this.resultEl.innerHTML = `<div class="panel result-card"><div class="result-head">試合終了${reason}</div><div class="result-title">${headline}</div><div class="result-sub">${sub}</div>
      <div class="result-score"><span style="--team:${s.teams[0].team.colors.primary}">${s.teams[0].team.nameJa}</span><b>${a} - ${h}</b><span style="--team:${s.teams[1].team.colors.primary}">${s.teams[1].team.nameJa}</span></div>
      ${lines}${counted ? pennantSummaryHtml(this.pennant, teams, you) : '<div class="pennant-summary">シーズンは終了しています。ペナントの画面から新しいシーズンを始めると、また順位がつきます。</div>'}<div class="result-log">${s.log
        .filter((e) => e.runs > 0)
        .map((e) => `<div>${e.inning}回${e.half === 'top' ? '表' : '裏'}　${e.text.replace(/　.*/, '')}（${e.runs}点）</div>`)
        .join('')}</div></div>`;
    this.resultMenu = new MenuList([
      { kind: 'button', label: 'もう一度', primary: true, action: () => this.start() },
      { kind: 'button', label: 'ペナント（順位・タイトル）', action: () => this.showPennant(true) },
      { kind: 'button', label: 'メインメニューへ', action: () => this.toMenu() }
    ]);
    this.resultEl.querySelector('.result-card')!.append(this.resultMenu.el);
    this.showScreen('result');
  }

  private hudLines() {
    const table = this.hud.el.querySelector('table');
    return table ? `<table class="result-lines">${table.innerHTML}</table>` : '';
  }

  private handleMatchKeys(f: InputFrame) {
    const m = this.match!;
    if (f.pressed.mode) m.requestMode(cycle(MODES, m.nextMode));
    if (f.pressed.fast && m.mode === 'auto') this.speed = cycle(SPEEDS, this.speed);
    if (f.pressed.tactic1) m.setStrategy({ offense: cycle(['normal', 'aggressive', 'careful'] as const, m.strategy.offense) });
    if (f.pressed.tactic2) m.setStrategy({ pitching: cycle(['normal', 'strike', 'corner'] as const, m.strategy.pitching) });
    if (f.pressed.tactic3) m.setStrategy({ running: cycle(['normal', 'aggressive', 'careful'] as const, m.strategy.running) });
  }

  /** 観客が沸く（歓声と、観客席の動き）。 */
  private cheer(strength: number) {
    this.sound.cheer(strength);
    this.view.crowd.cheer(strength, this.heardTeam);
  }

  private hearTick(before: Phase) {
    const m = this.match!;
    const play = m.play;
    if (before === 'windup' && m.phase === 'pitch') this.sound.play('pitch');
    if (before === 'pitch' && m.phase === 'play' && play) {
      this.heardTeam = battingTeam(m.state);
      const speed = Math.hypot(play.ball.vel.x, play.ball.vel.y, play.ball.vel.z);
      this.sound.play(m.swing?.bunt ? 'bunt' : 'bat', speed / 34);
    }
    if (play !== this.heardPlay) {
      this.heardPlay = play;
      this.heardEvents = 0;
    }
    if (play) {
      for (const event of play.events.slice(this.heardEvents)) {
        switch (event.type) {
          case 'catch': this.sound.play('glove'); break;
          case 'drop':
          case 'error': this.sound.play('glove', 0.55); break;
          case 'bounce': this.sound.play('bounce'); break;
          case 'throw': this.sound.play('throw'); break;
          case 'fence': this.sound.play('fence'); break;
          case 'out': this.sound.play('out'); break;
          case 'safe': this.sound.play('safe'); break;
          case 'score': this.sound.play('score'); break;
          case 'homerun':
            this.sound.play('homerun');
            this.cheer(1.2);
            break;
        }
      }
      this.heardEvents = play.events.length;
    }
    if (before === 'pitch' && m.phase === 'result') this.sound.play(m.swingDone && m.lastSwingMissed ? 'miss' : 'call');
    // 本塁打はボールがスタンドに入ったときに沸くので、結果ではもう一度沸かせない。
    if (before === 'play' && m.phase === 'result' && !play?.events.some((e) => e.type === 'homerun')) {
      if (m.message?.kind === 'run') this.cheer(0.85);
      else if (m.message?.kind === 'hit') this.cheer(0.5);
    }
  }

  private loop(now: number) {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const f = this.input.frame();
    const w = window.innerWidth;
    const h = window.innerHeight;

    if (this.helpOpen) {
      if (f.pressed.pause || f.pressed.secondary || f.pressed.primary) this.showHelp(false);
    } else if (this.rosterOpen) {
      this.handleRoster(f);
    } else if (this.pennantOpen) {
      this.handlePennant(f);
    } else if (this.subsOpen) {
      this.subs.handle(f, dt);
    } else if (this.screen === 'menu') {
      this.menu.handle(f, dt);
    } else if (this.screen === 'result') {
      this.resultMenu?.handle(f, dt);
    } else if (this.match) {
      // タイムの要求があれば、投球前になったところで交代画面を開く。
      if (this.match.timeoutRequested && this.match.canSubstitute && !this.paused) {
        this.match.timeoutRequested = false;
        this.showSubs(true);
      } else if (f.pressed.pause) this.setPaused(!this.paused);
      else if (this.paused) this.pauseMenu.handle(f, dt);
      else {
        this.handleMatchKeys(f);
        const scale = this.match.mode === 'auto' ? this.speed : 1;
        // 早送りでも 1 回の更新は小さく刻む。
        for (let i = 0; i < scale; i++) {
          const before = this.match.phase;
          this.match.tick(dt, { move: f.move, shift: f.shift, primary: f.pressed.primary && i === 0, secondary: f.pressed.secondary && i === 0, switch: f.pressed.switch && i === 0, steal: f.pressed.steal && i === 0 });
          this.hearTick(before);
        }
        if (this.match.phase === 'over') {
          this.overTime += dt;
          if (this.overTime > 1.6) this.showResult();
        }
      }
    }

    // 歓声は試合を見ている間だけ。ポーズ・交代・説明の画面、結果、メニューでは絞る。
    this.sound.setCrowd(this.screen === 'match' && !!this.match && !this.paused && !this.helpOpen && !this.rosterOpen && !this.pennantOpen && !this.subsOpen);
    if (this.match) {
      this.view.update(this.paused ? 0 : dt);
      if (this.screen === 'match') this.hud.update(this.match, this.view, w, h, this.speed);
    } else {
      this.view.idle(dt);
    }
    this.renderer.render(this.view.scene, this.view.camera);
    requestAnimationFrame((t) => this.loop(t));
  }
}

const app = new App(document.getElementById('view') as HTMLCanvasElement);
// スモークテスト・デバッグ用。
(window as unknown as { __bb: unknown }).__bb = {
  app,
  get match() {
    return app.match;
  },
  get camera() {
    return app.view.rig.mode;
  }
};
