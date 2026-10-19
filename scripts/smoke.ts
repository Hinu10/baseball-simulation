// ブラウザのスモークテスト。Vite を起動し、実際のページをキーボードで操作して、
// メニュー → 手動の投球 → 守備 → 手動の打撃 → 監督モード → 自動モード（早送り・スキップ）→ 結果 → メニュー を通す。
//
//   npm run smoke                 （インストール済みの Google Chrome を使う）
//   SMOKE_DIST=1 npm run smoke    （npm run build の結果を vite preview で確かめる）
//   SMOKE_HEADED=1 npm run smoke  （画面を表示して実行）
import { chromium, type Page } from 'playwright-core';
import { createServer, preview } from 'vite';

const useDist = !!process.env.SMOKE_DIST;
const server = useDist
  ? await preview({ logLevel: 'error', preview: { port: 0 } })
  : await createServer({ logLevel: 'error', cacheDir: 'node_modules/.vite-smoke', server: { port: 0, hmr: false, ws: false, watch: null } });
if ('listen' in server) await server.listen();
const base = server.resolvedUrls?.local[0];
if (!base) throw new Error('Vite が URL を返しませんでした。');

const browser = await chromium.launch({ channel: 'chrome', headless: !process.env.SMOKE_HEADED, args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('WebSocket') && !m.text().includes('[vite]') && !m.text().startsWith('Failed to load resource')) errors.push(m.text());
});
page.on('response', (r) => {
  if (r.status() >= 400 && !r.url().endsWith('/favicon.ico')) errors.push(`${r.status()} ${r.url()}`);
});

const failures: string[] = [];
const check = (ok: boolean, label: string) => {
  console.log(`${ok ? '✔' : '✖'} ${label}`);
  if (!ok) failures.push(label);
};

type Snap = {
  phase: string;
  mode: string;
  pendingMode: string | null;
  inning: number;
  half: string;
  outs: number;
  balls: number;
  strikes: number;
  humanPitching: boolean;
  humanBatting: boolean;
  pitchType: string;
  aim: { x: number; y: number };
  pitchTime: number;
  flightTime: number;
  swing: boolean;
  lastSwingMissed: boolean;
  playDone: boolean;
  controlled: number;
  over: boolean;
  pitches: number;
  logLength: number;
  strategy: { offense: string; pitching: string; running: string };
  camera: string;
};

const snap = (p: Page) =>
  p.evaluate((): Snap | null => {
    const bb = (window as any).__bb;
    const m = bb.match;
    if (!m) return null;
    const s = m.state;
    return {
      phase: m.phase,
      mode: s.mode,
      pendingMode: m.pendingMode,
      inning: s.inning,
      half: s.half,
      outs: s.outs,
      balls: s.balls,
      strikes: s.strikes,
      humanPitching: m.humanPitching,
      humanBatting: m.humanBatting,
      pitchType: m.pitchType,
      aim: { ...m.aim },
      pitchTime: m.pitchTime,
      flightTime: m.pitch?.flightTime ?? 0,
      swing: !!m.swing,
      lastSwingMissed: m.lastSwingMissed,
      playDone: !!m.play?.done,
      controlled: m.play?.controlled ?? -1,
      over: s.over,
      pitches: s.teams[0].pitchCount + s.teams[1].pitchCount,
      logLength: s.log.length,
      strategy: { ...m.strategy },
      camera: bb.camera
    };
  });

async function waitFor(p: Page, cond: (s: Snap) => boolean, timeout = 20000): Promise<Snap | null> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const s = await snap(p);
    if (s && cond(s)) return s;
    await p.waitForTimeout(20);
  }
  return null;
}

const visible = (sel: string) => page.evaluate((q) => {
  const e = document.querySelector<HTMLElement>(q);
  return !!e && e.style.display !== 'none' && e.offsetParent !== null;
}, sel);

