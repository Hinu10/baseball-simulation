import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatAverage } from './season.ts';

test('打率は .285 のように、打数 0 は -.--- と表示する', () => {
  assert.equal(formatAverage({ pa: 10, ab: 7, h: 2, hr: 0, rbi: 0 }), '.286');
  assert.equal(formatAverage({ pa: 3, ab: 3, h: 3, hr: 1, rbi: 2 }), '1.000');
  assert.equal(formatAverage({ pa: 1, ab: 0, h: 0, hr: 0, rbi: 0 }), '-.---');
});
