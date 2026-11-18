import { Evaluator } from './evaluator.js';
import { buildModel, type ProblemModel } from './model.js';
import type { Match, Schedule, ScheduleEdit, ScheduleInput, Violation } from './types.js';

/** 把对象赛程重新装载进 TypedArray 评估器，复用同一套约束检查逻辑 */
function loadEvaluator(model: ProblemModel, schedule: Schedule): Evaluator {
  const ev = new Evaluator(model);
  ev.venue.fill(0);
  const teamIndex = new Map(model.teamIds.map((id, i) => [id, i]));
  const stadiumIndex = new Map(model.stadiumIds.map((id, i) => [id, i]));

  for (const round of schedule.rounds) {
    const r = round.round - 1;
    round.matches.forEach((match, s) => {
      const home = teamIndex.get(match.homeTeamId);
      const away = teamIndex.get(match.awayTeamId);
      const stadium = stadiumIndex.get(match.stadiumId);
      if (home === undefined || away === undefined || stadium === undefined) return;
      const base = r * model.slots + s;
      ev.homeStadium[base] = stadium;
      ev.matchTeams[base * 2] = home;
      ev.matchTeams[base * 2 + 1] = away;
      ev.venue[home * model.totalRounds + r] = 1;
      ev.venue[away * model.totalRounds + r] = -1;
    });
  }
  return ev;
}

/** 赛制结构性检查：双循环完整性、每轮每队恰好一场等 */
export function checkStructure(model: ProblemModel, schedule: Schedule): Violation[] {
  const violations: Violation[] = [];
  const { n, totalRounds, slots } = model;

  if (schedule.rounds.length !== totalRounds) {
    violations.push({
      type: 'stadium_double_booking',
      severity: 'hard',
      message: `赛程应有 ${totalRounds} 轮，实际为 ${schedule.rounds.length} 轮`,
    });
  }

  const pairCount = new Int16Array(n * n);
  const appearances = new Int16Array(n * totalRounds);

  for (const round of schedule.rounds) {
    const r = round.round - 1;
    if (round.matches.length !== slots) {
      violations.push({
        type: 'stadium_double_booking',
        severity: 'hard',
        message: `第 ${round.round} 轮应有 ${slots} 场比赛，实际为 ${round.matches.length} 场`,
        rounds: [round.round],
      });
    }
    const teamsThisRound = new Set<string>();
    for (const m of round.matches) {
      if (m.homeTeamId === m.awayTeamId) {
        violations.push({
          type: 'stadium_double_booking',
          severity: 'hard',
          message: `第 ${round.round} 轮存在球队自己对阵自己的比赛`,
          rounds: [round.round],
        });
      }
      for (const id of [m.homeTeamId, m.awayTeamId]) {
        if (teamsThisRound.has(id)) {
          violations.push({
            type: 'stadium_double_booking',
            severity: 'hard',
            message: `球队 ${id} 在第 ${round.round} 轮参加了多场比赛`,
            rounds: [round.round],
            teamIds: [id],
          });
        }
        teamsThisRound.add(id);
      }

      const h = model.teamIds.indexOf(m.homeTeamId);
      const a = model.teamIds.indexOf(m.awayTeamId);
      if (h >= 0 && a >= 0) {
        appearances[h * totalRounds + r] = appearances[h * totalRounds + r]! + 1;
        appearances[a * totalRounds + r] = appearances[a * totalRounds + r]! + 1;
        const lo = h < a ? h : a;
        const hi = h < a ? a : h;
        pairCount[lo * n + hi] = pairCount[lo * n + hi]! + 1;
      }
    }
  }

  for (let t = 0; t < n; t++) {
    for (let r = 0; r < totalRounds; r++) {
      if (appearances[t * totalRounds + r] !== 1) {
        violations.push({
          type: 'stadium_double_booking',
          severity: 'hard',
          message: `${model.teamNames[t]} 在第 ${r + 1} 轮参赛次数异常（${
            appearances[t * totalRounds + r]
          } 场）`,
          rounds: [r + 1],
          teamIds: [model.teamIds[t]!],
        });
      }
    }
  }

  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      const c = pairCount[a * n + b];
      if (c !== 2) {
        violations.push({
          type: 'stadium_double_booking',
          severity: 'hard',
          message: `${model.teamNames[a]} 与 ${model.teamNames[b]} 应对阵 2 次（主客各一），实际对阵 ${c} 次`,
          teamIds: [model.teamIds[a]!, model.teamIds[b]!],
        });
      }
    }
  }

  return violations;
}

