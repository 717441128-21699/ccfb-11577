import { Evaluator } from './evaluator.js';
import { HARD_FAMILIES } from './evaluator.js';
import type { ProblemModel } from './model.js';
import { solve } from './solver.js';
import type {
  ConflictDiagnosis,
  RelaxationProbe,
  ScheduleInput,
  Violation,
} from './types.js';

const FAMILY_LABEL: Record<string, string> = {
  stadium_blocked: '球场演唱会占用',
  stadium_double_booking: '同球场一轮双赛',
  city_home_conflict: '同城球队同轮主场',
  three_consecutive_away: '禁止连续三个客场',
  derby_not_weekend: '德比必须在周末',
};

export function familyLabel(family: string): string {
  return FAMILY_LABEL[family] ?? family;
}

/**
 * 结构性预检：只报告"数学上必然无解"的冲突，保证零误报。
 * 这类冲突不需要搜索即可定位，直接告诉策划改哪条输入。
 */
export function structuralPrechecks(
  input: ScheduleInput,
  model: ProblemModel,
): Violation[] {
  const out: Violation[] = [];
  const { n, half, totalRounds } = model;

  // 1. 球场容量：每队主场恰好 half 场，可用轮次不足则必无解
  for (let t = 0; t < n; t++) {
    const stadium = model.stadiumOfTeam[t]!;
    let blocked = 0;
    const blockedRoundList: number[] = [];
    for (let r = 0; r < totalRounds; r++) {
      if (model.blocked[stadium * totalRounds + r] === 1) {
        blocked++;
        blockedRoundList.push(r + 1);
      }
    }
    const available = totalRounds - blocked;
    if (available < half) {
      out.push({
        type: 'stadium_blocked',
        severity: 'hard',
        message:
          `${model.teamNames[t]} 的主场 ${model.stadiumNames[stadium]} 全季仅 ${available} 轮可用，` +
          `但需要安排 ${half} 个主场（占用轮次：${blockedRoundList.join('、')}）`,
        rounds: blockedRoundList,
        stadiumId: model.stadiumIds[stadium],
        teamIds: [model.teamIds[t]!],
      });
    }

    // 连续 3 轮占用 => 该队必然三连客
    let run = 0;
    for (let r = 0; r < totalRounds; r++) {
      if (model.blocked[stadium * totalRounds + r] === 1) {
        run++;
        if (run === 3) {
          out.push({
            type: 'three_consecutive_away',
            severity: 'hard',
            message:
              `${model.teamNames[t]} 的主场 ${model.stadiumNames[stadium]} 在第 ${r - 1}-${r + 1} 轮连续被占用，` +
              '该队将被迫连续三个客场，与硬约束冲突',
            rounds: [r - 1, r, r + 1],
            stadiumId: model.stadiumIds[stadium],
            teamIds: [model.teamIds[t]!],
          });
          break;
        }
      } else {
        run = 0;
      }
    }
  }

  // 2. 同城球队 >=3 支：每轮至多 1 支主场，38 轮容纳不下 3*19 个主场需求
  const cityMembers = new Map<number, number[]>();
  for (let t = 0; t < n; t++) {
    const c = model.cityOfTeam[t]!;
    const list = cityMembers.get(c) ?? [];
    list.push(t);
    cityMembers.set(c, list);
  }
  for (const [city, members] of cityMembers) {
    if (members.length >= 3) {
      out.push({
        type: 'city_home_conflict',
        severity: 'hard',
        message:
          `城市 ${model.cityIds[city]} 有 ${members.length} 支球队（${members
            .map((t) => model.teamNames[t])
            .join('、')}），每轮至多 1 支主场，全季主场容量不足，必然冲突`,
        teamIds: members.map((t) => model.teamIds[t]!),
      });
    }
  }

  // 3. 德比对周末轮的容量要求
  let weekendRounds = 0;
  for (let r = 0; r < totalRounds; r++) {
    if (model.weekend[r] === 1) weekendRounds++;
  }
  const derbyLoad = new Map<number, number>();
  for (const d of model.derbyList) {
    if (weekendRounds < (d.bothLegs ? 2 : 1)) {
      out.push({
        type: 'derby_not_weekend',
        severity: 'hard',
        message:
          `德比 ${model.teamNames[d.a]} vs ${model.teamNames[d.b]} 需要 ` +
          `${d.bothLegs ? '2 个（两回合）' : '1 个'}周末轮，但全季只有 ${weekendRounds} 个周末轮`,
        teamIds: [model.teamIds[d.a]!, model.teamIds[d.b]!],
      });
    }
    const inc = d.bothLegs ? 2 : 1;
    derbyLoad.set(d.a, (derbyLoad.get(d.a) ?? 0) + inc);
    derbyLoad.set(d.b, (derbyLoad.get(d.b) ?? 0) + inc);

    // 每支德比球队还要在"自家球场未被占用"的周末轮里主场作战
    for (const [team, needHome] of [
      [d.a, 1],
      [d.b, 1],
    ] as const) {
      const stadium = model.stadiumOfTeam[team]!;
      let openWeekend = 0;
      const blockedWeekendList: number[] = [];
      for (let r = 0; r < totalRounds; r++) {
        if (model.weekend[r] !== 1) continue;
        if (model.blocked[stadium * totalRounds + r] === 1) {
          blockedWeekendList.push(r + 1);
        } else {
          openWeekend++;
        }
      }
      if (openWeekend < needHome) {
        out.push({
          type: 'derby_not_weekend',
          severity: 'hard',
          message:
            `${model.teamNames[team]} 需要在周末轮主场踢德比，但其主场 ${model.stadiumNames[stadium]} ` +
            `的周末轮全部被占用（${blockedWeekendList.join('、')}），无可用周末主场`,
          rounds: blockedWeekendList,
          stadiumId: model.stadiumIds[stadium],
          teamIds: [model.teamIds[team]!],
        });
      }
    }
  }
  for (const [team, load] of derbyLoad) {
    if (load > weekendRounds) {
      out.push({
        type: 'derby_not_weekend',
        severity: 'hard',
        message:
          `${model.teamNames[team]} 涉及 ${load} 个德比赛次需要落在周末轮，但全季只有 ${weekendRounds} 个周末轮`,
        teamIds: [model.teamIds[team]!],
      });
    }
  }

  return out;
}

