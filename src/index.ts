import { Evaluator } from './evaluator.js';
import { buildModel } from './model.js';
import { runDiagnosis, structuralPrechecks } from './diagnose.js';
import { buildSchedule } from './schedule.js';
import { randomSkeleton, solve } from './solver.js';
import { Rng } from './rng.js';
import { validateInput } from './validate-input.js';
import type { ScheduleInput, ScheduleResult } from './types.js';

export interface GenerateOptions {
  /** 主编排时间预算（毫秒），默认 9000，保证整体在 10 秒内返回 */
  timeBudgetMs?: number;
  /** 冲突诊断里每个松弛探针的预算（毫秒），默认 500 */
  probeBudgetMs?: number;
  /** 是否在主搜索失败时自动跑冲突诊断，默认 true */
  diagnoseOnFailure?: boolean;
  seed?: number;
}

/**
 * 编排入口：校验输入 → 结构性预检 → 模拟退火主搜索 →（失败时）冲突诊断。
 */
export function generateSchedule(
  input: ScheduleInput,
  opts: GenerateOptions = {},
): ScheduleResult {
  const start = Date.now();
  const timeBudgetMs = opts.timeBudgetMs ?? 9000;
  const probeBudgetMs = opts.probeBudgetMs ?? 500;
  const seed = opts.seed ?? input.seed ?? 20260815;

  const inputErrors = validateInput(input);
  if (inputErrors.length > 0) {
    throw new Error(`输入数据不合法：\n- ${inputErrors.join('\n- ')}`);
  }

  const model = buildModel(input);

  // 1. 结构性预检：数学上必然无解的冲突直接返回，不浪费搜索时间
  const structural = structuralPrechecks(input, model);
  if (structural.length > 0) {
    return {
      feasible: false,
      violations: structural,
      elapsedMs: Date.now() - start,
      iterations: 0,
      hardViolationCounts: countByType(structural),
      diagnosis: {
        structural,
        relaxationProbes: [],
        minimalRelaxFamilies: [],
        hints: [
          '以上为输入层面的确定性冲突（容量不足），必须修改输入数据后才能编排，' +
            '例如释放球场占用轮、增加周末轮或调整同城分组。',
        ],
      },
    };
  }

  // 2. 主搜索（多重启联合求解：朝向 CSP + 轮次定向交换）
  const rng = new Rng(seed);
  const skeleton = randomSkeleton(model.n, model.half, model.slots, rng);
  const outcome = solve(model, {
    timeBudgetMs,
    seed: seed + 1,
    initialState: skeleton,
  });

  const evaluator = new Evaluator(model);
  evaluator.materialize(outcome.state.positions, outcome.state.roundOrder, outcome.state.orientation);
  const violations = evaluator.collectViolations();
  // 无论是否零硬违规都产出最优努力赛程，供策划查看与手动微调
  const schedule = buildSchedule(model, evaluator, input.leagueName, input.season);

  if (outcome.feasible) {
    return {
      feasible: true,
      schedule,
      violations,
      elapsedMs: Date.now() - start,
      iterations: outcome.iterations,
      hardViolationCounts: outcome.score.counts,
    };
  }

  // 3. 搜索失败：松弛探针定位冲突条件族
  const result: ScheduleResult = {
    feasible: false,
    schedule,
    violations,
    elapsedMs: Date.now() - start,
    iterations: outcome.iterations,
    hardViolationCounts: outcome.score.counts,
  };
  if (opts.diagnoseOnFailure !== false) {
    result.diagnosis = runDiagnosis(model, {
      probeBudgetMs,
      seed: seed + 100,
    });
  }
  return result;
}

function countByType(violations: { type: string }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of violations) out[v.type] = (out[v.type] ?? 0) + 1;
  return out;
}

export * from './types.js';
export { validateInput } from './validate-input.js';
export { validateSchedule, applyEdit, checkStructure } from './editor.js';
export {
  exportResultJson,
  exportScheduleJson,
  exportMatchesCsv,
  exportTeamMatrixCsv,
} from './export.js';
export { familyLabel, structuralPrechecks, runDiagnosis } from './diagnose.js';
