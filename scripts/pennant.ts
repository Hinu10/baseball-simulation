// 今季（2027）のペナントを、全球団がおよそ N 試合を終えたところまで自動で進め、ゲームの保存データの形で書き出す。
//   node scripts/pennant.ts 100        （node_modules/.vite-pennant.json に書き出す。1分ほどかかる）
//   node scripts/pennant.ts 100 7 out.json   （乱数の種と書き出し先を指定）
// 書き出したものを、ブラウザの localStorage の baseball-simulation.pennant.2027 に入れると、ゲームはその続きから始まる。
import { writeFileSync } from 'node:fs';
import raw from '../src/data/teams.json' with { type: 'json' };
import { playSeason } from '../src/core/history.ts';
import { gamesPlayed, leagues, standings } from '../src/core/pennant.ts';
import { Rng } from '../src/core/rng.ts';
import { parseTeams } from '../src/core/teams.ts';

const games = Number(process.argv[2] ?? 100);
const seed = Number(process.argv[3] ?? Date.now() % 100000);
const teams = parseTeams(raw);
const rng = new Rng(seed);
const started = Date.now();
const p = playSeason(teams, {
  random: () => rng.next(),
  seed: seed * 1000,
  untilGames: games,
  onDay: (day) => {
    if (day % 20 === 0) console.log(`${day}日目（${Math.round((Date.now() - started) / 1000)}秒）`);
  }
});
const out = process.argv[4] ? new URL(process.argv[4], `file://${process.cwd()}/`) : new URL('../node_modules/.vite-pennant.json', import.meta.url);
writeFileSync(out, JSON.stringify(p));
console.log(`書き出しました: ${out.pathname}（乱数の種 ${seed}）`);
for (const l of leagues(teams)) {
  console.log(`\n${l.name}`);
  standings(p, l.teams).forEach((r, i) => console.log(`${i + 1}. ${r.team.nameJa}  ${gamesPlayed(r.record)}試合 ${r.record.w}勝${r.record.l}敗${r.record.t}分  ${r.gamesBehind ? r.gamesBehind.toFixed(1) : '-'}`));
}