export interface DiagnosisOptions {
  /** 单个探针的时间预算（毫秒） */
  probeBudgetMs?: number;
  seed?: number;
}

/**
 * 松弛探针诊断：逐族（再逐对）关闭硬约束做短预算搜索，
 * 找出"移除哪几条约束后其余条件可满足"，定位互相冲突的条件族。
 */
export function runDiagnosis(
  model: ProblemModel,
  opts: DiagnosisOptions = {},
): ConflictDiagnosis {
  const probeBudget = opts.probeBudgetMs ?? 600;
  const probes: RelaxationProbe[] = [];
  const feasibleSets: string[][] = [];

  const runProbe = (families: string[]): RelaxationProbe => {
    const outcome = solve(model, {
      timeBudgetMs: probeBudget,
      seed: (opts.seed ?? 1) + families.join(',').length * 7919,
      disabledFamilies: new Set(families),
    });
    const probe: RelaxationProbe = {
      relaxedFamilies: families,
      feasible: outcome.feasible,
      remainingCounts: Object.fromEntries(
        HARD_FAMILIES.filter((f) => !families.includes(f)).map((f) => [
          f,
          outcome.score.counts[f] ?? 0,
        ]),
      ),
    };
    probes.push(probe);
    if (outcome.feasible) feasibleSets.push(families);
    return probe;
  };

  // 先逐族探针
  for (const f of HARD_FAMILIES) runProbe([f]);

  // 单族松弛无解则尝试两两组合（5 选 2 共 10 组）
  if (feasibleSets.length === 0) {
    for (let i = 0; i < HARD_FAMILIES.length; i++) {
      for (let j = i + 1; j < HARD_FAMILIES.length; j++) {
        const fi = HARD_FAMILIES[i]!;
        const fj = HARD_FAMILIES[j]!;
        runProbe([fi, fj]);
      }
    }
  }

  // 最小可满足松弛集：优先族数最少，再按名称排序保证稳定
  feasibleSets.sort((a, b) => a.length - b.length || a.join().localeCompare(b.join()));
  const minimalRelaxFamilies = feasibleSets[0] ?? [];

  const hints: string[] = [];
  if (minimalRelaxFamilies.length > 0) {
    hints.push(
      `放宽「${minimalRelaxFamilies.map(familyLabel).join('」「')}」后，其余硬约束可以满足。` +
        '请调整对应输入（如减少演唱会占用、增加周末轮、重新划分同城），或与策划确认豁免规则。',
    );
  } else {
    hints.push(
      '即使两两放宽硬约束仍无法在短时间内排通，可能存在多组条件同时冲突；' +
        '建议先处理预检报告中的容量问题，再减少同一轮上的叠加限制后重试。',
    );
  }

  // 附带当前瓶颈：在不做任何松弛的短搜索里，剩余违规最多的族
  const baseline = solve(model, {
    timeBudgetMs: probeBudget,
    seed: opts.seed ?? 1,
  });
  const bottlenecks = Object.entries(baseline.score.counts)
    .filter(([k, v]) => HARD_FAMILIES.includes(k as (typeof HARD_FAMILIES)[number]) && v > 0)
    .sort((a, b) => b[1] - a[1]);
  if (bottlenecks.length > 0) {
    hints.push(
      '当前最优解里剩余违规最多的约束：' +
        bottlenecks.map(([k, v]) => `${familyLabel(k)}（${v} 处）`).join('、'),
    );
  }

  return {
    structural: [],
    relaxationProbes: probes,
    minimalRelaxFamilies,
    hints,
  };
}

/** 便捷封装：对已物化赛程做一次完整违规扫描 */
export function violationsOf(evaluator: Evaluator): Violation[] {
  return evaluator.collectViolations();
}
