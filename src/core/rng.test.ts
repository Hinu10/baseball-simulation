import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Rng } from './rng.ts';

test('同じ seed なら同じ乱数列になる', () => {
  const a = new Rng(42);
  const b = new Rng(42);
  for (let i = 0; i < 100; i++) assert.equal(a.next(), b.next());
});

test('next は 0 以上 1 未満', () => {
  const r = new Rng(1);
  for (let i = 0; i < 10000; i++) {
    const v = r.next();
    assert.ok(v >= 0 && v < 1);
  }
});

test('gauss の平均と標準偏差がおおよそ合う', () => {
  const r = new Rng(7);
  const xs = Array.from({ length: 20000 }, () => r.gauss(2, 0.5));
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length);
  assert.ok(Math.abs(mean - 2) < 0.02);
  assert.ok(Math.abs(sd - 0.5) < 0.02);
});
