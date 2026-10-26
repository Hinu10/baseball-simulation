import assert from 'node:assert/strict';
import { test } from 'node:test';
import raw from '../data/teams.json' with { type: 'json' };
import { applyLineupEdit, editOf, replaceSlot, swapOrder, swapPositions } from './lineupEdit.ts';
import { createGameState } from './gameState.ts';
import { lineupOf, parseTeams } from './teams.ts';

const [t, other] = parseTeams(raw);

test('打順の入れ替え：守備位置は選手についていく', () => {
  const e = swapOrder(editOf(t), 0, 3);
  const team = applyLineupEdit(t, e).team;
  const [a, b] = [lineupOf(t)[0], lineupOf(t)[3]];
  assert.equal(team.lineup[0], b.id);
  assert.equal(team.lineup[3], a.id);
  assert.equal(lineupOf(team)[0].position, b.position);
});

test('守備位置の入れ替え：打順はそのままで、試合ではその位置を守る', () => {
  const team = applyLineupEdit(t, swapPositions(editOf(t), 0, 1)).team;
  const s = createGameState(team, other, 3, 'manual', 0);
  assert.deepEqual(team.lineup, t.lineup);
  assert.equal(s.teams[0].positions[0], lineupOf(t)[1].position);
  assert.equal(s.teams[0].positions[1], lineupOf(t)[0].position);
});

test('控えと代える：控えの選手がその打順・守備位置に入る', () => {
  const bench = t.batters.find((b) => !t.lineup.includes(b.id))!;
  const pos = lineupOf(t)[4].position;
  const team = applyLineupEdit(t, replaceSlot(editOf(t), 4, bench.id)).team;
  assert.equal(team.lineup[4], bench.id);
  assert.equal(lineupOf(team)[4].position, pos);
  assert.equal(team.batters.find((b) => b.id === bench.id)!.position, pos);
});

test('1軍にいない選手は、元のスタメンか控えで埋めて直す。ほかの球団の組み替えは使わない', () => {
  const gone = lineupOf(t)[2];
  const e = swapOrder(editOf(t), 0, 1);
  const without = { ...t, batters: t.batters.filter((b) => b.id !== gone.id), lineup: t.lineup.map((id) => (id === gone.id ? t.batters.find((b) => !t.lineup.includes(b.id))!.id : id)) };
  const { team, repaired } = applyLineupEdit(without, e);
  assert.equal(repaired, 1);
  assert.equal(new Set(team.lineup).size, 9);
  assert.ok(!team.lineup.includes(gone.id));
  assert.equal(team.lineup[0], t.lineup[1], '組み替えたところはそのまま');
  assert.equal(applyLineupEdit(other, e).team, other);
});
