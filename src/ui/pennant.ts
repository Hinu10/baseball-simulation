// ペナントの画面。順位表と、打撃・投手のタイトル争い、公示、前の年のシーズンを表で見せる。
import { formatRate, gamesPlayed, isInterleague, leagues, leagueTeams, noticesOn, SEASON_GAMES, seasonOver, standings, titleRaces, winPct, type Pennant, type TitleRace } from '../core/pennant.ts';
import historyData from '../data/history.json' with { type: 'json' };
import type { Season } from '../core/history.ts';
import { NOTICE_LABEL, type Notice } from '../core/registration.ts';
import { teamStyle, type TeamData } from '../core/teams.ts';

/** 前の年までのシーズン（新しい年が先）。 */
export const PAST_SEASONS: Season[] = [...(historyData.seasons as Season[])].sort((a, b) => b.year - a.year);
export const PENNANT_TABS = ['順位表', '打撃タイトル', '投手タイトル', '公示', ...PAST_SEASONS.map((s) => `${s.year}年`)] as const;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** 「第12戦」や「シーズン終了」。全球団で一番少ない消化試合数で数える。 */
export function pennantProgress(p: Pennant, teams: TeamData[]): string {
  if (seasonOver(p, teams)) return 'シーズン終了';
  const played = Math.min(...teams.map((t) => (p.teams[t.id] ? gamesPlayed(p.teams[t.id]) : 0)));
  const inter = isInterleague(p.day) ? '・交流戦' : '';
  return played ? `${played} / ${SEASON_GAMES} 試合消化${inter}` : `開幕前（全 ${SEASON_GAMES} 試合）`;
}

/** そのチームのリーグ内の順位（1〜）。 */
export function rankOf(p: Pennant, teams: TeamData[], id: string): number {
  return standings(p, leagueTeams(teams, id)).findIndex((r) => r.team.id === id) + 1;
}

/** あなたのリーグを先にしたリーグの並び。 */
const leaguesFor = (teams: TeamData[], you: string) => {
  const list = leagues(teams);
  const mine = teams.find((t) => t.id === you)?.league;
  return [...list.filter((l) => l.name === mine), ...list.filter((l) => l.name !== mine)];
};

const teamName = (t: TeamData) => `<span class="pennant-team" style="${teamStyle(t.colors)}">${esc(t.shortName)}</span>`;

function leagueTableHtml(p: Pennant, name: string, teams: TeamData[], you: string): string {
  const rows = standings(p, teams)
    .map((r, i) => {
      const { w, l, t, rs, ra } = r.record;
      const gb = i === 0 ? '-' : r.gamesBehind ? r.gamesBehind.toFixed(1) : '0.0';
      return `<tr class="${r.team.id === you ? 'current' : ''}"><td class="order">${i + 1}</td><td class="name">${teamName(r.team)}</td><td>${gamesPlayed(r.record)}</td><td>${w}</td><td>${l}</td><td>${t}</td><td>${formatRate(winPct(r.record))}</td><td>${gb}</td><td>${rs}</td><td>${ra}</td></tr>`;
    })
    .join('');
  return `<h3>${esc(name)}</h3><div class="roster-scroll"><table class="roster-table pennant-table"><tr><th></th><th class="name">チーム</th><th>試合</th><th>勝</th><th>敗</th><th>分</th><th>勝率</th><th>差</th><th>得点</th><th>失点</th></tr>${rows}</table></div>`;
}

function standingsHtml(p: Pennant, teams: TeamData[], you: string): string {
  const tables = leaguesFor(teams, you).map((l) => leagueTableHtml(p, l.name, l.teams, you)).join('');
  const last = p.lastRound.length
    ? `<h3>直近の結果</h3><div class="pennant-results">${p.lastRound
        .map((g) => {
          const [a, h] = [g.away, g.home].map((id) => teams.find((t) => t.id === id));
          return a && h ? `<div>${teamName(a)}<b>${g.awayRuns} - ${g.homeRuns}</b>${teamName(h)}</div>` : '';
        })
        .join('')}</div>`
    : '';
  return `${tables}${last}`;
}

