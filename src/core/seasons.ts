// 選べる年度。いまのシーズン（SEASON_YEAR）はペナントの試合、過去の年度は記録に残らない練習試合で、その年の顔ぶれ・スタメンで戦う。
// 2026年は終了時の名簿を保存し、2025年はその名簿に当時の選手を戻して作る（PAST_ROSTERS）。
// 毎年の入れ替え（新人・新外国人が入り、引退・退団した選手が抜ける）は swaps で表す：今いる選手（out）の枠に、
// その年だけいた選手が入る。その年の成績も、その枠の選手のものを引き継ぐ（renameSwapped）。
import { SEASON_YEAR } from './pennant.ts';
import archived2026 from '../data/teams-2026.json' with { type: 'json' };
import { parseTeams, roleOf, type Batter, type Pitcher, type TeamData } from './teams.ts';

/** 選べる年度（新しい順）。 */
export const SEASON_YEARS = [SEASON_YEAR, 2026, 2025] as const;
/** 2026年終了時の選手名簿。翌年の1軍入れ替えに影響されない。 */
const teams2026 = parseTeams(archived2026);

/**
 * 入れ替え：今いる選手 out（その年はまだいない）の枠に、その年だけいた選手が入る。
 * 能力・守備位置・役割は out を元に changes で変え、背番号は out と同じ（空いた番号を翌年 out が付けた）。
 */
export interface Swap {
  out: string;
  name: string;
  number?: number;
  changes?: Partial<Batter & Pitcher>;
}

/** 入れ替えで入った選手の id。 */
export const swappedId = (year: number, out: string) => `${out}-${year}`;

/** その年にいて、今はいない選手と、その年のスタメン、故障で長く離れていた選手。 */
export interface PastRoster {
  team: string;
  swaps?: Swap[];
  batters?: Batter[];
  pitchers?: Pitcher[];
  /** その年はまだいなかった選手（id）。球団から外す。 */
  absent?: string[];
  /** 故障で長く離れていた選手（id と、故障の残りの日数）。1軍から外して2軍で故障中にする。 */
  injured?: { id: string; days: number }[];
  /** その年の打順（野手の id を9人）。省略すれば今と同じ。 */
  lineup?: string[];
  startingPitcher?: string;
}

export const PAST_ROSTERS: Record<number, PastRoster[]> = {
  2025: [
    // 寛ブの正捕手で4番。三冠王（.418・88本・231打点）を取り、シーズン後に海外へ移った。
    {
      team: 'kanbu',
      batters: [
        // 限界突破：ミート・パワーが今の実力の上限（100）を超えている。
        { id: 'kbt-fuchino', name: '渕野 剛臣', number: 10, position: 'C', bats: 'R', meet: 130, power: 130, speed: 55, arm: 88, fielding: 80, limitBreak: true },
        // 右翼の先発で15本塁打。川鷺はこの年、代打が多かった。
        { id: 'kbt-izaki', name: '井崎 涼介', number: 23, position: 'RF', bats: 'L', meet: 62, power: 74, speed: 58, arm: 70, fielding: 65 },
        // DH の外国人選手。翌年はミラーに代わった。
        { id: 'kbt-fretty', name: 'フレッティー', number: 49, position: 'DH', bats: 'R', meet: 72, power: 82, speed: 35, arm: 50, fielding: 45 }
      ],
      absent: ['kbt-16'],
      lineup: ['kbt-01', 'kbt-04', 'kbt-08', 'kbt-fuchino', 'kbt-izaki', 'kbt-12', 'kbt-fretty', 'kbt-02', 'kbt-14'],
      // エースの風嵐はシーズンの多くを故障で離れていた。
      injured: [{ id: 'kbt-p1', days: 90 }],
      swaps: [
        { out: 'kbt-p8', name: 'ハミルトン', changes: { velocity: 156, control: 64, pitches: ['fastball', 'twoseam', 'slider'] } },
        { out: 'kbt-p14', name: '大河内 陸斗', changes: { velocity: 147, control: 74, breaking: 70 } }
      ]
    },
    {
      team: 'maikai',
      swaps: [
        { out: 'tkc-16', name: '宇野 達也', changes: { power: 64 } },
        { out: 'tkc-p13', name: '石毛 亮太' },
        { out: 'tkc-p12', name: 'ブライアント', changes: { velocity: 156 } }
      ]
    },
    {
      team: 'jogawa',
      swaps: [
        { out: 'osw-14', name: '佐野 真太郎' },
        { out: 'osw-p14', name: '長谷部 康平' },
        { out: 'osw-p10', name: 'サンチェス', changes: { velocity: 157 } }
      ]
    },
    {
      team: 'smarlins',
      swaps: [
        { out: 'sml-12', name: '宮内 潤一' },
        { out: 'sml-p13', name: '小田切 友也' },
        { out: 'sml-p10', name: 'リベラ', changes: { velocity: 155 } }
      ]
    },
    {
      team: 'hanazakura',
      swaps: [
        { out: 'hnz-15', name: '林 寛太' },
        { out: 'hnz-p12', name: '柴崎 恭平' },
        { out: 'hnz-p14', name: 'ウォーカー', changes: { velocity: 156 } }
      ]
    },
    {
      team: 'kamiyama',
      swaps: [
        { out: 'kmy-12', name: '宮本 一誠' },
        { out: 'kmy-p12', name: '中川 雅紀' },
        { out: 'kmy-p13', name: 'ラミレス', changes: { velocity: 157 } }
      ]
    },
    {
      team: 'facrom',
      swaps: [
        { out: 'fcx-12', name: '坂東 孝之' },
        { out: 'fcx-p13', name: '藤原 修斗' },
        { out: 'fcx-p12', name: 'クラーク', changes: { velocity: 156 } }
      ]
    },
    {
      team: 'manyama',
      swaps: [
        { out: 'myg-13', name: '剛力 勝人' },
        { out: 'myg-p13', name: '鬼塚 賢治' },
        { out: 'myg-p12', name: 'ゴンザレス', changes: { velocity: 157 } }
      ]
    },
    {
      team: 'onetar',
      swaps: [
        { out: 'ont-14', name: '久世 和人' },
        { out: 'ont-p13', name: '柏木 健一' },
        { out: 'ont-p14', name: 'スミス', changes: { velocity: 155 } }
      ]
    },
    {
      team: 'sackstars',
      swaps: [
        { out: 'sks-15', name: '霧生 遥斗' },
        { out: 'sks-p10', name: '早坂 文哉' },
        { out: 'sks-p9', name: 'アダムス', changes: { velocity: 156 } }
      ]
    },
    {
      team: 'merry',
      swaps: [
        { out: 'mrk-12', name: '寺尾 祐介' },
        { out: 'mrk-p12', name: '篠原 康二' },
        { out: 'mrk-p14', name: 'ヤング', changes: { velocity: 155 } }
      ]
    },
    {
      team: 'kanenodunk',
      swaps: [
        { out: 'knd-13', name: '高峰 正輝' },
        { out: 'knd-p14', name: '岡部 誠斗' },
        { out: 'knd-p12', name: 'モーガン', changes: { velocity: 156 } }
      ]
    }
  ]
};

