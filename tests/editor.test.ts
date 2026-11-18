import { describe, expect, it } from 'vitest';
import { applyEdit, exportMatchesCsv, exportTeamMatrixCsv, generateSchedule, validateSchedule } from '../src/index.js';
import type { ScheduleInput } from '../src/types.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const input: ScheduleInput = JSON.parse(
  readFileSync(resolve('data/sample-input.json'), 'utf8'),
);

function freshSchedule() {
  const r = generateSchedule(input, { timeBudgetMs: 1500, seed: 99 });
  if (!r.schedule) throw new Error('fixture 排程失败');
  return r.schedule;
}

describe('手动编辑与即时校验', () => {
  it('整轮交换：赛制结构保持，校验可重复运行', () => {
    const schedule = freshSchedule();
    const { schedule: next, violations } = applyEdit(input, schedule, {
      kind: 'swapRounds',
      roundA: 3,
      roundB: 7,
    });
    const hard = violations.filter((v) => v.severity === 'hard');
    // 轮次交换不改变主客/球场关系，只改变它落在哪个日历槽，可能触发占用/周末类硬违规
    // 结构类违规必须始终为零
    const structural = violations.filter((v) =>
      v.message.includes('应对阵 2 次') || v.message.includes('参赛次数异常'),
    );
    expect(structural).toEqual([]);
    // 再次全量校验结果一致
    expect(validateSchedule(input, next)).toEqual(violations);
  });

  it('主客翻转：两回合对阵总数不变，球场随主队切换', () => {
    const schedule = freshSchedule();
    const targetTeam = schedule.rounds[4]!.matches[0]!.homeTeamId;
    const before = schedule.rounds[4]!.matches[0]!;
    const { schedule: next } = applyEdit(input, schedule, {
      kind: 'flipVenue',
      round: 5,
      matchIndexOrTeamId: targetTeam,
    });
    const after = next.rounds[4]!.matches[0]!;
    expect(after.homeTeamId).toBe(before.awayTeamId);
    expect(after.awayTeamId).toBe(before.homeTeamId);
    const expectedStadium = input.teams.find((t) => t.id === after.homeTeamId)!.stadiumId;
    expect(after.stadiumId).toBe(expectedStadium);
    // 原始赛程不被修改
    expect(schedule.rounds[4]!.matches[0]!.homeTeamId).toBe(before.homeTeamId);
  });

  it('同轮 swapHomes：主队互换、客队不动', () => {
    const schedule = freshSchedule();
    const { schedule: next, violations } = applyEdit(input, schedule, {
      kind: 'swapHomes',
      round: 2,
      matchAIndexOrTeamId: 0,
      matchBIndexOrTeamId: 1,
    });
    const r = next.rounds[1]!;
    expect(r.matches[0]!.homeTeamId).toBe(schedule.rounds[1]!.matches[1]!.homeTeamId);
    expect(r.matches[1]!.homeTeamId).toBe(schedule.rounds[1]!.matches[0]!.homeTeamId);
    expect(r.matches[0]!.awayTeamId).toBe(schedule.rounds[1]!.matches[0]!.awayTeamId);
    // 校验确实运行了（返回数组而不是抛错）
    expect(Array.isArray(violations)).toBe(true);
  });

  it('违规编辑能被即时抓到：把比赛翻转到被占用球场', () => {
    const schedule = freshSchedule();
    // 红都主场第 5 轮被占用；找第 5 轮客队为红都的比赛并翻转，使其第 5 轮主场
    const round5 = schedule.rounds[4]!;
    const match = round5.matches.find((m) => m.awayTeamId === 'team_crimson_fc');
    expect(match).toBeDefined();
    const { violations } = applyEdit(input, schedule, {
      kind: 'flipVenue',
      round: 5,
      matchIndexOrTeamId: 'team_crimson_fc',
    });
    const blocked = violations.filter((v) => v.type === 'stadium_blocked');
    expect(blocked.length).toBeGreaterThan(0);
    expect(blocked[0]!.rounds).toContain(5);
  });

  it('非法编辑抛错而不是静默失败', () => {
    const schedule = freshSchedule();
    expect(() =>
      applyEdit(input, schedule, { kind: 'flipVenue', round: 5, matchIndexOrTeamId: 'team_not_exist' }),
    ).toThrow(/找不到/);
    expect(() =>
      applyEdit(input, schedule, { kind: 'swapRounds', roundA: 1, roundB: 99 }),
    ).toThrow(/超出范围/);
  });
});

describe('导出', () => {
  it('CSV 带 BOM、表头与行数正确', () => {
    const schedule = freshSchedule();
    const csv = exportMatchesCsv(schedule);
    expect(csv.startsWith('﻿')).toBe(true);
    const lines = csv.trim().split('\r\n');
    expect(lines).toHaveLength(38 * 10 + 1);
    expect(lines[0]).toBe('轮次,日期,是否周末,主队ID,客队ID,球场ID,是否德比');

    const matrix = exportTeamMatrixCsv(schedule);
    const matrixLines = matrix.trim().split('\r\n');
    expect(matrixLines).toHaveLength(21); // 表头 + 20 队
    expect(matrixLines[1]!.split(',').length).toBe(39); // 球队ID + 38 轮
  });
});
