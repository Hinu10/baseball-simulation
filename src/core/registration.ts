// 出場選手登録（1軍の登録・抹消）と育成選手の支配下登録、その公示。
// ペナント中、各球団はたまに、ひどく調子を落とした1軍の選手を抹消し、調子のよい2軍の選手を登録する（同じ守備位置・役割どうしで入れ替える）。
// 抹消された選手は10日（10節）たたないと再登録できない。育成選手は、まれに支配下登録されて2軍に入る（背番号が2桁になる）。
// 登録の状態はペナントに保存し、球団のデータ（teams.json）は開幕時の登録として扱う。

import type { Conditions } from './condition.ts';
import { allBatters, allPitchers, roleOf, type Batter, type Pitcher, type TeamData } from './teams.ts';
import type { LineupPosition } from './types.ts';

/** 1球団の登録の状態。 */
export interface Registration {
  /** 1軍に登録されている選手の id。 */
  active: string[];
  /** 支配下登録された育成選手の id と、新しい背番号。 */
  signed: Record<string, number>;
  /** 抹消された日（節）。再登録できるのは REREGISTER_DAYS たってから。 */
  removedOn: Record<string, number>;
  /** 故障した選手と、治る日（節）。 */
  injuredUntil?: Record<string, number>;
  /** 故障で1軍を外れた選手と、代わりに上がった選手（治ったら入れ替えて戻す）。 */
  replacedBy?: Record<string, string>;
}

export type Registrations = Record<string, Registration>;

export type NoticeKind = 'up' | 'down' | 'sign';
export const NOTICE_LABEL: Record<NoticeKind, string> = { up: '出場選手登録', down: '出場選手登録抹消', sign: '支配下選手登録' };

/** 公示。day はその節（何日目のあとか）。 */
export interface Notice {
  /** 抹消の理由（故障）。 */
  reason?: string;
  day: number;
  team: string;
  kind: NoticeKind;
  id: string;
  name: string;
  number: number;
  /** 投手・捕手・内野手・外野手。 */
  group: string;
}

/** 抹消から再登録までの日数。 */
export const REREGISTER_DAYS = 10;
/** 1節に、その球団が入れ替えを考える確率。 */
export const SWAP_CHANCE = 0.07;
/** 1節に、育成選手を支配下登録する確率（143試合でおよそ1人）。 */
export const SIGN_CHANCE = 0.008;
/** 1節に、力の上の2軍の選手を1軍に戻すかを考える確率と、そうするのに要る力の差（strength の値）。 */
export const COMEBACK_CHANCE = 0.25;
export const COMEBACK_MARGIN = 15;
/** 抹消を考えるほどの不調。 */
const SLUMP = -0.5;
/** 上げる2軍の選手は、これより調子がよいこと。 */
const READY = -0.1;
/** 故障しやすさの標準（省略したとき）と、その選手が1日に故障する確率。故障しやすさ 95 ならおよそ 18 倍。 */
export const FRAGILITY = { normal: 30, perDay: 0.0015 };
/** 故障で出られない日数（この範囲で決まる）。再登録できるまでの日数より長い。 */
export const INJURY_DAYS = { min: REREGISTER_DAYS, max: 40 };
export const injuryChance = (p: { fragility?: number }) => FRAGILITY.perDay * ((p.fragility ?? FRAGILITY.normal) / FRAGILITY.normal) ** 2.5;
/** 保存しておく公示の数。 */
const KEEP_NOTICES = 300;

const GROUP: Record<LineupPosition, string> = { C: '捕手', '1B': '内野手', '2B': '内野手', '3B': '内野手', SS: '内野手', LF: '外野手', CF: '外野手', RF: '外野手', DH: '外野手' };
export const groupOf = (p: Batter | Pitcher) => ('position' in p ? GROUP[p.position] : '投手');

/** 開幕時の登録（teams.json のとおり）。 */
export function initialRegistration(t: TeamData): Registration {
  return { active: [...t.batters, ...t.pitchers].map((p) => p.id), signed: {}, removedOn: {} };
}

/** 背番号（支配下登録で変わる）と、故障の残り日数（day を渡したとき）を付ける。 */
function withRegistration<T extends Batter | Pitcher>(p: T, reg: Registration, day?: number): T {
  const until = reg.injuredUntil?.[p.id];
  const injured = day !== undefined && until !== undefined && until > day ? until - day : undefined;
  if (!(p.id in reg.signed) && injured === undefined) return p;
  return { ...p, ...(p.id in reg.signed && { number: reg.signed[p.id] }), ...(injured !== undefined && { injured }) };
}