async function startFromMenu(side: 'away' | 'home', mode: 'manual' | 'manager' | 'auto') {
  // メニュー：上から チーム・相手・先攻後攻・モード・（手動のときだけ）守備・打撃・強さ・イニング・効果音・プレイボール。値は A/D で変える。
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(800);
  for (let i = 0; i < 2; i++) {
    await page.keyboard.press('KeyS');
    await page.waitForTimeout(250);
  }
  if (side === 'away') await page.keyboard.press('KeyA');
  await page.waitForTimeout(250);
  await page.keyboard.press('KeyS');
  await page.waitForTimeout(250);
  for (let i = 0; i < ['manual', 'manager', 'auto'].indexOf(mode); i++) {
    await page.keyboard.press('KeyD');
    await page.waitForTimeout(250);
  }
  for (let i = 0; i < (mode === 'manual' ? 6 : 4); i++) {
    await page.keyboard.press('KeyS');
    await page.waitForTimeout(250);
  }
  await page.keyboard.press('KeyJ');
  await page.waitForTimeout(300);
}

await page.goto(base);
await page.waitForTimeout(1200);
check(await visible('.title-screen'), 'メインメニューが表示される');

// ---- 選手・打順 ----
await page.click('.title-screen >> text=選手・打順');
await page.waitForTimeout(200);
const roster = await page.evaluate(() => ({ rows: document.querySelectorAll('.roster-screen .roster-table tr').length, text: document.querySelector('.roster-card')?.textContent ?? '' }));
check((await visible('.roster-screen')) && roster.rows > 9 && /ミート/.test(roster.text) && /球速/.test(roster.text), 'メニューから選手・打順を開ける（打順・能力・投手）');
const firstTeam = await page.evaluate(() => document.querySelector('.roster-tabs .selected')?.textContent);
await page.keyboard.press('KeyD');
await page.waitForTimeout(150);
check((await page.evaluate(() => document.querySelector('.roster-tabs .selected')?.textContent)) !== firstTeam, 'D で相手チームに切り替わる');
await page.keyboard.press('Escape');
await page.waitForTimeout(150);
check(!(await visible('.roster-screen')) && (await visible('.title-screen')), 'Esc で選手・打順を閉じる');

// ---- 手動・後攻：1回表は人が投げて守る ----
await startFromMenu('home', 'manual');
let s = await waitFor(page, (x) => x.phase === 'pre-pitch');
check(!!s && s.mode === 'manual' && s.humanPitching, 'メニューから手動モードの試合が始まり、人が投手になる');
check(await visible('.hud'), '試合の HUD が表示される');
const aim0 = s!.aim;
await page.keyboard.down('KeyD');
await page.waitForTimeout(300);
await page.keyboard.up('KeyD');
await page.keyboard.press('KeyL');
await page.waitForTimeout(150);
s = await snap(page);
check(!!s && s.aim.x > aim0.x + 0.1, 'D でコースカーソルが一塁側へ動く');
check(!!s && s.pitchType !== 'fastball', 'L で球種が変わる');
await page.keyboard.press('KeyJ');
s = await waitFor(page, (x) => x.phase === 'pitch');
check(!!s, 'J で投球する');
check(!!s && s.camera === 'A', '投球中はカメラ A');

// 打球が飛ぶまで投げ続ける（守備は操作しない：3秒で CPU が代わる）。
let sawPlay = false;
let sawB = false;
let sawC = false;
let sawControl = false;
// ファウルはすぐ終わり C に切り替わらないので、B と C の両方が見えるまで投げる。
for (let i = 0; i < 60 && !(sawB && sawC); i++) {
  s = await waitFor(page, (x) => x.phase === 'pre-pitch' || x.phase === 'play', 15000);
  if (!s) break;
  if (s.phase === 'play') {
    sawPlay = true;
    sawControl ||= s.controlled >= 0;
    const end = Date.now() + 30000;
    while (Date.now() < end) {
      const x = await snap(page);
      if (!x || x.phase !== 'play') break;
      if (x.camera === 'B') sawB = true;
      if (x.camera === 'C') sawC = true;
      await page.waitForTimeout(30);
    }
    continue;
  }
  if (s.humanPitching) await page.keyboard.press('KeyJ');
  await page.waitForTimeout(150);
}
check(sawPlay, 'CPU の打者が打ち、インプレーになる');
check(sawControl, '守備では人が操作する選手が決まる（黄色い輪）');
check(sawB && sawC, '打球が出るとカメラが B → C に切り替わる');
s = await waitFor(page, (x) => x.phase === 'pre-pitch' || x.phase === 'over', 40000);
check(!!s, '守備を操作しなくてもプレーが終わり、次の投球に進む');
check(await page.evaluate(() => document.querySelector('.banner')?.textContent !== undefined), '結果の文字が表示される');

