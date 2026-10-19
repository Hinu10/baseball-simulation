// 野球のルール。試合状態（GameState）を書き換えるのはこのファイルだけ。
// 手動・監督・自動のどのモードも、投球の判定とプレーの結果をここに渡す。

import { battingTeam, currentBatter, fieldingTeam, score, type GameState } from './gameState.ts';

export type PitchCall = 'ball' | 'called-strike' | 'swinging-strike' | 'foul' | 'foul-bunt';
export type PlateAppearanceEnd = 'strikeout' | 'walk' | null;

export type OutKind = 'force' | 'tag' | 'fly';

export interface PlayOut {
  playerId: string;
  kind: OutKind;
  /** プレー開始からの秒。得点が認められるかの判定に使う。 */
  time: number;
  /** 打者走者が一塁に着く前のアウト。 */
  batterBeforeFirst?: boolean;
}

export interface PlayRun {
  playerId: string;
  time: number;
}

export type Bases = GameState['bases'];

/** インプレーの打球1つの結果。プレーのシミュレーション（play.ts）が作る。 */
export interface PlayResult {
  outs: PlayOut[];
  runs: PlayRun[];
  /** プレー後の塁。アウトになった走者・生還した走者は含めない。 */
  bases: Bases;
  /** 記録上の安打（0 = 安打でない、4 = 本塁打）。 */
  hit: 0 | 1 | 2 | 3 | 4;
  text: string;
}

function log(s: GameState, text: string, runs: number) {
  s.log.push({ inning: s.inning, half: s.half, batterId: currentBatter(s).id, text, runs });
}

function addRuns(s: GameState, runs: number) {
  const t = s.teams[battingTeam(s)];
  while (t.runsByInning.length < s.inning) t.runsByInning.push(0);
  t.runsByInning[s.inning - 1] += runs;
}

function endGame(s: GameState, reason: GameState['endReason']) {
  s.over = true;
  s.endReason = reason;
  const away = score(s, 0);
  const home = score(s, 1);
  s.winner = away === home ? null : away > home ? 0 : 1;
}

/** 最終回以降の裏に後攻がリードしたらサヨナラ。 */
function checkWalkoff(s: GameState): boolean {
  if (s.half === 'bottom' && s.inning >= s.innings && score(s, 1) > score(s, 0)) {
    endGame(s, 'walkoff');
    return true;
  }
  return false;
}

function nextBatter(s: GameState) {
  const t = s.teams[battingTeam(s)];
  t.battingIndex = (t.battingIndex + 1) % t.lineup.length;
  s.balls = 0;
  s.strikes = 0;
}

/** 3アウトで攻守交代。試合終了（3回裏の省略・規定回終了）もここで決まる。 */
export function endHalfInning(s: GameState) {
  s.outs = 0;
  s.balls = 0;
  s.strikes = 0;
  s.bases = [null, null, null, null];
  // 0 点のイニングもラインスコアに残す。
  const t = s.teams[battingTeam(s)];
  while (t.runsByInning.length < s.inning) t.runsByInning.push(0);
  if (s.half === 'top') {
    if (s.inning >= s.innings && score(s, 1) > score(s, 0)) {
      endGame(s, 'skip-bottom');
      return;
    }
    s.half = 'bottom';
  } else {
    if (s.inning >= s.innings) {
      // MVP の独自ルール：規定回で同点なら引き分け（延長なし）。
      endGame(s, 'regulation');
      return;
    }
    s.inning += 1;
    s.half = 'top';
  }
}

function recordOut(s: GameState, n: number) {
  s.outs += n;
  if (s.outs >= 3) endHalfInning(s);
}

/** 四球・死球：打者が一塁へ。押し出しで詰まった走者だけが進む。 */
function forceAdvanceBatter(s: GameState): number {
  const b = s.bases;
  const batter = currentBatter(s).id;
  let runs = 0;
  if (b[1]) {
    if (b[2]) {
      if (b[3]) runs = 1;
      b[3] = b[2];
    }
    b[2] = b[1];
  }
  b[1] = batter;
  return runs;
}

/** 投球数を数える。インプレー以外の判定（pitchCall）とインプレー（applyPlay）の両方から呼ぶ。 */
function countPitch(s: GameState) {
  s.teams[fieldingTeam(s)].pitchCount += 1;
}

/** ボール・ストライク・ファウルの判定を反映する。打席が終わったら 'strikeout' か 'walk'。 */
export function pitchCall(s: GameState, call: PitchCall): PlateAppearanceEnd {
  if (s.over) return null;
  countPitch(s);
  if (call === 'ball') {
    s.balls += 1;
    if (s.balls < 4) return null;
    const runs = forceAdvanceBatter(s);
    log(s, runs ? '四球（押し出し）' : '四球', runs);
    addRuns(s, runs);
    if (!checkWalkoff(s)) nextBatter(s);
    return 'walk';
  }
  // 2ストライクからのファウルはカウントが増えない。バントのファウルは三振になる。
  if (call === 'foul' && s.strikes >= 2) return null;
  s.strikes += 1;
  if (s.strikes < 3) return null;
  log(s, call === 'foul-bunt' ? 'スリーバント失敗' : call === 'called-strike' ? '見逃し三振' : '空振り三振', 0);
  nextBatter(s);
  recordOut(s, 1);
  return 'strikeout';
}

/** 第3アウトの種類から、そのプレーで認められる得点を決める（公認野球規則 5.08）。 */
export function countedRuns(outsBefore: number, r: PlayResult): PlayResult['runs'] {
  const outs = [...r.outs].sort((a, b) => a.time - b.time);
  if (outsBefore + outs.length < 3) return r.runs;
  const third = outs[2 - outsBefore];
  // フォースアウトか、打者走者の一塁到達前のアウトが第3アウトなら、そのプレーの得点は入らない。
  if (third.kind === 'force' || third.batterBeforeFirst) return [];
  // タッチアウト・飛球のアウトなら、それより前に本塁に着いた走者だけ得点。
  return r.runs.filter((run) => run.time < third.time);
}

/** インプレーの結果を反映する。 */
export function applyPlay(s: GameState, r: PlayResult) {
  if (s.over) return;
  countPitch(s);
  const runs = countedRuns(s.outs, r);
  addRuns(s, runs.length);
  if (r.hit) s.teams[battingTeam(s)].hits += 1;
  log(s, r.text, runs.length);
  if (checkWalkoff(s)) return;
  const outsAfter = s.outs + r.outs.length;
  nextBatter(s);
  if (outsAfter >= 3) {
    recordOut(s, r.outs.length);
  } else {
    s.outs = outsAfter;
    s.bases = [null, r.bases[1], r.bases[2], r.bases[3]];
  }
}
