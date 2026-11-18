import { Evaluator, type EvalScore } from './evaluator.js';
import type { ProblemModel } from './model.js';
import { solveOrientationCsp } from './orientation-csp.js';
import { Rng } from './rng.js';

export interface SolverOptions {
  timeBudgetMs: number;
  /** 骨架重启次数上限（与墙钟先到为准）；固定后同 seed 结果可复现 */
  maxIterations?: number;
  seed?: number;
  disabledFamilies?: ReadonlySet<string>;
  initialState?: SolverState;
}

export interface SolverState {
  positions: Int16Array;
  roundOrder: Int16Array;
  /** 长度 totalRounds*slots，两个半程独立朝向 */
  orientation: Uint8Array;
}

export interface SolverOutcome {
  state: SolverState;
  score: EvalScore;
  iterations: number;
  elapsedMs: number;
  feasible: boolean;
  cspFailures: number;
}

function lexBetter(a: EvalScore, b: EvalScore): boolean {
  if (a.hardTotal !== b.hardTotal) return a.hardTotal < b.hardTotal;
  return a.softTotal < b.softTotal;
}

export function randomSkeleton(n: number, half: number, slots: number, rng: Rng): SolverState {
  const positions = new Int16Array(n);
  for (let i = 0; i < n; i++) positions[i] = i;
  const roundOrder = new Int16Array(half);
  for (let i = 0; i < half; i++) roundOrder[i] = i;
  shuffleTyped(positions, rng);
  shuffleTyped(roundOrder, rng);
  return { positions, roundOrder, orientation: new Uint8Array(2 * half * slots) };
}

function shuffleTyped(arr: Int16Array, rng: Rng): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rng.int(0, i + 1);
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
}

export function cloneState(s: SolverState): SolverState {
  return {
    positions: new Int16Array(s.positions),
    roundOrder: new Int16Array(s.roundOrder),
    orientation: new Uint8Array(s.orientation),
  };
}

export function copyState(from: SolverState, to: SolverState): void {
  to.positions.set(from.positions);
  to.roundOrder.set(from.roundOrder);
  to.orientation.set(from.orientation);
}

/**
 * 多重启联合求解。
 *
 * 每个骨架迭代三类等效力移动，均不破坏圆环法保证的双循环赛制：
 *   1. 朝向移动（solveOrientationCsp）：消三连客/城市/占用，保持同城互补；
 *   2. 轮次定向交换：把含非周末德比的实际轮换到周末日历槽；
 *   3. 换骨架重启：换球队/轮次排列后重新构造，跳出局部极小。
 * 轮次交换后重新跑朝向优化，使主客落位适配新日历。词序评分（硬违规优先）。
 */
