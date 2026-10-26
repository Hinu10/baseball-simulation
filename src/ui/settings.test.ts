import assert from 'node:assert/strict';
import { test } from 'node:test';
import raw from '../data/teams.json' with { type: 'json' };
import { editOf, replaceSlot } from '../core/lineupEdit.ts';
import { teamsOf } from '../core/seasons.ts';
import { parseTeams } from '../core/teams.ts';
import { DEFAULT_SETTINGS, savedLineup, withSavedLineup } from './settings.ts';

test('2025年と2026年の控え選手への変更を年度ごとに保存する', () => {
  const teams = parseTeams(raw);
  const team = 'kanbu';
  let settings = { ...DEFAULT_SETTINGS, team, year: 2025 };
  const past = teamsOf(2025, teams).find((t) => t.id === team)!;
  const older = replaceSlot(editOf(past), 0, past.batters.find((b) => !past.lineup.includes(b.id))!.id);
  settings = withSavedLineup(settings, older);
  settings = { ...settings, year: 2026 };
  const recent = teamsOf(2026, teams).find((t) => t.id === team)!;
  const newer = replaceSlot(editOf(recent), 0, recent.batters.find((b) => !recent.lineup.includes(b.id))!.id);
  settings = withSavedLineup(settings, newer);
  assert.deepEqual(savedLineup(settings, 2025, team), older);
  assert.deepEqual(savedLineup(settings, 2026, team), newer);
  assert.notEqual(older.slots[0].id, newer.slots[0].id);
  settings = withSavedLineup(settings, undefined);
  assert.equal(savedLineup(settings, 2026, team), undefined);
  assert.deepEqual(savedLineup(settings, 2025, team), older);
});
