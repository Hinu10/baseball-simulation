import assert from 'node:assert/strict';
import { test } from 'node:test';
import raw from '../data/teams.json' with { type: 'json' };
import { conditionedTeam } from './condition.ts';
import { createGameState } from './gameState.ts';
import { managedTeam, SLUMP } from './manager.ts';
import { parseTeams, roleOf, type TeamData } from './teams.ts';

const [team, other] = parseTeams(raw);
/** 指定した選手だけ調子を変え、ほかは普通。 */
const withConditions = (t: TeamData, c: Record<string, number>) => conditionedTeam(t, c);
const lineupIds = (t: TeamData) => t.lineup;

test('ふだん（ひどい不調の選手がいない）は、打順も先発もそのまま', () => {
  const t = withConditions(team, Object.fromEntries(team.batters.map((b) => [b.id, -0.6])));
  const { team: out, moves } = managedTeam(t);
  assert.deepEqual(lineupIds(out), team.lineup);
  assert.equal(out.startingPitcher, team.startingPitcher);
  assert.equal(moves.length, 0);
});

test('ひどい不調のスタメンは同じ守備位置の控えと入れ替えて2軍へ。代わりは同じ打順に入る', () => {
  const at = team.lineup.findIndex((id) => {
    const b = team.batters.find((x) => x.id === id)!;
    return b.position !== 'DH' && team.batters.some((x) => !team.lineup.includes(x.id) && x.position === b.position);
  });
  const out0 = team.batters.find((b) => b.id === team.lineup[at])!;
  const { team: out, moves } = managedTeam(withConditions(team, { [out0.id]: SLUMP - 0.1 }));
  const sub = out.batters.find((b) => b.id === out.lineup[at])!;
  assert.notEqual(sub.id, out0.id);
  assert.equal(sub.position, out0.position);
  assert.ok(out.farm!.batters.some((b) => b.id === out0.id));
  assert.ok(!out.batters.some((b) => b.id === out0.id), '2軍の選手は試合に出ない');
  assert.ok(moves.some((m) => m.text.includes(out0.name)));
  // 入れ替えた球団でも試合を始められる（守備位置がそろっている）。
  const s = createGameState(other, out, 3);
  assert.deepEqual([...s.teams[1].positions].sort(), [...team.lineup.map((id) => team.batters.find((b) => b.id === id)!.position)].sort());
});

test('代わりのいないひどい不調の中軸は6番に下げ、不調の先発はローテーションの次の投手に代える', () => {
  // 4番の守備位置の控えを全員不調にして、入れ替えられないようにする。
  const fourth = team.batters.find((b) => b.id === team.lineup[3])!;
  const c: Record<string, number> = { [fourth.id]: SLUMP - 0.1 };
  for (const b of team.batters) if (!team.lineup.includes(b.id) && (fourth.position === 'DH' || b.position === fourth.position)) c[b.id] = SLUMP - 0.1;
  const starter = team.pitchers.find((p) => p.id === team.startingPitcher)!;
  c[starter.id] = -1;
  const { team: out } = managedTeam(withConditions(team, c));
  assert.equal(out.lineup[5], fourth.id);
  assert.equal(out.lineup.length, 9);
  assert.notEqual(out.startingPitcher, starter.id);
  assert.equal(roleOf(out.pitchers.find((p) => p.id === out.startingPitcher)!), 'starter');
  assert.ok(out.farm!.pitchers.some((p) => p.id === starter.id));
});

test('采配は頻繁ではない：ふつうの調子のばらつきなら、多くの試合で何も動かさない', async () => {
  const { initialConditions } = await import('./condition.ts');
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  let quiet = 0;
  for (let i = 0; i < 200; i++) if (!managedTeam(conditionedTeam(team, initialConditions([team], random))).moves.length) quiet++;
  assert.ok(quiet > 130, `何も動かさない試合 ${quiet}/200`);
});

test('不調の選手が打順で続いていても、打順は1回で決まる', () => {
  const c = Object.fromEntries(team.lineup.slice(3, 7).map((id) => [id, -1]));
  // 控えを全員不調にして、入れ替えられないようにする。
  for (const b of team.batters) if (!team.lineup.includes(b.id)) c[b.id] = -1;
  const { team: out } = managedTeam(withConditions(team, c));
  assert.equal(new Set(out.lineup).size, 9);
  assert.deepEqual(out.lineup.slice(0, 3), team.lineup.slice(0, 3));
  assert.ok(out.lineup.slice(5, 7).includes(team.lineup[3]) && out.lineup.slice(5, 7).includes(team.lineup[4]));
});