/**
 * 登録の状態を反映した球団。1軍（batters・pitchers）・2軍（farm）・育成（development）に分け直し、
 * 打順や先発が抹消された選手なら、同じ守備位置の1軍の選手・ローテーションの先発に代える。
 */
export function registeredTeam(t: TeamData, reg: Registration | undefined, day?: number): TeamData {
  if (!reg) return t;
  const active = new Set(reg.active);
  const dev = new Set([...(t.development?.batters ?? []), ...(t.development?.pitchers ?? [])].map((p) => p.id));
  const contracted = (p: { id: string }) => !dev.has(p.id) || p.id in reg.signed;
  const bats = allBatters(t).map((b) => withRegistration(b, reg, day));
  const arms = allPitchers(t).map((p) => withRegistration(p, reg, day));
  const batters = bats.filter((b) => active.has(b.id));
  const pitchers = arms.filter((p) => active.has(p.id));
  const hitting = (b: Batter) => b.meet + b.power + 0.3 * b.speed;
  const lineup: string[] = [];
  for (const id of t.lineup) {
    if (active.has(id)) {
      lineup.push(id);
      continue;
    }
    const pos = bats.find((b) => b.id === id)!.position;
    const bench = batters.filter((b) => !t.lineup.includes(b.id) && !lineup.includes(b.id));
    const same = bench.filter((b) => b.position === pos);
    const pick = (same.length ? same : bench).reduce<Batter | null>((a, b) => (!a || hitting(b) > hitting(a) ? b : a), null);
    if (!pick) continue;
    lineup.push(pick.id);
    // 守備位置の違う選手で埋めたときは、その位置を守らせる（指名打者の代わりと同じ扱い）。
    if (pick.position !== pos) batters.splice(batters.indexOf(pick), 1, { ...pick, position: pos });
  }
  const starter = active.has(t.startingPitcher) ? t.startingPitcher : (pitchers.find((p) => roleOf(p) === 'starter') ?? pitchers[0]).id;
  return {
    ...t,
    batters,
    pitchers,
    lineup,
    startingPitcher: starter,
    farm: { batters: bats.filter((b) => !active.has(b.id) && contracted(b)), pitchers: arms.filter((p) => !active.has(p.id) && contracted(p)) },
    development: { batters: bats.filter((b) => !contracted(b)), pitchers: arms.filter((p) => !contracted(p)) }
  };
}

/** 入れ替えてよい組み合わせか（野手は同じ守備位置、投手は先発どうし・救援どうし）。 */
function sameSlot(a: Batter | Pitcher, b: Batter | Pitcher): boolean {
  if ('position' in a !== 'position' in b) return false;
  if ('position' in a) return a.position === (b as Batter).position;
  return (roleOf(a) === 'starter') === (roleOf(b as Pitcher) === 'starter');
}

const strength = (p: Batter | Pitcher) => ('position' in p ? p.meet + p.power + 0.3 * p.speed + 0.3 * p.fielding : p.control + p.breaking + (p.velocity - 130) * 2.5);

/** 背番号の空き（0〜69 で、首脳陣・選手が使っていないもの）。 */
function freeNumber(t: TeamData, reg: Registration): number | null {
  const used = new Set([...t.staff.map((m) => m.number), ...[...allBatters(t), ...allPitchers(t)].map((p) => reg.signed[p.id] ?? p.number)]);
  for (let n = 0; n < 70; n++) if (!used.has(n)) return n;
  return null;
}

/**
 * 1節が終わったあとの登録の入れ替え。day はその節の番号、conditions は次の節の調子。
 * 新しい登録の状態と、出した公示を返す。teams は teams.json の球団（登録を反映する前）。
 */
