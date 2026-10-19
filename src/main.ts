// 画面の切り替え（メインメニュー → 試合 → 結果）と、毎フレームの更新。
import './style.css';
import * as THREE from 'three';
import raw from './data/teams.json' with { type: 'json' };
import { DIFFICULTY_LABEL, STRATEGY_LABEL, type Strategy } from './core/ai.ts';
import { score, type MatchMode } from './core/gameState.ts';
import { Match, type FieldingControl } from './core/match.ts';
import { parseTeams } from './core/teams.ts';
import { InputMap, type InputFrame } from './input/actions.ts';
import { MatchView } from './render/view.ts';
import { HELP_HTML } from './ui/help.ts';
import { Hud, MODE_LABEL } from './ui/hud.ts';
import { MenuList, type MenuItem } from './ui/menuList.ts';
import { loadSettings, saveSettings, type Settings } from './ui/settings.ts';

const teams = parseTeams(raw);
const MODES: MatchMode[] = ['manual', 'manager', 'auto'];
const SPEEDS = [1, 2, 4];
const FIELDING_OPTIONS = [
  { value: 'manual', label: '手動' },
  { value: 'auto', label: 'オート' }
];
const cycle = <T,>(list: readonly T[], v: T) => list[(list.indexOf(v) + 1) % list.length];

type Screen = 'menu' | 'match' | 'result';

class App {
  screen: Screen = 'menu';
  match: Match | null = null;
  paused = false;
  helpOpen = false;
  speed = 1;
  settings: Settings = loadSettings();

