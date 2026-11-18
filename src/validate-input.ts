import type { ScheduleInput } from './types.js';

/**
 * 输入引用/结构校验。只做"数据本身写错了"的检查；
 * 条件之间互相冲突（排不出来）的分析在 diagnose 模块里做。
 */
export function validateInput(input: ScheduleInput): string[] {
  const errors: string[] = [];
  const n = input.teams.length;

  if (n < 4 || n % 2 !== 0) {
    errors.push(`球队数量必须是 >=4 的偶数，当前为 ${n}`);
  }

  const teamIds = new Set<string>();
  for (const t of input.teams) {
    if (teamIds.has(t.id)) errors.push(`球队 ID 重复：${t.id}`);
    teamIds.add(t.id);
  }

  const stadiumIds = new Set<string>();
  for (const s of input.stadiums) {
    if (stadiumIds.has(s.id)) errors.push(`球场 ID 重复：${s.id}`);
    stadiumIds.add(s.id);
  }

  for (const t of input.teams) {
    if (!stadiumIds.has(t.stadiumId)) {
      errors.push(`球队 ${t.id} 引用了不存在的球场：${t.stadiumId}`);
    }
  }

  const expectedRounds = 2 * (n - 1);
  if (input.rounds.length !== expectedRounds) {
    errors.push(
      `${n} 队双循环需要恰好 ${expectedRounds} 轮日历，当前提供了 ${input.rounds.length} 轮`,
    );
  }
  const roundNos = new Set<number>();
  for (const r of input.rounds) {
    if (roundNos.has(r.round)) errors.push(`轮次号重复：${r.round}`);
    roundNos.add(r.round);
  }
  for (let i = 1; i <= expectedRounds; i++) {
    if (!roundNos.has(i)) errors.push(`缺少第 ${i} 轮的日历信息`);
  }

  for (const s of input.stadiums) {
    for (const b of s.blockedRounds ?? []) {
      if (b < 1 || b > expectedRounds) {
        errors.push(`球场 ${s.id} 的占用轮次 ${b} 超出范围 [1, ${expectedRounds}]`);
      }
    }
  }

  for (const d of input.derbies ?? []) {
    if (!teamIds.has(d.homeTeamId)) {
      errors.push(`德比引用了不存在的球队：${d.homeTeamId}`);
    }
    if (!teamIds.has(d.awayTeamId)) {
      errors.push(`德比引用了不存在的球队：${d.awayTeamId}`);
    }
    if (d.homeTeamId === d.awayTeamId) {
      errors.push('德比的两支球队不能相同');
    }
  }

  return errors;
}