/** その年度の球団。いまのシーズンならそのまま。 */
export function teamsOf(year: number, teams: TeamData[]): TeamData[] {
  if (year === 2026) return teams2026;
  const past = PAST_ROSTERS[year];
  if (!past) return teams;
  return teams2026.map((team) => {
    let t = team;
    const r = past.find((x) => x.team === t.id);
    if (!r) return t;
    t = swapPlayers(year, t, r.swaps ?? []);
    const hurt = new Map((r.injured ?? []).map((x) => [x.id, x.days]));
    const here = (p: { id: string }) => !r.absent?.includes(p.id);
    const batters = [...t.batters, ...(r.batters ?? [])].filter(here);
    const pitchers = [...t.pitchers, ...(r.pitchers ?? [])].filter(here);
    const out = <P extends { id: string }>(list: P[]) => list.filter((p) => hurt.has(p.id)).map((p) => ({ ...p, injured: hurt.get(p.id) }));
    const active = pitchers.filter((p) => !hurt.has(p.id));
    // 開幕投手が故障なら、ほかの先発の先頭が投げる。
    const opener = r.startingPitcher ?? t.startingPitcher;
    const startingPitcher = hurt.has(opener) ? (active.find((p) => roleOf(p) === 'starter') ?? active[0]).id : opener;
    return {
      ...t,
      batters: batters.filter((b) => !hurt.has(b.id)),
      pitchers: active,
      lineup: r.lineup ?? t.lineup,
      startingPitcher,
      farm: { batters: [...out(batters), ...(t.farm?.batters ?? []).filter(here)], pitchers: [...out(pitchers), ...(t.farm?.pitchers ?? []).filter(here)] },
      ...(t.development && { development: { batters: t.development.batters.filter(here), pitchers: t.development.pitchers.filter(here) } })
    };
  });
}

/** 入れ替えの選手を、out の枠（1軍・2軍・育成のどこでも、打順・開幕投手も）に入れる。 */
function swapPlayers(year: number, t: TeamData, swaps: Swap[]): TeamData {
  if (!swaps.length) return t;
  const id = (x: string) => (swaps.some((s) => s.out === x) ? swappedId(year, x) : x);
  const swap = <P extends { id: string; number: number }>(list: P[]): P[] =>
    list.map((p) => {
      const s = swaps.find((x) => x.out === p.id);
      return s ? ({ ...p, ...s.changes, id: swappedId(year, p.id), name: s.name, number: s.number ?? p.number } as P) : p;
    });
  const squad = (q: TeamData['farm']) => q && { batters: swap(q.batters), pitchers: swap(q.pitchers) };
  return {
    ...t,
    batters: swap(t.batters),
    pitchers: swap(t.pitchers),
    lineup: t.lineup.map(id),
    startingPitcher: id(t.startingPitcher),
    ...(t.farm && { farm: squad(t.farm) }),
    ...(t.development && { development: squad(t.development) })
  };
}

/** その年の成績の表で、入れ替えた枠の成績を、その年だけいた選手のものにする（out の行を新しい id へ移す）。 */
export function renameSwapped<L>(year: number, rec: Record<string, L>): Record<string, L> {
  const swaps = (PAST_ROSTERS[year] ?? []).flatMap((r) => r.swaps ?? []);
  if (!swaps.length) return rec;
  return Object.fromEntries(Object.entries(rec).map(([k, v]) => [swaps.some((s) => s.out === k) ? swappedId(year, k) : k, v]));
}

/** いまのシーズン（ペナントに数える試合）か。 */
export const isCurrentSeason = (year: number) => year === SEASON_YEAR;
