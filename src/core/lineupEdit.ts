// 試合前に、あなたのチームのスタメン・打順・守備位置を組み替える。組み替えは設定に残り、次の試合からも使う。
// 公示で1軍からいなくなった選手がいれば、その打順には元のスタメン（同じ守備位置）か控えを入れて直す。

import { lineupOf, type Batter, type TeamData } from './teams.ts';
import type { LineupPosition } from './types.ts';

/** 組み替えた打順。slots は1番から9番まで、その打順の選手と守備位置。 */
export interface LineupEdit {
  team: string;
  slots: { id: string; pos: LineupPosition }[];
}

/** いまの打順（組み替える前）。 */
export const editOf = (t: TeamData): LineupEdit => ({ team: t.id, slots: lineupOf(t).map((b) => ({ id: b.id, pos: b.position })) });

/** 打順 i と j の選手を入れ替える。守備位置は選手について動く。 */
export function swapOrder(e: LineupEdit, i: number, j: number): LineupEdit {
  const slots = [...e.slots];
  [slots[i], slots[j]] = [slots[j], slots[i]];
  return { ...e, slots };
}

/** 打順 i と j の守備位置だけを入れ替える（打順はそのまま）。 */
export function swapPositions(e: LineupEdit, i: number, j: number): LineupEdit {
  const slots = [...e.slots];
  [slots[i], slots[j]] = [{ ...slots[i], pos: slots[j].pos }, { ...slots[j], pos: slots[i].pos }];
  return { ...e, slots };
}

/** 打順 i に控えの選手を入れる。入った選手は、その打順の守備位置を守る。 */
export function replaceSlot(e: LineupEdit, i: number, id: string): LineupEdit {
  const slots = [...e.slots];
  slots[i] = { ...slots[i], id };
  return { ...e, slots };
}

/**
 * 組み替えを球団に当てはめる。守備位置を変えた選手は、その日はその位置の選手として出る。
 * 1軍にいない選手は、元のスタメンで同じ守備位置の選手か、空いている控えで埋める。repaired はそうして直した数。
 */
export function applyLineupEdit(t: TeamData, e: LineupEdit | undefined): { team: TeamData; repaired: number } {
  if (!e || e.team !== t.id || e.slots.length !== 9) return { team: t, repaired: 0 };
  const byId = new Map(t.batters.map((b) => [b.id, b]));
  const used = new Set(e.slots.filter((s) => byId.has(s.id)).map((s) => s.id));
  const fallback = lineupOf(t);
  let repaired = 0;
  const slots = e.slots.map((s) => {
    if (byId.has(s.id)) return s;
    repaired++;
    const sub = fallback.find((b) => b.position === s.pos && !used.has(b.id)) ?? t.batters.find((b) => !used.has(b.id));
    if (!sub) return s;
    used.add(sub.id);
    return { ...s, id: sub.id };
  });
  if (new Set(slots.map((s) => s.id)).size !== 9 || slots.some((s) => !byId.has(s.id))) return { team: t, repaired: 0 };
  const pos = new Map(slots.map((s) => [s.id, s.pos]));
  const batters: Batter[] = t.batters.map((b) => (pos.has(b.id) && pos.get(b.id) !== b.position ? { ...b, position: pos.get(b.id)! } : b));
  return { team: { ...t, batters, lineup: slots.map((s) => s.id) }, repaired };
}
