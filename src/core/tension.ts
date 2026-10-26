// 試合の盛り上がり（0〜1）。得点圏の走者・満塁・終盤の接戦・追い込まれた場面で上がる。
// 観客（立って跳ねる・タオルを振る）、ざわめきの大きさ、応援のチャンステーマに使う。表示だけで、試合には関わらない。
import { battingTeam, score, type GameState, type TeamIndex } from './gameState.ts';

/** 応援をチャンステーマに切り替える盛り上がり。 */
export const CHANCE_TENSION = 0.45;

export function tension(s: GameState): number {
  if (s.over) return 0;
  const off = battingTeam(s);
  const lead = score(s, off) - score(s, (1 - off) as TeamIndex);
  const runners = s.bases.filter(Boolean).length;
  const scoring = !!(s.bases[2] || s.bases[3]);
  const late = s.inning >= Math.ceil(s.innings * 0.7);
  const close = Math.abs(lead) <= 2;
  let t = 0;
  if (scoring) t += 0.35;
  if (runners === 3) t += 0.15;
  if (late && close) t += 0.2;
  // 最終回以降、同点か1点を追う攻撃。
  if (s.inning >= s.innings && lead <= 0 && lead >= -1) t += 0.2;
  // 走者がいて追い込まれた（2ストライク・2アウト）。
  if (runners && (s.strikes === 2 || s.outs === 2)) t += 0.1;
  // 大差なら盛り上がらない。
  if (Math.abs(lead) >= 6) t *= 0.4;
  return Math.min(1, t);
}
