// 指定年度を143試合行って記録に追加する。既存の年度は保持する。
//   node scripts/history.ts 2026 2026
import { readFileSync, writeFileSync } from 'node:fs';
import raw from '../src/data/teams.json' with { type: 'json' };
import { addFormerPlayers, applyRecorded, playSeason, playSeries, summarizeSeason } from '../src/core/history.ts';
import { gamesPlayed, leagues, SEASON_GAMES, standings } from '../src/core/pennant.ts';
import { Rng } from '../src/core/rng.ts';
import { teamsOf } from '../src/core/seasons.ts';
import { parseTeams } from '../src/core/teams.ts';

const YEAR = Number(process.argv[2] ?? 2026);
const seed = Number(process.argv[3] ?? YEAR);
const teams = teamsOf(YEAR, parseTeams(raw));
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
for (const t of teams) {
  const played = gamesPlayed(p.teams[t.id]);
  if (played !== SEASON_GAMES) throw new Error(`${t.id}: ${played}/${SEASON_GAMES}試合`);
}
const [a, b] = leagues(teams).map((l) => standings(p, l.teams)[0].team);
const series = playSeries(p, a, b, seed * 1000 + 900000);
const season = applyRecorded(addFormerPlayers(summarizeSeason(YEAR, p, teams, series, 10)));
const path = new URL('../src/data/history.json', import.meta.url);
const archive = JSON.parse(readFileSync(path, 'utf8')) as { seed?: number; seasons: { year: number }[] };
writeFileSync(path, JSON.stringify({ ...archive, seeds: { ...(archive as { seeds?: Record<number, number> }).seeds, [YEAR]: seed }, seasons: [...archive.seasons.filter((s) => s.year !== YEAR), season].sort((x, y) => y.year - x.year) }, null, 2) + '\n');

const name = (id: string) => teams.find((t) => t.id === id)!.nameJa;
for (const l of season.leagues) {
  console.log(`\n${l.name}`);
  l.rows.forEach((r, i) => console.log(`${i + 1}. ${name(r.team)}  ${r.w}勝${r.l}敗${r.t}分  ${r.gb ? r.gb.toFixed(1) : '-'}`));
}
console.log(`\n${season.series.name}：${name(season.series.winner)} が ${Math.max(...season.series.wins)}勝${Math.min(...season.series.wins)}敗${season.series.ties ? `${season.series.ties}分` : ''} で優勝`);
for (const g of season.series.games) console.log(`  第${g.n}戦 ${name(g.away)} ${g.awayRuns} - ${g.homeRuns} ${name(g.home)}`);
for (const t of season.titles) console.log(`${t.league} ${t.label}：${t.leaders.map((x) => `${x.name}（${name(x.team)}）${x.value}`).join(' / ')}`);
// 話題の選手の成績（球団データの設定どおりの働きか確かめる）。
for (const who of process.env.WATCH?.split(',') ?? []) {
  const id = teams.flatMap((t) => [...t.batters, ...t.pitchers, ...(t.farm?.batters ?? []), ...(t.farm?.pitchers ?? [])]).find((x) => x.name === who)?.id;
  const pl = id && p.pitching[id];
  const bl = id && p.batting[id];
  if (pl) console.log(`${who}：${pl.g ?? 0}登板 ${pl.w}勝${pl.l}敗 防御率 ${pl.outs ? ((pl.r * 27) / pl.outs).toFixed(2) : '-'}（${Math.floor(pl.outs / 3)}回）`);
  if (bl) console.log(`${who}：${bl.g ?? 0}試合 打率 ${bl.ab ? (bl.h / bl.ab).toFixed(3) : '-'} ${bl.hr}本 ${bl.rbi}打点`);
}
