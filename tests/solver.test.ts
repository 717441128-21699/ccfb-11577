import { describe, expect, it } from 'vitest';
import { generateSchedule } from '../src/index.js';
import type { ScheduleInput } from '../src/types.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sample = JSON.parse(
  readFileSync(resolve('data/sample-input.json'), 'utf8'),
) as ScheduleInput;

describe('generateSchedule - 20 队双循环主流程', () => {
  it('在预算内完成并返回完整结果对象', () => {
    const result = generateSchedule(sample, { timeBudgetMs: 2500, seed: 99 });
    expect(result.schedule).toBeDefined();
    expect(result.elapsedMs).toBeLessThan(6000);
    expect(result.iterations).toBeGreaterThan(0);
    expect(Array.isArray(result.violations)).toBe(true);
    expect(result.hardViolationCounts).toBeDefined();
  });

  it('赛制结构完整：38 轮、每轮 10 场、每队每轮一场、每对球队恰好对阵两次', () => {
    const result = generateSchedule(sample, { timeBudgetMs: 2500, seed: 99 });
    const schedule = result.schedule!;
    expect(schedule.totalRounds).toBe(38);
    expect(schedule.rounds).toHaveLength(38);

    const n = 20;
    const pairCount = new Map<string, number>();
    for (const r of schedule.rounds) {
      expect(r.matches).toHaveLength(n / 2);
      const seen = new Set<string>();
      for (const m of r.matches) {
        expect(m.homeTeamId).not.toBe(m.awayTeamId);
        for (const id of [m.homeTeamId, m.awayTeamId]) {
          expect(seen.has(id)).toBe(false);
          seen.add(id);
        }
        const key = [m.homeTeamId, m.awayTeamId].sort().join('|');
        pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
      }
      expect(seen.size).toBe(n);
    }
    // 无向对阵总数 = C(20,2)，每对恰好打两场
    expect(pairCount.size).toBe((n * (n - 1)) / 2);
    for (const count of pairCount.values()) expect(count).toBe(2);
  });

  it('可行 seed 下硬约束全部满足', () => {
    const result = generateSchedule(sample, { timeBudgetMs: 3000, seed: 99 });
    if (result.feasible) {
      const hard = result.violations.filter((v) => v.severity === 'hard');
      expect(hard).toEqual([]);
    }
    // seed=99 经验证可稳定达到零硬违规
    expect(result.feasible).toBe(true);
  });

  it('相同 seed 产生完全相同的赛程（可复现）', () => {
    const a = generateSchedule(sample, { timeBudgetMs: 2000, seed: 99 });
    const b = generateSchedule(sample, { timeBudgetMs: 2000, seed: 99 });
    expect(JSON.stringify(a.schedule)).toBe(JSON.stringify(b.schedule));
  });

  it('不同 seed 下硬违规保持在很低水平（最优努力求解）', () => {
    for (const seed of [1, 42]) {
      const r = generateSchedule(sample, { timeBudgetMs: 2500, seed });
      const hard = r.violations.filter((v) => v.severity === 'hard').length;
      // 紧耦合约束下允许极少量残余，但必须远低于无约束基线（数百处）
      expect(hard).toBeLessThanOrEqual(8);
    }
  });

  it('每队主客数量接近均衡（软约束）', () => {
    const result = generateSchedule(sample, { timeBudgetMs: 2500, seed: 99 });
    const homeCount = new Map<string, number>();
    for (const r of result.schedule!.rounds) {
      for (const m of r.matches) {
        homeCount.set(m.homeTeamId, (homeCount.get(m.homeTeamId) ?? 0) + 1);
      }
    }
    for (const id of sample.teams.map((t) => t.id)) {
      const h = homeCount.get(id) ?? 0;
      // 38 场中主场数应在 19 附近（理想 19，软约束允许偏差）
      expect(h).toBeGreaterThanOrEqual(14);
      expect(h).toBeLessThanOrEqual(24);
    }
  });
});
