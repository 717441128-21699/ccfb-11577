import type { Schedule, ScheduleResult } from './types.js';

/** 游戏数据表用的完整 JSON（含结果元信息与违规清单） */
export function exportResultJson(result: ScheduleResult): string {
  return JSON.stringify(result, null, 2);
}

/** 仅赛程部分的 JSON */
export function exportScheduleJson(schedule: Schedule): string {
  return JSON.stringify(schedule, null, 2);
}

function csvEscape(value: string | number | boolean): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * 比赛粒度 CSV（每场一行），UTF-8 BOM，Excel 直接打开不乱码。
 * 列：轮次,日期,是否周末,主队,客队,球场ID,是否德比
 */
export function exportMatchesCsv(schedule: Schedule): string {
  const header = ['轮次', '日期', '是否周末', '主队ID', '客队ID', '球场ID', '是否德比'];
  const rows: string[] = [header.join(',')];
  for (const r of schedule.rounds) {
    for (const m of r.matches) {
      rows.push(
        [
          r.round,
          r.date,
          r.isWeekend ? '是' : '否',
          m.homeTeamId,
          m.awayTeamId,
          m.stadiumId,
          m.isDerby ? '是' : '否',
        ]
          .map(csvEscape)
          .join(','),
      );
    }
  }
  return '﻿' + rows.join('\r\n') + '\r\n';
}

/**
 * 球队粒度 CSV（每队一行，主客序列用 H/A 表示），方便策划核对主客交替。
 */
export function exportTeamMatrixCsv(schedule: Schedule): string {
  const teamOrder: string[] = [];
  const homeMap = new Map<string, string[]>();
  for (const r of schedule.rounds) {
    for (const m of r.matches) {
      if (!homeMap.has(m.homeTeamId)) {
        homeMap.set(m.homeTeamId, new Array(schedule.totalRounds).fill(''));
        teamOrder.push(m.homeTeamId);
      }
      if (!homeMap.has(m.awayTeamId)) {
        homeMap.set(m.awayTeamId, new Array(schedule.totalRounds).fill(''));
        teamOrder.push(m.awayTeamId);
      }
      homeMap.get(m.homeTeamId)![r.round - 1] = `H:${m.awayTeamId}`;
      homeMap.get(m.awayTeamId)![r.round - 1] = `A:${m.homeTeamId}`;
    }
  }
  const header = ['球队ID', ...schedule.rounds.map((r) => `R${r.round}`)];
  const rows = [header.join(',')];
  for (const teamId of teamOrder) {
    rows.push([teamId, ...homeMap.get(teamId)!].map(csvEscape).join(','));
  }
  return '﻿' + rows.join('\r\n') + '\r\n';
}
