// 選手・打順の画面。打順と野手・投手の能力を表で見せる。試合中なら、いまの打者・登板中の投手・今日の打席も出す。
import { battingTeam, type GameState, type TeamIndex } from '../core/gameState.ts';
import { PITCHES } from '../core/pitching.ts';
import { roleOf, ROLE_LABEL, teamStyle, type Batter, type Pitcher, type TeamData } from '../core/teams.ts';
import { conditionLevel } from '../core/condition.ts';
import { POSITION_LABEL, type LineupPosition } from '../core/types.ts';

/** 能力（0〜100）のランク。 */
export function rank(v: number): string {
  if (v >= 95) return 'S';
  if (v >= 85) return 'A';
  if (v >= 75) return 'B';
  if (v >= 65) return 'C';
  if (v >= 55) return 'D';
  if (v >= 40) return 'E';
  if (v >= 20) return 'F';
  return 'G';
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const HAND = { R: '右', L: '左' } as const;

/** 今日の調子の印（↗ 好調 など）。調子を持たない選手は空。 */
export function conditionBadge(c: number | undefined): string {
  if (c === undefined) return '';
  const l = conditionLevel(c);
  return `<span class="condition ${l.cls}" title="調子：${l.label}">${l.mark}${l.label}</span>`;
}

const stat = (v: number) => `<td class="stat r-${rank(v)}"><b>${rank(v)}</b>${v}</td>`;

/** 試合中の様子。試合前（メインメニュー）は省く。 */
export interface RosterLive {
  state: GameState;
  index: TeamIndex;
}

function batterRow(b: Batter, order: string, pos: LineupPosition | null, live: RosterLive | undefined, current: boolean, removed = false) {
  const today = live
    ? live.state.log
        .filter((e) => e.batterId === b.id)
        .map((e) => esc(e.text.replace(/　.*/, '')))
        .join('、') || '―'
    : '';
  const cls = current ? 'current' : removed ? 'removed' : '';
  return `<tr class="${cls}"><td class="order">${order}</td><td class="pos">${pos ? POSITION_LABEL[pos] : removed ? '退' : ''}</td><td class="name">${esc(b.name)}<small>#${b.number}</small></td><td>${HAND[b.bats]}</td><td>${conditionBadge(b.condition)}</td>${stat(b.meet)}${stat(b.power)}${stat(b.speed)}${stat(b.arm)}${stat(b.fielding)}${live ? `<td class="today">${today}</td>` : ''}</tr>`;
}

function pitcherRow(p: Pitcher, live: RosterLive | undefined, onMound: boolean, pitchCount: number, removed: boolean) {
  const pitches = p.pitches.map((t) => PITCHES[t].label).join('・');
  const note = live ? `<td class="today">${onMound ? `登板中（${pitchCount}球）` : removed ? '降板' : ''}</td>` : '';
  const tag = !live && onMound ? '<em>先発</em>' : '';
  const role = `<td class="role">${ROLE_LABEL[roleOf(p)]}</td>`;
  return `<tr class="${onMound ? 'current' : removed ? 'removed' : ''}"><td class="name">${esc(p.name)}<small>#${p.number}</small>${tag}</td>${role}<td>${HAND[p.throws]}</td><td>${conditionBadge(p.condition)}</td><td class="speed">${p.velocity}<small>km/h</small></td>${stat(p.control)}${stat(p.stamina)}${stat(p.breaking)}<td class="pitches">${pitches}</td>${note}</tr>`;
}

export const RANK_NOTE = 'S 90〜 ／ A 80〜 ／ B 70〜 ／ C 60〜 ／ D 50〜 ／ E 40〜 ／ F 20〜 ／ G 〜19　能力は今日の調子を反映';

/** 1チーム分の表。live があれば試合中の打順・投手を使う。 */
export function rosterHtml(team: TeamData, live?: RosterLive): string {
  const t = live?.state.teams[live.index];
  const lineup = t?.lineup ?? team.lineup.map((id) => team.batters.find((b) => b.id === id)!);
  const positions = t?.positions ?? lineup.map((b) => b.position);
  const removed = new Set(t?.removed ?? []);
  // 控えは、まだ出られる選手を先に、退いた選手を後に並べる。
  const bench = team.batters.filter((b) => !lineup.includes(b)).sort((a, b) => Number(removed.has(a.id)) - Number(removed.has(b.id)));
  // いまの打者は攻撃中のチームだけ。
  const atBat = live && t && battingTeam(live.state) === live.index && !live.state.over ? t.battingIndex : -1;
  const mound = t?.pitcher.id ?? team.startingPitcher;
  const todayHead = live ? '<th>今日</th>' : '';
  const batterHead = `<tr><th></th><th>守</th><th class="name">名前</th><th>打</th><th>調子</th><th>ミート</th><th>パワー</th><th>走力</th><th>肩</th><th>守備</th>${todayHead}</tr>`;
  return `<div class="roster-team" style="${teamStyle(team.colors)}">
    <h3>打順</h3>
    <div class="roster-scroll"><table class="roster-table">${batterHead}${lineup.map((b, i) => batterRow(b, String(i + 1), positions[i], live, i === atBat)).join('')}${
      bench.length ? `<tr class="bench-head"><td colspan="${live ? 11 : 10}">控え</td></tr>${bench.map((b) => batterRow(b, '', removed.has(b.id) ? null : b.position, live, false, removed.has(b.id))).join('')}` : ''
    }</table></div>
    <h3>投手</h3>
    <div class="roster-scroll"><table class="roster-table"><tr><th class="name">名前</th><th>役割</th><th>投</th><th>調子</th><th>球速</th><th>コントロール</th><th>スタミナ</th><th>変化球</th><th>球種</th>${todayHead}</tr>${team.pitchers
      .map((p) => pitcherRow(p, live, p.id === mound, t?.pitchCount ?? 0, removed.has(p.id)))
      .join('')}</table></div>
  </div>`;
}