/** 全量校验一份赛程（手动编辑后即时反馈）。硬违规为空即合规。 */
export function validateSchedule(input: ScheduleInput, schedule: Schedule): Violation[] {
  const model = buildModel(input);
  return validateWithModel(model, schedule);
}

export function validateWithModel(
  model: ProblemModel,
  schedule: Schedule,
): Violation[] {
  const structural = checkStructure(model, schedule);
  const evaluator = loadEvaluator(model, schedule);
  return [...structural, ...evaluator.collectViolations()];
}

function cloneSchedule(schedule: Schedule): Schedule {
  return {
    ...schedule,
    rounds: schedule.rounds.map((r) => ({
      ...r,
      matches: r.matches.map((m) => ({ ...m })),
    })),
  };
}

function resolveMatchIndex(round: { round: number; matches: Match[] }, ref: number | string): number {
  if (typeof ref === 'number') {
    if (ref < 0 || ref >= round.matches.length) {
      throw new Error(`比赛序号 ${ref} 超出第 ${round.round} 轮范围`);
    }
    return ref;
  }
  const idx = round.matches.findIndex(
    (m) => m.homeTeamId === ref || m.awayTeamId === ref,
  );
  if (idx < 0) throw new Error(`第 ${round.round} 轮中找不到球队 ${ref} 的比赛`);
  return idx;
}

/**
 * 应用一次手动编辑，返回新赛程（不修改原对象），并立即跑一遍全量校验。
 * 三种编辑都严格保持双循环赛制结构：
 *  - swapRounds  交换两个完整轮次的比赛（轮号/日期槽位不动）
 *  - flipVenue   翻转一场比赛主客场，球场随新主队切换
 *  - swapHomes   同轮两场交换主队身份（客队不动），球场随新主队切换
 */
export function applyEdit(
  input: ScheduleInput,
  schedule: Schedule,
  edit: ScheduleEdit,
): { schedule: Schedule; violations: Violation[] } {
  const model = buildModel(input);
  const stadiumOfTeam = new Map(input.teams.map((t) => [t.id, t.stadiumId]));
  const next = cloneSchedule(schedule);

  if (edit.kind === 'swapRounds') {
    const i = edit.roundA - 1;
    const j = edit.roundB - 1;
    if (i < 0 || j < 0 || i >= next.rounds.length || j >= next.rounds.length) {
      throw new Error(`轮次号超出范围：${edit.roundA} / ${edit.roundB}`);
    }
    const ra = next.rounds[i]!;
    const rb = next.rounds[j]!;
    const matchesA = ra.matches;
    ra.matches = rb.matches.map((m) => ({ ...m, round: ra.round, date: ra.date }));
    rb.matches = matchesA.map((m) => ({ ...m, round: rb.round, date: rb.date }));
  } else {
    const round = next.rounds.find((r) => r.round === edit.round);
    if (!round) throw new Error(`轮次号超出范围：${edit.round}`);

    if (edit.kind === 'flipVenue') {
      const idx = resolveMatchIndex(round, edit.matchIndexOrTeamId);
      const m = round.matches[idx]!;
      const oldHome = m.homeTeamId;
      m.homeTeamId = m.awayTeamId;
      m.awayTeamId = oldHome;
      m.stadiumId = stadiumOfTeam.get(m.homeTeamId)!;
    } else {
      const ia = resolveMatchIndex(round, edit.matchAIndexOrTeamId);
      const ib = resolveMatchIndex(round, edit.matchBIndexOrTeamId);
      if (ia === ib) throw new Error('swapHomes 必须选择两场不同的比赛');
      const ma = round.matches[ia]!;
      const mb = round.matches[ib]!;
      const homeA = ma.homeTeamId;
      ma.homeTeamId = mb.homeTeamId;
      mb.homeTeamId = homeA;
      ma.stadiumId = stadiumOfTeam.get(ma.homeTeamId)!;
      mb.stadiumId = stadiumOfTeam.get(mb.homeTeamId)!;
    }
  }

  return { schedule: next, violations: validateWithModel(model, next) };
}