// ---- 手動・先攻：人が打つ ----
await startFromMenu('away', 'manual');
s = await waitFor(page, (x) => x.phase === 'pre-pitch');
check(!!s && s.humanBatting, '先攻を選ぶと人が打者になる');
let swings = 0;
let contacts = 0;
let looked = 0;
for (let i = 0; i < 40 && swings < 10; i++) {
  s = await waitFor(page, (x) => x.phase === 'pitch' || x.phase === 'over' || !x.humanBatting, 15000);
  if (s && s.phase !== 'over' && !s.humanBatting) {
    // 攻守交代したら、守備は自動で進めて次の攻撃でまた打つ。
    await page.evaluate(() => (window as any).__bb.match.requestMode('auto'));
    await waitFor(page, (x) => x.over || (x.phase === 'pre-pitch' && x.half === 'top'), 60000);
    await page.evaluate(() => (window as any).__bb.match.requestMode('manual'));
    continue;
  }
  if (!s || s.phase !== 'pitch') break;
  // カーソルを球の通過点へ合わせ（テスト用に直接置く）、ちょうどの時刻に J を押す。
  await page.evaluate(() => {
    const m = (window as any).__bb.match;
    m.batCursor = { ...m.pitch.plate };
  });
  const swung = i % 4 !== 3;
  if (!swung) {
    looked++;
  } else {
    await waitFor(page, (x) => x.phase !== 'pitch' || x.pitchTime >= x.flightTime - 0.17, 5000);
    await page.keyboard.press('KeyJ');
    swings++;
  }
  const after = await waitFor(page, (x) => x.phase !== 'pitch', 5000);
  // 当たればインプレー（ファウルもいったんインプレーになる）。
  if (swung && after && after.phase === 'play') contacts++;
  await waitFor(page, (x) => x.phase === 'pre-pitch' || x.phase === 'over', 40000);
}
console.log(`  （スイング ${swings} 回、当たり ${contacts} 回、見送り ${looked} 回）`);
check(swings >= 5 && contacts >= Math.ceil(swings / 2), 'タイミングよく J を押すとバットに当たる');
check(await page.evaluate(() => (window as any).__bb.match.batting === 'easy'), '打撃の既定は「かんたん」（タイミングだけで打つ）');

// ---- 監督モード ----
await startFromMenu('away', 'manager');
s = await waitFor(page, (x) => x.phase === 'pitch');
check(!!s && s.mode === 'manager' && !s.humanBatting, '監督モードでは選手を AI が操作する');
await page.keyboard.press('Digit1');
await page.waitForTimeout(100);
await page.keyboard.press('Digit3');
await page.waitForTimeout(150);
s = await snap(page);
check(!!s && s.strategy.offense === 'aggressive' && s.strategy.running === 'aggressive', '1・3 キーで攻撃方針・走塁方針が変わる');
await waitFor(page, (x) => x.logLength >= 2, 60000);
s = await snap(page);
check(!!s && s.logLength >= 2, '監督モードで試合が進む');