function raceHtml(race: TitleRace, you: string): string {
  const rows = race.leaders.length
    ? race.leaders
        .map((l, i) => `<tr class="${l.team.id === you ? 'current' : ''}"><td class="order">${i + 1}</td><td class="name">${esc(l.name)}</td><td>${teamName(l.team)}</td><td class="value">${race.format(l.value)}</td></tr>`)
        .join('')
    : '<tr><td colspan="4" class="empty">まだ記録がありません</td></tr>';
  return `<div class="pennant-race"><h3>${race.label}${race.note ? `<small>${race.note}</small>` : ''}</h3><table class="roster-table">${rows}</table></div>`;
}

/** 公示の一覧（新しい節から、節ごとにまとめる）。 */
function noticesHtml(p: Pennant, teams: TeamData[], you: string, days = 30): string {
  if (!p.notices.length) return '<p class="empty">まだ公示はありません。ペナントが進むと、各球団が出場選手登録を入れ替えます。</p>';
  const byDay = new Map<number, Notice[]>();
  for (const n of p.notices) byDay.set(n.day, [...(byDay.get(n.day) ?? []), n]);
  const sections = [...byDay].reverse().slice(0, days).map(([day, list]) => {
    const rows = list
      .map((n) => {
        const t = teams.find((x) => x.id === n.team);
        return t ? `<tr class="${n.team === you ? 'current' : ''}"><td class="name">${teamName(t)}</td><td class="kind ${n.kind}">${NOTICE_LABEL[n.kind]}${n.reason ? `（${esc(n.reason)}）` : ''}</td><td>${n.group}</td><td class="name">${esc(n.name)}<small>#${n.number}</small></td></tr>` : '';
      })
      .join('');
    return `<h3>${day}日目のあと</h3><table class="roster-table notice-table">${rows}</table>`;
  });
  return `<div class="pennant-notices">${sections.join('')}</div>`;
}

/** 前の年のシーズン：ニーマシリーズ、両リーグの最終順位、主なタイトル。 */
export function seasonHtml(s: Season, teams: TeamData[], you: string): string {
  const team = (id: string) => teams.find((t) => t.id === id);
  const name = (id: string) => {
    const t = team(id);
    return t ? teamName(t) : esc(id);
  };
  const sr = s.series;
  const [w, l] = sr.winner === sr.teams[0] ? sr.wins : [sr.wins[1], sr.wins[0]];
  const games = sr.games
    .map((g) => {
      const win = g.awayRuns > g.homeRuns ? 'away' : g.homeRuns > g.awayRuns ? 'home' : '';
      return `<tr><td class="order">第${g.n}戦</td><td class="name ${win === 'away' ? 'won' : ''}">${name(g.away)}</td><td class="value">${g.awayRuns} - ${g.homeRuns}</td><td class="name ${win === 'home' ? 'won' : ''}">${name(g.home)}</td><td>${team(g.home)?.shortName ?? ''}の本拠地</td></tr>`;
    })
    .join('');
  const series = `<div class="history-series"><h3>${esc(sr.name)}</h3><p class="pennant-champion">🏆 ${esc(team(sr.winner)?.nameJa ?? sr.winner)} が ${w}勝${l}敗${sr.ties ? `${sr.ties}分` : ''} で優勝</p><div class="roster-scroll"><table class="roster-table">${games}</table></div></div>`;
  const leaguesHtml = [...s.leagues]
    .sort((a, b) => Number(b.rows.some((r) => r.team === you)) - Number(a.rows.some((r) => r.team === you)))
    .map((lg) => {
      const rows = lg.rows
        .map((r, i) => {
          const pct = r.w + r.l ? r.w / (r.w + r.l) : 0;
          return `<tr class="${r.team === you ? 'current' : ''}"><td class="order">${i + 1}</td><td class="name">${name(r.team)}${i === 0 ? ' 🏆' : ''}</td><td>${r.w}</td><td>${r.l}</td><td>${r.t}</td><td>${formatRate(pct)}</td><td>${i === 0 ? '-' : r.gb.toFixed(1)}</td><td>${r.rs}</td><td>${r.ra}</td></tr>`;
        })
        .join('');
      const titles = s.titles
        .filter((t) => t.league === lg.name)
        .map((t) =>
          t.leaders
            .map((x, i) => `<tr class="${x.team === you ? 'current' : ''}${i === 0 ? ' title-top' : ''}"><td>${i === 0 ? esc(t.label) : ''}</td><td class="order">${i + 1}</td><td class="name">${esc(x.name)}</td><td>${name(x.team)}</td><td class="value">${esc(x.value)}</td></tr>`)
            .join('')
        )
        .join('');
      return `<h3 class="league-head">${esc(lg.name)}</h3><div class="roster-scroll"><table class="roster-table pennant-table"><tr><th></th><th class="name">チーム</th><th>勝</th><th>敗</th><th>分</th><th>勝率</th><th>差</th><th>得点</th><th>失点</th></tr>${rows}</table></div><h3>タイトル</h3><div class="roster-scroll"><table class="roster-table">${titles}</table></div>`;
    })
    .join('');
  return `<p class="note">${s.year}年シーズンの最終結果（いまの選手で行ったシミュレーション）。</p>${series}${leaguesHtml}`;
}

