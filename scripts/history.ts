// 過去のシーズン（2025）を作り直して src/data/history.json に保存する。
//   node scripts/history.ts            （数分かかる。球団データを変えたら作り直す）
//   node scripts/history.ts 7          （乱数の種を変える）
import { writeFileSync } from 'node:fs';
import raw from '../src/data/teams.json' with { type: 'json' };
import { playSeason, playSeries, summarizeSeason } from '../src/core/history.ts';
import { leagues, standings } from '../src/core/pennant.ts';
import { Rng } from '../src/core/rng.ts';
import { parseTeams } from '../src/core/teams.ts';

const YEAR = 2025;
const seed = Number(process.argv[2] ?? 2025);
const teams = parseTeams(raw);
const rng = new Rng(seed);
const random = () => rng.next();
const started = Date.now();
const p = playSeason(teams, {
  random,
  seed: seed * 1000,
  onDay: (day) => {
    if (day % 20 === 0) console.log(`${day}日目（${Math.round((Date.now() - started) / 1000)}秒）`);
  }
});
const [a, b] = leagues(teams).map((l) => standings(p, l.teams)[0].team);
const series = playSeries(p, a, b, seed * 1000 + 900000);
const season = summarizeSeason(YEAR, p, teams, series);
writeFileSync(new URL('../src/data/history.json', import.meta.url), JSON.stringify({ seed, seasons: [season] }, null, 2) + '\n');

const name = (id: string) => teams.find((t) => t.id === id)!.nameJa;
for (const l of season.leagues) {
  console.log(`\n${l.name}`);
  l.rows.forEach((r, i) => console.log(`${i + 1}. ${name(r.team)}  ${r.w}勝${r.l}敗${r.t}分  ${r.gb ? r.gb.toFixed(1) : '-'}`));
}
console.log(`\n${series.name}：${name(series.winner)} が ${Math.max(...series.wins)}勝${Math.min(...series.wins)}敗${series.ties ? `${series.ties}分` : ''} で優勝`);
for (const g of series.games) console.log(`  第${g.n}戦 ${name(g.away)} ${g.awayRuns} - ${g.homeRuns} ${name(g.home)}`);
for (const t of season.titles) console.log(`${t.league} ${t.label}：${t.leaders.map((x) => `${x.name}（${name(x.team)}）${x.value}`).join(' / ')}`);
// 話題の選手の成績（球団データの設定どおりの働きか確かめる）。
for (const who of process.env.WATCH?.split(',') ?? []) {
  const id = teams.flatMap((t) => [...t.batters, ...t.pitchers, ...(t.farm?.batters ?? []), ...(t.farm?.pitchers ?? [])]).find((x) => x.name === who)?.id;
  const pl = id && p.pitching[id];
  const bl = id && p.batting[id];
  if (pl) console.log(`${who}：${pl.g ?? 0}登板 ${pl.w}勝${pl.l}敗 防御率 ${pl.outs ? ((pl.r * 27) / pl.outs).toFixed(2) : '-'}（${Math.floor(pl.outs / 3)}回）`);
  if (bl) console.log(`${who}：${bl.g ?? 0}試合 打率 ${bl.ab ? (bl.h / bl.ab).toFixed(3) : '-'} ${bl.hr}本 ${bl.rbi}打点`);
}