// ---- モード切替：Tab で次の投球から自動に ----
const before = await waitFor(page, (x) => x.phase === 'pitch');
await page.keyboard.press('Tab');
await page.waitForTimeout(100);
s = await snap(page);
check(!!s && s.mode === 'manager' && s.pendingMode === 'auto', 'Tab で切替を予約（投球中はまだ切り替わらない）');
s = await waitFor(page, (x) => x.phase === 'pre-pitch' || x.phase === 'windup');
check(!!s && s.mode === 'auto' && s.inning >= before!.inning, '次の投球前に自動モードへ切り替わり、試合状態は続く');
await page.keyboard.press('KeyF');
await page.waitForTimeout(100);
await page.keyboard.press('KeyF');
await page.waitForTimeout(150);
check(await page.evaluate(() => document.querySelector('.mode .ff')?.textContent === '×4'), 'F で早送り（×4）');

// ---- ポーズ → 試合終了までスキップ → 結果 ----
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
check(await visible('.pause-screen'), 'Esc でポーズメニューが開く');
await page.click('.pause-screen >> text=選手・打順');
await page.waitForTimeout(200);
check(await page.evaluate(() => /今日/.test(document.querySelector('.roster-card')?.textContent ?? '') && /登板中/.test(document.querySelector('.roster-card')?.textContent ?? '')), '試合中の選手・打順に今日の打席と登板中の投手が出る');
await page.keyboard.press('Escape');
await page.waitForTimeout(150);
const p1 = (await snap(page))!.pitches;
await page.waitForTimeout(500);
check((await snap(page))!.pitches === p1, 'ポーズ中は試合が止まる');

// ---- 選手交代（投球中ならタイムをかけ、次の投球前に交代画面が開く） ----
await page.click('.pause-screen button:text-is("選手交代")');
await page.waitForFunction(() => getComputedStyle(document.querySelector('.sub-screen')!).display !== 'none', null, { timeout: 15000 }).catch(() => {});
check(await visible('.sub-screen'), 'ポーズから選手交代の画面が開く');
const lineupId = () => page.evaluate(() => (window as any).__bb.match.state.teams[(window as any).__bb.match.humanTeam].lineup[0].id as string);
const before1 = await lineupId();
await page.keyboard.press('KeyJ');
await page.waitForTimeout(150);
await page.keyboard.press('KeyJ');
await page.waitForTimeout(200);
check((await lineupId()) !== before1 && /→/.test((await page.textContent('.sub-message')) ?? ''), 'J・J で1番打者を控えの野手と交代できる');
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
check(!(await visible('.sub-screen')), 'Esc で選手交代の画面を閉じる');
if (!(await visible('.pause-screen'))) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
}
await page.click('text=試合終了までスキップ');
s = await waitFor(page, (x) => x.over, 10000);
check(!!s, '試合終了まで一気に進む');
await page.waitForTimeout(2200);
check(await visible('.result-screen'), '試合結果画面が表示される');
const resultText = await page.evaluate(() => document.querySelector('.result-card')?.textContent ?? '');
check(/試合終了/.test(resultText) && /(勝ち|引き分け)/.test(resultText), `結果に勝敗が出る（${resultText.match(/(\S+の勝ち！|引き分け)/)?.[0] ?? ''}）`);
await page.click('.result-screen >> text=メインメニューへ');
await page.waitForTimeout(300);
check(await visible('.title-screen'), '結果からメインメニューへ戻れる');

// ---- 画面サイズ変更 ----
await page.setViewportSize({ width: 820, height: 600 });
await page.waitForTimeout(300);
const size = await page.evaluate(() => {
  const c = document.getElementById('view') as HTMLCanvasElement;
  return { w: c.clientWidth, h: c.clientHeight };
});
check(size.w === 820 && size.h === 600, '画面サイズの変更に追従する');

check(errors.length === 0, `ページのエラーがない${errors.length ? `：${errors.join(' / ')}` : ''}`);
await browser.close();
if ('close' in server) await server.close();
else await (server as { httpServer: { close(): void } }).httpServer.close();
if (failures.length) {
  console.log(`\n${failures.length} 件失敗`);
  process.exit(1);
}
console.log('\nすべて成功');
process.exit(0);
