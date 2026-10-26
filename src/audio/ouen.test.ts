import assert from 'node:assert/strict';
import { test } from 'node:test';
import { themeOf } from './ouen.ts';

test('応援歌は球団ごとに違うメロディで、4小節に収まり、毎回同じものができる', () => {
  const a = themeOf('kanbu', false);
  const b = themeOf('manyama', false);
  assert.deepEqual(themeOf('kanbu', false), a);
  assert.notDeepEqual(a.notes.map((n) => n.freq), b.notes.map((n) => n.freq));
  for (const n of a.notes) assert.ok(n.at >= 0 && n.at + n.len <= 16 + 1e-9 && n.freq! > 100);
  // 太鼓は毎拍打つ。
  for (let beat = 0; beat < 16; beat++) assert.ok(a.drums.includes(beat));
});

test('チャンステーマは、ふだんの応援歌より速く、太鼓も多い', () => {
  const normal = themeOf('kanbu', false);
  const chance = themeOf('kanbu', true);
  assert.ok(chance.tempo > normal.tempo);
  assert.ok(chance.drums.length > normal.drums.length);
});
