// 試合後のヒーローインタビュー。勝ったチームから、その試合で活躍した選手（打者・投手）を2人まで選ぶ。
import type { BattingLine, GameState, PitchingLine } from './gameState.ts';
import { allBatters, allPitchers } from './teams.ts';

export interface Hero {
  id: string;
  name: string;
  number: number;
  kind: 'batter' | 'pitcher';
  /** その試合の成績（「4打数3安打 1本塁打 3打点」「7回 1失点 8奪三振 勝利投手」）。 */
  line: string;
  /** ひとこと。 */
  quote: string;
  score: number;
}

/** 選ぶ人数と、2人目を選ぶのに要る活躍の目安（1人目はいちばん活躍した選手を必ず選ぶ）。 */
export const MAX_HEROES = 2;
const SECOND_HERO = 3;

/** 打者の活躍：安打・本塁打・打点。 */
const batterScore = (l: BattingLine) => l.h + l.hr * 2 + l.rbi * 1.5;
/** 投手の活躍：長く投げて、点を取られず、三振を取って勝つ。 */
const pitcherScore = (l: PitchingLine) => (l.outs / 3) * 0.5 - l.r * 1.2 + l.so * 0.15 + l.w;

const inningsText = (outs: number) => `${Math.floor(outs / 3)}回${outs % 3 ? `${outs % 3}/3` : ''}`;

function batterLine(l: BattingLine): string {
  const parts = [`${l.ab}打数${l.h}安打`];
  if (l.hr) parts.push(`${l.hr}本塁打`);
  if (l.rbi) parts.push(`${l.rbi}打点`);
  return parts.join(' ');
}

function pitcherLine(l: PitchingLine, complete: boolean): string {
  const parts = [inningsText(l.outs), l.r ? `${l.r}失点` : '無失点'];
  if (l.so) parts.push(`${l.so}奪三振`);
  if (complete) parts.push(l.r ? '完投' : '完封');
  if (l.w) parts.push('勝利投手');
  return parts.join(' ');
}

/** 勝ったチームのヒーロー（活躍の大きい順に2人まで）。引き分けや試合中は空。 */
export function pickHeroes(s: GameState): Hero[] {
  if (!s.over || s.winner === null) return [];
  const t = s.teams[s.winner];
  const last = s.log.at(-1);
  const walkoff = s.endReason === 'walkoff' ? last?.batterId : undefined;
  const heroes: Hero[] = [];
  for (const b of allBatters(t.team)) {
    const l = s.batting[b.id];
    if (!l?.pa) continue;
    const quote = b.id === walkoff ? '最高でーす！ 最後は気持ちで打ちました！' : l.hr ? '打った瞬間、いったと思いました！' : l.h >= 3 ? '今日はボールがよく見えていました！' : 'チームの勝ちに貢献できてうれしいです！';
    heroes.push({ id: b.id, name: b.name, number: b.number, kind: 'batter', line: batterLine(l), quote, score: batterScore(l) + (b.id === walkoff ? 3 : 0) });
  }
  const used = allPitchers(t.team).filter((p) => s.pitching[p.id]);
  for (const p of used) {
    const l = s.pitching[p.id];
    // ひとりで最後まで投げ、規定の回（9回の試合なら27アウト）を投げきったら完投（無失点なら完封）。
    const complete = used.length === 1 && l.outs >= s.innings * 3;
    const quote = complete && !l.r ? 'キャッチャーのリードのおかげです！' : l.w ? '野手のみなさんに助けてもらいました！' : '自分の仕事ができてよかったです！';
    heroes.push({ id: p.id, name: p.name, number: p.number, kind: 'pitcher', line: pitcherLine(l, complete), quote, score: pitcherScore(l) + (complete ? 2 : 0) });
  }
  heroes.sort((a, b) => b.score - a.score);
  return heroes.filter((h, i) => i === 0 || (i < MAX_HEROES && h.score >= SECOND_HERO));
}