export function solve(model: ProblemModel, opts: SolverOptions): SolverOutcome {
  const start = Date.now();
  const rng = new Rng(opts.seed ?? 1);
  const { half, slots } = model;

  const evaluator = new Evaluator(model);
  if (opts.disabledFamilies) evaluator.disabledFamilies = new Set(opts.disabledFamilies);
  const evaluate = (s: SolverState): EvalScore => {
    evaluator.materialize(s.positions, s.roundOrder, s.orientation);
    return evaluator.score();
  };

  let best: SolverState | null = null;
  let bestScore: EvalScore | null = null;
  let cspFailures = 0;
  let iterations = 0;

  const remember = (s: SolverState, sc: EvalScore): void => {
    if (!bestScore || lexBetter(sc, bestScore)) {
      best = cloneState(s);
      bestScore = sc;
    }
  };

  const weekendRounds: number[] = [];
  for (let rp = 0; rp < half; rp++) if (model.weekend[rp] === 1) weekendRounds.push(rp);

  /** 找含非周末德比的实际轮（前半程索引） */
  const derbyBadRounds = (state: SolverState): number[] => {
    evaluator.materialize(state.positions, state.roundOrder, state.orientation);
    const bad: number[] = [];
    for (let rp = 0; rp < half; rp++) {
      if (model.weekend[rp] === 1) continue;
      const base = rp * slots * 2;
      outer: for (let s = 0; s < slots; s++) {
        const h = evaluator.matchTeams[base + s * 2]!;
        const a = evaluator.matchTeams[base + s * 2 + 1]!;
        const lo = h < a ? h : a;
        const hi = h < a ? a : h;
        for (const d of model.derbyList) {
          if (lo === d.a && hi === d.b) {
            bad.push(rp);
            break outer;
          }
        }
      }
    }
    return bad;
  };

  const swapRound = (state: SolverState, i: number, j: number): void => {
    const tmp = state.roundOrder[i]!;
    state.roundOrder[i] = state.roundOrder[j]!;
    state.roundOrder[j] = tmp;
  };

  // 绝对截止时间，所有内层循环以此为硬边界
  const hardDeadline = start + opts.timeBudgetMs;
  const pastDeadline = (): boolean => Date.now() >= hardDeadline;

  // 骨架重启上限：与墙钟先到为准。固定上限保证同 seed 随机序列确定、结果可复现
  const maxSkeletons = opts.maxIterations ?? 12;
  let skeletonCount = 0;

  // 迭代驱动保证可复现：朝向 CSP 主要靠迭代上限终止，墙钟仅作外层硬保护
  const initialOrientationMaxIter = 12000;
  const refineMaxIter = 1500;

  while (!pastDeadline() && skeletonCount < maxSkeletons) {
    iterations++;
    skeletonCount++;

    // ---- 1. 骨架 + 朝向构造 ----
    const skeleton: SolverState =
      best === null && opts.initialState
        ? cloneState(opts.initialState)
        : randomSkeleton(model.n, half, slots, rng);
    const csp = solveOrientationCsp(
      model,
      skeleton,
      rng,
      Math.max(200, hardDeadline - Date.now()),
      initialOrientationMaxIter,
    );
    if (!csp.ok) cspFailures++;
    let current = skeleton;
    let currentScore = evaluate(current);
    remember(current, currentScore);

    // ---- 2. 联合迭代：轮次定向交换 -> 朝向重新适配 ----
    const jointSteps = 4;
    for (let step = 0; step < jointSteps && !pastDeadline(); step++) {
      iterations++;
      const bad = derbyBadRounds(current);

      if (bad.length > 0 && weekendRounds.length > 0) {
        // 枚举坏轮 x 周末轮（限量采样控制成本），选硬违规净减最多的交换
        const i = bad[rng.int(0, bad.length)]!;
        let bestJ = -1;
        let bestSwapScore: EvalScore | null = null;
        const sampleSize = Math.min(weekendRounds.length, 8);
        for (let k = 0; k < sampleSize; k++) {
          const j = weekendRounds[rng.int(0, weekendRounds.length)]!;
          if (j === i) continue;
          swapRound(current, i, j);
          const sc = evaluate(current);
          swapRound(current, i, j);
          if (!bestSwapScore || lexBetter(sc, bestSwapScore)) {
            bestSwapScore = sc;
            bestJ = j;
          }
        }
        if (bestJ >= 0 && bestSwapScore && lexBetter(bestSwapScore, currentScore)) {
          swapRound(current, i, bestJ);
          currentScore = bestSwapScore;
        }
      } else {
        // 德比已满足：随机轮次横移，仅接受不劣化
        const i = rng.int(0, half);
        let j = rng.int(0, half);
        if (j === i) j = (j + 1) % half;
        swapRound(current, i, j);
        const sc = evaluate(current);
        if (lexBetter(sc, currentScore) || rng.next() < 0.1) {
          currentScore = sc;
        } else {
          swapRound(current, i, j);
        }
      }

      // ---- 3. 轮次变了，朝向重新适配新日历（迭代驱动，硬截止保护） ----
      const refine = solveOrientationCsp(
        model,
        current,
        rng,
        Math.max(100, hardDeadline - Date.now()),
        refineMaxIter,
      );
      if (!refine.ok) cspFailures++;
      currentScore = evaluate(current);
      remember(current, currentScore);

      if (bestScore!.hardTotal === 0 && bestScore!.softTotal === 0) break;
    }

    if (bestScore!.hardTotal === 0 && bestScore!.softTotal === 0) break;
  }

  evaluator.materialize(best!.positions, best!.roundOrder, best!.orientation);
  const finalScore = evaluator.score();
  return {
    state: best!,
    score: finalScore,
    iterations,
    elapsedMs: Date.now() - start,
    feasible: finalScore.hardTotal === 0,
    cspFailures,
  };
}