/** タブ（0 = 順位表、1 = 打撃、2 = 投手、3 = 公示、4〜 = 前の年）の中身。you はあなたのチームの id（強調する）。 */
export function pennantHtml(p: Pennant, teams: TeamData[], tab: number, you: string): string {
  if (tab === 0) return standingsHtml(p, teams, you);
  if (tab === 3) return noticesHtml(p, teams, you);
  if (tab >= 4) return PAST_SEASONS[tab - 4] ? seasonHtml(PAST_SEASONS[tab - 4], teams, you) : '';
  // タイトルはリーグごと。
  return leaguesFor(teams, you)
    .map((l) => {
      const races = titleRaces(p, l.teams);
      const list = tab === 1 ? races.batting : races.pitching;
      return `<h3 class="league-head">${esc(l.name)}</h3><div class="pennant-races">${list.map((r) => raceHtml(r, you)).join('')}</div>`;
    })
    .join('');
}

/** 試合結果の画面に出す、あなたのチームの順位と他球場の結果。 */
export function pennantSummaryHtml(p: Pennant, teams: TeamData[], you: TeamData): string {
  const r = p.teams[you.id];
  if (!r) return '';
  const others = p.lastRound
    .slice(1)
    .map((g) => {
      const [a, h] = [g.away, g.home].map((id) => teams.find((t) => t.id === id));
      return a && h ? `<span>${esc(a.shortName)} ${g.awayRuns}-${g.homeRuns} ${esc(h.shortName)}</span>` : '';
    })
    .join('');
  const short: Record<string, string> = { up: '登録', down: '抹消', sign: '支配下' };
  const notices = noticesOn(p, p.day)
    .map((n) => `<span>${esc(teams.find((t) => t.id === n.team)?.shortName ?? '')} ${short[n.kind]}${n.reason ? `（${esc(n.reason)}）` : ''} ${esc(n.name)}</span>`)
    .join('');
  return `<div class="pennant-summary"><div>ペナント ${esc(you.league)} <b>${rankOf(p, teams, you.id)}位</b>　${r.w}勝${r.l}敗${r.t ? `${r.t}分` : ''}（${pennantProgress(p, teams)}）</div>${others ? `<div class="others">他球場　${others}</div>` : ''}${notices ? `<div class="others">公示　${notices}</div>` : ''}</div>`;
}
