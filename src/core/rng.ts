// 再現できる乱数（mulberry32）。同じ seed なら同じ試合になる。

export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  /** 途中から続けるための内部の状態。 */
  get state(): number {
    return this.s;
  }

  set state(v: number) {
    this.s = v >>> 0;
  }

  /** 0 以上 1 未満。 */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  /** 正規分布（Box-Muller）。 */
  gauss(mean = 0, sd = 1): number {
    const u = 1 - this.next();
    const v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }

  /** 重み付きで1つ選ぶ。 */
  weighted<T>(items: readonly { value: T; weight: number }[]): T {
    const total = items.reduce((s, i) => s + i.weight, 0);
    let r = this.next() * total;
    for (const i of items) {
      r -= i.weight;
      if (r < 0) return i.value;
    }
    return items[items.length - 1].value;
  }
}