  private readonly renderer: THREE.WebGLRenderer;
  readonly view = new MatchView();
  private readonly input = new InputMap(window);
  private readonly hud = new Hud();
  private readonly ui = document.getElementById('ui')!;
  private readonly menuEl = document.createElement('div');
  private readonly pauseEl = document.createElement('div');
  private readonly resultEl = document.createElement('div');
  private readonly helpEl = document.createElement('div');
  private readonly menu: MenuList;
  private readonly pauseMenu: MenuList;
  private resultMenu: MenuList | null = null;
  private overTime = 0;
  private last = performance.now();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));

    const teamOptions = teams.map((t) => ({ value: t.id, label: t.nameJa }));
    const mainItems: MenuItem[] = [
      { kind: 'choice', label: 'あなたのチーム', options: teamOptions, get: () => this.settings.team, set: (v) => this.set({ team: v }) },
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
        label: 'CPU の強さ',
        options: (['easy', 'normal', 'hard'] as const).map((d) => ({ value: d, label: DIFFICULTY_LABEL[d] })),
        get: () => this.settings.difficulty,
        set: (v) => this.set({ difficulty: v as Settings['difficulty'] })
      },
      { kind: 'button', label: 'プレイボール！', primary: true, action: () => this.start() },
      { kind: 'button', label: '操作説明', action: () => this.showHelp(true) }
    ];
    this.menu = new MenuList(mainItems);
    this.menuEl.className = 'screen title-screen';
    this.menuEl.innerHTML = `<div class="title-card"><div class="logo">Baseball<br><span>Simulation</span></div><div class="sub">3イニング勝負 ／ Sky Park Stadium</div></div>`;
    this.menuEl.querySelector('.title-card')!.append(this.menu.el);

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
      { kind: 'button', label: '操作説明', action: () => this.showHelp(true) },
      { kind: 'button', label: 'メインメニューへ', action: () => this.toMenu() }
    ]);
    this.pauseEl.className = 'screen pause-screen';
    this.pauseEl.innerHTML = '<div class="panel pause-card"><h2>ポーズ</h2><p class="note">モードの切り替えは次の投球から、守備の切り替えは次の打球から反映されます。</p></div>';
    this.pauseEl.querySelector('.pause-card')!.append(this.pauseMenu.el);

    this.resultEl.className = 'screen result-screen';
    this.helpEl.className = 'screen help-screen';
    this.helpEl.innerHTML = `<div class="panel help-card">${HELP_HTML}<button class="close">とじる（Esc）</button></div>`;
    this.helpEl.querySelector('.close')!.addEventListener('click', () => this.showHelp(false));

    this.ui.append(this.hud.el, this.menuEl, this.pauseEl, this.resultEl, this.helpEl);
    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.showHelp(false);
    this.showScreen('menu');
    requestAnimationFrame((t) => this.loop(t));
  }

  private set(p: Partial<Settings>) {
    this.settings = { ...this.settings, ...p };
    saveSettings(this.settings);
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
    if (s === 'menu') this.menu.render();
  }

  private showHelp(open: boolean) {
    this.helpOpen = open;
    this.helpEl.style.display = open ? '' : 'none';
  }

  private setPaused(p: boolean) {
    this.paused = p;
    this.pauseEl.style.display = p ? '' : 'none';
    if (p) this.pauseMenu.render();
  }

  /** メニューの設定で試合を始める。 */
  start(overrides: Partial<Settings> & { seed?: number } = {}) {
    const st = { ...this.settings, ...overrides };
    const mine = teams.find((t) => t.id === st.team) ?? teams[0];
    const other = teams.find((t) => t !== mine)!;
    const humanTeam = st.side === 'home' ? 1 : 0;
    const [away, home] = humanTeam === 1 ? [other, mine] : [mine, other];
    this.match = new Match({ away, home, mode: st.mode, fielding: st.fielding, humanTeam, difficulty: st.difficulty, seed: overrides.seed });
    this.view.attach(this.match);
    this.speed = 1;
    this.overTime = 0;
    this.setPaused(false);
    this.showHelp(false);
    this.showScreen('match');
  }

  private skip() {
    this.setPaused(false);
    this.match?.skipToEnd();
  }

  private toMenu() {
    this.setPaused(false);
    this.match = null;
    this.showScreen('menu');
  }

  private showResult() {
    const m = this.match!;
    const s = m.state;
    const a = score(s, 0);
    const h = score(s, 1);
    const winner = s.winner === null ? null : s.teams[s.winner].team;
    const you = s.teams[m.humanTeam].team;
    const headline = winner === null ? '引き分け' : `${winner.nameJa}の勝ち！`;
    const sub = winner === null ? '3回終了で同点（MVP では延長なし）' : winner === you ? 'あなたの勝ちです！' : 'あなたの負けです…';
    const reason = s.endReason === 'walkoff' ? '（サヨナラ）' : s.endReason === 'skip-bottom' ? '（3回裏は行いません）' : '';
    const lines = this.hudLines();
    this.resultEl.innerHTML = `<div class="panel result-card"><div class="result-head">試合終了${reason}</div><div class="result-title">${headline}</div><div class="result-sub">${sub}</div>
      <div class="result-score"><span style="--team:${s.teams[0].team.colors.primary}">${s.teams[0].team.nameJa}</span><b>${a} - ${h}</b><span style="--team:${s.teams[1].team.colors.primary}">${s.teams[1].team.nameJa}</span></div>
      ${lines}<div class="result-log">${s.log
        .filter((e) => e.runs > 0)
        .map((e) => `<div>${e.inning}回${e.half === 'top' ? '表' : '裏'}　${e.text.replace(/　.*/, '')}（${e.runs}点）</div>`)
        .join('')}</div></div>`;
    this.resultMenu = new MenuList([
      { kind: 'button', label: 'もう一度', primary: true, action: () => this.start() },
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

  private loop(now: number) {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const f = this.input.frame();
    const w = window.innerWidth;
    const h = window.innerHeight;

    if (this.helpOpen) {
      if (f.pressed.pause || f.pressed.secondary || f.pressed.primary) this.showHelp(false);
    } else if (this.screen === 'menu') {
      this.menu.handle(f, dt);
    } else if (this.screen === 'result') {
      this.resultMenu?.handle(f, dt);
    } else if (this.match) {
      if (f.pressed.pause) this.setPaused(!this.paused);
      else if (this.paused) this.pauseMenu.handle(f, dt);
      else {
        this.handleMatchKeys(f);
        const scale = this.match.mode === 'auto' ? this.speed : 1;
        // 早送りでも 1 回の更新は小さく刻む。
        for (let i = 0; i < scale; i++) this.match.tick(dt, { move: f.move, primary: f.pressed.primary && i === 0, secondary: f.pressed.secondary && i === 0, switch: f.pressed.switch && i === 0 });
        if (this.match.phase === 'over') {
          this.overTime += dt;
          if (this.overTime > 1.6) this.showResult();
        }
      }
    }

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
