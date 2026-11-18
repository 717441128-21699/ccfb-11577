import { describe, expect, it } from 'vitest';
import { circleSlotTeams } from '../src/model.js';

describe('圆环法基础赛程', () => {
  it('单循环内每对球队恰好对阵一次，每轮每队恰好出现一次', () => {
    const n = 20;
    const half = n - 1;
    const slots = n / 2;
    const positions = Array.from({ length: n }, (_, i) => i);
    const pair = new Set<string>();
    const pairBuf: [number, number] = [0, 0];

    for (let k = 0; k < half; k++) {
      const seen = new Set<number>();
      for (let s = 0; s < slots; s++) {
        circleSlotTeams(k, s, positions, n, pairBuf);
        const [a, b] = pairBuf;
        expect(a).not.toBe(b);
        seen.add(a);
        seen.add(b);
        const key = a < b ? `${a}-${b}` : `${b}-${a}`;
        expect(pair.has(key)).toBe(false);
        pair.add(key);
      }
      expect(seen.size).toBe(n);
    }
    expect(pair.size).toBe((n * (n - 1)) / 2);
  });

  it('不同圆环排列下性质仍然成立（求解器会重排 positions）', () => {
    const n = 8;
    const half = n - 1;
    const slots = n / 2;
    const positions = [3, 7, 0, 5, 1, 6, 2, 4];
    const pair = new Set<string>();
    const pairBuf: [number, number] = [0, 0];
    for (let k = 0; k < half; k++) {
      const seen = new Set<number>();
      for (let s = 0; s < slots; s++) {
        circleSlotTeams(k, s, positions, n, pairBuf);
        const [a, b] = pairBuf;
        seen.add(a);
        seen.add(b);
        pair.add(a < b ? `${a}-${b}` : `${b}-${a}`);
      }
      expect(seen.size).toBe(n);
    }
    expect(pair.size).toBe((n * (n - 1)) / 2);
  });
});