export function rosterMoves(
  regs: Registrations,
  teams: TeamData[],
  conditions: Conditions,
  day: number,
  random: () => number = Math.random
): { registrations: Registrations; notices: Notice[] } {
  const next: Registrations = { ...regs };
  const notices: Notice[] = [];
  const cond = (p: { id: string }) => conditions[p.id] ?? 0;
  const notice = (t: TeamData, kind: NoticeKind, p: Batter | Pitcher, reason?: string) =>
    notices.push({ day, team: t.id, kind, id: p.id, name: p.name, number: p.number, group: groupOf(p), ...(reason && { reason }) });
  for (const t of teams) {
    let reg = regs[t.id] ?? initialRegistration(t);
    const hurt = (p: { id: string }) => (reg.injuredUntil?.[p.id] ?? -Infinity) > day;
    const canRegister = (p: { id: string }) => !hurt(p) && day - (reg.removedOn[p.id] ?? -Infinity) >= REREGISTER_DAYS;
    const swap = (out: Batter | Pitcher, up: Batter | Pitcher, reason?: string) => {
      reg = { ...reg, active: [...reg.active.filter((id) => id !== out.id), up.id], removedOn: { ...reg.removedOn, [out.id]: day } };
      notice(t, 'up', up);
      notice(t, 'down', out, reason);
    };
    // 治った選手は、故障で外れたときに代わりに上がった選手と入れ替えて1軍に戻す。
    for (const [id, sub] of Object.entries(reg.replacedBy ?? {})) {
      if (hurt({ id })) continue;
      const team = registeredTeam(t, reg);
      const back = [...team.farm!.batters, ...team.farm!.pitchers].find((p) => p.id === id);
      const { [id]: _, ...rest } = reg.replacedBy!;
      reg = { ...reg, replacedBy: rest };
      if (!back || !canRegister(back)) continue;
      // 代わりの選手がもう1軍にいなければ、同じ守備位置・役割でいちばん力の落ちる選手と入れ替える。
      const slot = [...team.batters, ...team.pitchers].filter((p) => sameSlot(back, p));
      const out = slot.find((p) => p.id === sub) ?? slot.reduce<Batter | Pitcher | null>((a, p) => (!a || strength(p) < strength(a) ? p : a), null);
      if (out && (out.id === sub || strength(back) > strength(out))) swap(out, back);
    }
    // 故障：1軍の選手がまれに故障し、同じ守備位置・役割の2軍の選手と入れ替わる。
    for (const p of (() => {
      const team = registeredTeam(t, reg);
      return [...team.batters, ...team.pitchers];
    })()) {
      if (hurt(p) || random() >= injuryChance(p)) continue;
      const team = registeredTeam(t, reg);
      const subs = [...team.farm!.batters, ...team.farm!.pitchers].filter((x) => sameSlot(p, x) && canRegister(x));
      if (!subs.length) continue;
      const up = subs.reduce((a, x) => (strength(x) + 30 * cond(x) > strength(a) + 30 * cond(a) ? x : a));
      const days = INJURY_DAYS.min + Math.floor(random() * (INJURY_DAYS.max - INJURY_DAYS.min + 1));
      reg = { ...reg, injuredUntil: { ...reg.injuredUntil, [p.id]: day + days }, replacedBy: { ...reg.replacedBy, [p.id]: up.id } };
      swap(p, up, '故障');
    }
    const team = registeredTeam(t, reg);
    if (random() < SWAP_CHANCE) {
      const down = [...team.batters, ...team.pitchers].filter((p) => cond(p) <= SLUMP).sort((a, b) => cond(a) - cond(b));
      for (const out of down) {
        const ready = [...team.farm!.batters, ...team.farm!.pitchers].filter((p) => sameSlot(out, p) && cond(p) > READY && canRegister(p));
        if (!ready.length) continue;
        const up = ready.reduce((a, p) => (strength(p) + 30 * cond(p) > strength(a) + 30 * cond(a) ? p : a));
        swap(out, up);
        break;
      }
    }
    // 返り咲き：調子を戻した2軍の選手が、1軍の同じ枠でいちばん力の落ちる選手よりはっきり上なら入れ替える（主力が2軍に残ったままにしない）。
    if (random() < COMEBACK_CHANCE) {
      const now = registeredTeam(t, reg);
      const ready = [...now.farm!.batters, ...now.farm!.pitchers].filter((p) => cond(p) > READY && canRegister(p)).sort((a, b) => strength(b) - strength(a));
      for (const up of ready) {
        const slot = [...now.batters, ...now.pitchers].filter((p) => sameSlot(up, p));
        const weakest = slot.reduce<Batter | Pitcher | null>((a, p) => (!a || strength(p) < strength(a) ? p : a), null);
        if (weakest && strength(up) - strength(weakest) >= COMEBACK_MARGIN) {
          swap(weakest, up);
          break;
        }
      }
    }
    const prospects = [...team.development!.batters, ...team.development!.pitchers];
    if (prospects.length && random() < SIGN_CHANCE) {
      const p = prospects.reduce((a, x) => (strength(x) > strength(a) ? x : a));
      const number = freeNumber(t, reg);
      if (number !== null) {
        reg = { ...reg, signed: { ...reg.signed, [p.id]: number } };
        notice(t, 'sign', { ...p, number });
      }
    }
    next[t.id] = reg;
  }
  return { registrations: next, notices };
}

/** 公示を足して、古いものから捨てる。 */
export const addNotices = (list: Notice[], add: Notice[]) => [...list, ...add].slice(-KEEP_NOTICES);
