// CPU の監督の試合前の采配。ひどく調子を落とした選手だけを2軍に落とし、打順を少し組み替える。
// ふだんは元の打順・ローテーションのまま（頻繁には動かさない）。調子は conditionedTeam で選手に付いたものを読む。

import { roleOf, type Batter, type Pitcher, type TeamData } from './teams.ts';

/** これより調子が悪い選手だけを動かす（絶不調の中でも特に悪いとき。1人あたり4%ほどの日）。 */
export const SLUMP = -0.9;
/** 打順の中軸（1〜5番）から外すときの行き先（6番）。 */
const MOVE_DOWN_TO = 5;

const slumping = (p: { condition?: number }) => (p.condition ?? 0) <= SLUMP;
/** 打つ力の目安（調子を反映した今日の能力）。 */
const hitting = (b: Batter) => b.meet + b.power + 0.3 * b.speed;

export interface ManagerMove {
  text: string;
}

/**
 * 試合前の采配をした球団と、その説明を返す。2軍の選手は batters・pitchers から外し、farm に入れる。
 * 動かすのはスタメンの野手と今日の先発投手だけ（控え・救援投手は、試合で使う場面が少ないのでそのまま）。
 * - スタメンの野手は、同じ守備位置（指名打者ならだれでも）の控えがいるときだけ入れ替えて2軍へ。代わりの選手は同じ打順に入る
 * - 先発投手が不調なら、ローテーションの次の投手が先発し、不調の投手は2軍へ
 * - 入れ替えられずに残った不調のスタメンが1〜5番なら、6番に下げる
 */
export function managedTeam(t: TeamData): { team: TeamData; moves: ManagerMove[] } {
  const moves: ManagerMove[] = [];
  const byId = new Map(t.batters.map((b) => [b.id, b]));
  const lineup = t.lineup.map((id) => byId.get(id)!);
  const farmBatters: Batter[] = [];
  const bench = t.batters.filter((b) => !t.lineup.includes(b.id));

  const available = bench.filter((b) => !slumping(b));
  lineup.forEach((b, i) => {
    if (!slumping(b)) return;
    const candidates = available.filter((x) => b.position === 'DH' || x.position === b.position);
    if (!candidates.length) return;
    const sub = candidates.reduce((a, x) => (hitting(x) > hitting(a) ? x : a));
    available.splice(available.indexOf(sub), 1);
    // 指名打者の代わりは、指名打者として打つ。
    lineup[i] = b.position === 'DH' ? { ...sub, position: 'DH' } : sub;
    farmBatters.push(b);
    moves.push({ text: `${b.name} を2軍へ、${sub.name} がスタメン` });
  });
  // 中軸から外す選手はまとめて6番以降へ（1回で決める。続けて並んだ不調の選手を入れ替え続けないように）。
  const down = lineup.slice(0, MOVE_DOWN_TO).filter(slumping);
  if (down.length) {
    const rest = lineup.filter((b) => !down.includes(b));
    lineup.splice(0, lineup.length, ...rest.slice(0, MOVE_DOWN_TO), ...down, ...rest.slice(MOVE_DOWN_TO));
    for (const b of down) moves.push({ text: `${b.name} を${lineup.indexOf(b) + 1}番に下げる` });
  }

  const starters = t.pitchers.filter((p) => roleOf(p) === 'starter');
  let startingPitcher = t.startingPitcher;
  const farmPitchers: Pitcher[] = [];
  const first = t.pitchers.find((p) => p.id === startingPitcher);
  if (first && slumping(first)) {
    const at = starters.indexOf(first);
    const next = [...starters.slice(at + 1), ...starters.slice(0, at)].find((p) => !slumping(p));
    if (next) {
      startingPitcher = next.id;
      farmPitchers.push(first);
      moves.push({ text: `${first.name} を2軍へ、${next.name} が先発` });
    }
  }

  if (!farmBatters.length && !farmPitchers.length && !moves.length) return { team: t, moves };
  const replaced = new Map(lineup.map((b) => [b.id, b]));
  const batters = t.batters.filter((b) => !farmBatters.includes(b)).map((b) => replaced.get(b.id) ?? b);
  return {
    team: {
      ...t,
      batters,
      pitchers: t.pitchers.filter((p) => !farmPitchers.includes(p)),
      lineup: lineup.map((b) => b.id),
      startingPitcher,
      farm: { batters: [...farmBatters, ...(t.farm?.batters ?? [])], pitchers: [...farmPitchers, ...(t.farm?.pitchers ?? [])] }
    },
    moves
  };
}
