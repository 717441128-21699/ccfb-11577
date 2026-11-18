/**
 * 确定性伪随机数生成器（mulberry32）。
 * 传入相同 seed 时，整个编排过程可完全复现——方便策划回归对比与线上问题重放。
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    // 避免 0 状态退化
    this.state = seed >>> 0 || 0x9e3779b9;
  }

  /** 返回 [0, 1) 的浮点数 */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** 返回 [min, max) 的整数 */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min));
  }

  /** Fisher–Yates 原地洗牌 */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(0, i + 1);
      const tmp = arr[i]!;
      arr[i] = arr[j]!;
      arr[j] = tmp;
    }
    return arr;
  }
}
