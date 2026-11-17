/**
 * 确定性随机数：mulberry32。
 * 相同种子产生完全相同的序列，保证战斗结果可复现、可对账。
 */
export class SeededRng {
  private state: number;

  constructor(public seed: number) {
    this.state = seed >>> 0;
  }

  /** [0, 1) 浮点。 */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** 概率判定：p 的概率返回 true。 */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** [min, max] 闭区间整数。 */
  randInt(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }
}
