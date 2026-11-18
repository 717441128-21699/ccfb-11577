import { describe, expect, it } from 'vitest';
import { generateSchedule } from '../src/index.js';
import type { ScheduleInput } from '../src/types.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const infeasible: ScheduleInput = JSON.parse(
  readFileSync(resolve('data/infeasible-input.json'), 'utf8'),
);

describe('冲突诊断', () => {
  it('容量不足在预检阶段确定性地识别，且不进入搜索', () => {
    const result = generateSchedule(infeasible, { timeBudgetMs: 1000 });
    expect(result.feasible).toBe(false);
    expect(result.iterations).toBe(0);
    expect(result.diagnosis).toBeDefined();
    const messages = result.violations.map((v) => v.message).join('\n');
    expect(messages).toContain('红都');
    expect(messages).toContain('19 个主场');
  });

  it('同城三队必然冲突的预检', () => {
    const input: ScheduleInput = JSON.parse(
      readFileSync(resolve('data/sample-input.json'), 'utf8'),
    );
    // 把第三支球队塞进红都同城
    input.teams[2]!.cityId = 'city_red';
    const result = generateSchedule(input, { timeBudgetMs: 1000 });
    expect(result.feasible).toBe(false);
    const types = result.violations.map((v) => v.type);
    expect(types).toContain('city_home_conflict');
  });

  it('输入引用错误直接抛异常', () => {
    const input: ScheduleInput = JSON.parse(
      readFileSync(resolve('data/sample-input.json'), 'utf8'),
    );
    input.teams[0]!.stadiumId = 'std_not_exist';
    expect(() => generateSchedule(input)).toThrow(/不合法/);
  });

  it('诊断 hints 指出最小松弛方向（松弛探针）', () => {
    const input: ScheduleInput = JSON.parse(
      readFileSync(resolve('data/sample-input.json'), 'utf8'),
    );
    // 制造搜索期冲突：让一支球队的主场在所有周末轮都被占用，且它有德比
    const team = input.teams.find((t) => t.id === 'team_crimson_fc')!;
    const stadium = input.stadiums.find((s) => s.id === team.stadiumId)!;
    stadium.blockedRounds = input.rounds.filter((r) => r.isWeekend).map((r) => r.round);
    const result = generateSchedule(input, {
      timeBudgetMs: 1500,
      probeBudgetMs: 300,
      seed: 5,
    });
    expect(result.feasible).toBe(false);
    expect(result.diagnosis!.hints.length).toBeGreaterThan(0);
  });
});
