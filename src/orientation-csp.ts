import { circleSlotTeams, type ProblemModel } from './model.js';
import type { Rng } from './rng.js';
import type { SolverState } from './solver.js';

/**
 * 朝向求解：XOR 构造初始化 + 城市级定向 min-conflicts。
 *
 * 阶段一：每轮把球队主客变量建成 XOR 图（同场相反、同城不互踢相反），
 *   随机极性初始化，数学保证同城零冲突并规避球场占用。
 *
 * 阶段二：最小合法移动是"选定城市 + 轮次，翻转该城市球队所在比赛的主客"。
 *   - 两队不互踢：翻两个独立槽，(H,A)->(A,H)，同城互补严格保持；
 *   - 两队互踢：只翻这一场，主客对调，一主一客仍成立。
 *   每次移动后用 venue 真值强制校验城市不变量；定向选择三连客相关轮次，
 *   min-conflicts + 模拟退火消三连客，停滞则随机重启。
 */
export interface OrientationCspResult {
  ok: boolean;
  iterations: number;
  hardLeft: number;
  reasonCounts: { threeAway: number; blocked: number; city: number; derby: number };
}

export function solveOrientationCsp(
  model: ProblemModel,
  state: SolverState,
  rng: Rng,
  timeBudgetMs = 600,
  maxIterations = Infinity,
): OrientationCspResult {
  const { n, half, slots, totalRounds } = model;
  const deadline = Date.now() + timeBudgetMs;
  const pairBuf: [number, number] = [0, 0];

  const slotTeams: Array<Array<[number, number]>> = [];
  for (let r = 0; r < totalRounds; r++) {
    const k = state.roundOrder[r < half ? r : r - half]!;
    const row: Array<[number, number]> = [];
    for (let s = 0; s < slots; s++) {
      circleSlotTeams(k, s, state.positions, n, pairBuf);
      row.push([pairBuf[0]!, pairBuf[1]!]);
    }
    slotTeams.push(row);
  }

  const work = new Uint8Array(totalRounds * slots);
  const venue: Int8Array[] = Array.from({ length: n }, () => new Int8Array(totalRounds));
  const cityHomeScratch = new Int16Array(model.cityIds.length);

  const slotOf = (r: number, t: number): number => {
    for (let s = 0; s < slots; s++) {
      const [x, y] = slotTeams[r]![s]!;
      if (x === t || y === t) return s;
    }
    return -1;
  };

  const flipSlotWrite = (r: number, s: number): void => {
    const idx = r * slots + s;
    work[idx] = work[idx] === 0 ? 1 : 0;
    const [x, y] = slotTeams[r]![s]!;
    const home = work[idx] === 0 ? x : y;
    const away = home === x ? y : x;
    venue[home]![r] = 1;
    venue[away]![r] = -1;
  };

  // ---------- 阶段一：XOR 构造 ----------
  const initRound = (r: number): void => {
    const row = slotTeams[r]!;
    const slotOfTeam = new Map<number, number>();
    row.forEach(([x, y], s) => {
      slotOfTeam.set(x, s);
      slotOfTeam.set(y, s);
    });
    const adj: Set<number>[] = [];
    for (let t = 0; t < n; t++) adj.push(new Set<number>());
    for (const [x, y] of row) {
      adj[x]!.add(y);
      adj[y]!.add(x);
    }
    for (let t = 0; t < n; t++) {
      for (let u = t + 1; u < n; u++) {
        if (model.cityOfTeam[t] !== model.cityOfTeam[u]) continue;
        if (slotOfTeam.get(t) === slotOfTeam.get(u)) continue;
        adj[t]!.add(u);
        adj[u]!.add(t);
      }
    }
    const compOf = new Int16Array(n).fill(-1);
    const xor = new Int8Array(n);
    const groups: number[][] = [];
    for (let t = 0; t < n; t++) {
      if (compOf[t] !== -1) continue;
      const cid = groups.length;
      const g: number[] = [];
      const q = [t];
      compOf[t] = cid;
      while (q.length) {
        const cur = q.shift()!;
        g.push(cur);
        for (const nb of adj[cur]!) if (compOf[nb] === -1) {
          compOf[nb] = cid;
          xor[nb] = xor[cur]! ^ 1;
          q.push(nb);
        }
      }
      groups.push(g);
    }
    const assign = (): Int8Array => {
      const homeVar = new Int8Array(n);
      groups.forEach((g) => {
        const anchor = g[0]!;
        const polarity = rng.int(0, 2);
        for (const t of g) homeVar[t] = polarity ^ xor[t]! ^ xor[anchor]!;
      });
      return homeVar;
    };

    let homeVar = assign();
    let blocked = true;
    let guard = 0;
    while (blocked && guard++ < 12) {
      blocked = false;
      for (let s = 0; s < slots; s++) {
        const [x, y] = row[s]!;
        const home = homeVar[x] === 1 ? x : y;
        if (model.blocked[model.stadiumOfTeam[home]! * totalRounds + r] === 1) {
          blocked = true;
          homeVar = assign();
          break;
        }
      }
    }
    for (let s = 0; s < slots; s++) {
      const [x, y] = row[s]!;
      const xHome = homeVar[x] === 1;
      work[r * slots + s] = xHome ? 0 : 1;
      const home = xHome ? x : y;
      const away = xHome ? y : x;
      venue[home]![r] = 1;
      venue[away]![r] = -1;
    }
  };

  const initialize = (): void => {
    for (const row of venue) row.fill(0);
    for (let r = 0; r < totalRounds; r++) initRound(r);
  };

  // ---------- 计数 ----------
  const countThreeAway = (): number => {
    let c = 0;
    for (let t = 0; t < n; t++) {
      const v = venue[t]!;
      for (let r = 0; r + 2 < totalRounds; r++) {
        if (v[r] === -1 && v[r + 1] === -1 && v[r + 2] === -1) c++;
      }
    }
    return c;
  };

  const cityTeams = new Map<number, number[]>();
  for (let t = 0; t < n; t++) {
    const c = model.cityOfTeam[t]!;
    const l = cityTeams.get(c) ?? [];
    l.push(t);
    cityTeams.set(c, l);
  }
  const cities = [...cityTeams.keys()];

  /** 构造一次城市移动涉及的槽位（含互踢单槽情形） */
  const cityMove = (r: number, t: number): number[] => {
    const cityId = model.cityOfTeam[t]!;
    const teams = cityTeams.get(cityId)!;
    const slotSet = new Set<number>();
    for (const u of teams) {
      const s = slotOf(r, u);
      if (s >= 0) slotSet.add(s); // Set 自动处理互踢同槽
    }
    return [...slotSet];
  };

  const threeAwayConflicts = (): Array<{ r: number; t: number }> => {
    const out: Array<{ r: number; t: number }> = [];
    for (let t = 0; t < n; t++) {
      const v = venue[t]!;
      for (let r = 0; r + 2 < totalRounds; r++) {
        if (v[r] === -1 && v[r + 1] === -1 && v[r + 2] === -1) {
          out.push({ r: r + 1, t });
        }
      }
    }
    return out;
  };

  /** 随机定位一处城市双主违规，返回轮次与其中一个主队 */
  const locateCityViolation = (): { r: number; t: number } | null => {
    const rounds = [...Array(totalRounds).keys()];
    for (let k = 0; k < rounds.length; k++) {
      const r = rounds[(k + rng.int(0, totalRounds)) % totalRounds]!;
      cityHomeScratch.fill(0);
      const homeByCity = new Map<number, number>();
      for (let t = 0; t < n; t++) {
        if (venue[t]![r] !== 1) continue;
        const city = model.cityOfTeam[t]!;
        cityHomeScratch[city] = cityHomeScratch[city]! + 1;
        homeByCity.set(city, t);
        if (cityHomeScratch[city]! >= 2) return { r, t: homeByCity.get(city)! };
      }
    }
    return null;
  };

  const countCity = (): number => {
    let c = 0;
    for (let r = 0; r < totalRounds; r++) {
      cityHomeScratch.fill(0);
      for (let t = 0; t < n; t++) {
        if (venue[t]![r] !== 1) continue;
        const city = model.cityOfTeam[t]!;
        cityHomeScratch[city] = cityHomeScratch[city]! + 1;
        if (cityHomeScratch[city]! === 2) c++;
      }
    }
    return c;
  };

  /**
   * 词序硬惩罚：城市互补为最高优先（结构不变量），其次占用，再次三连客/德比。
   * 用分层权重保证低优先级优化绝不会以牺牲高优先级约束为代价。
   */
  const penalty = (): number => {
    const city = countCity();
    let blocked = 0;
    for (let r = 0; r < totalRounds; r++) {
      for (let s = 0; s < slots; s++) {
        const [x, y] = slotTeams[r]![s]!;
        const home = work[r * slots + s] === 0 ? x : y;
        if (model.blocked[model.stadiumOfTeam[home]! * totalRounds + r] === 1) blocked++;
      }
    }
    let derby = 0;
    for (const d of model.derbyList) {
      let hits = 0;
      for (let r = 0; r < totalRounds; r++) {
        if (model.weekend[r] !== 1) continue;
        for (let s = 0; s < slots; s++) {
          const [x, y] = slotTeams[r]![s]!;
          const lo = x < y ? x : y;
          const hi = x < y ? y : x;
          if (lo === d.a && hi === d.b) hits++;
        }
      }
      derby += Math.max(0, (d.bothLegs ? 2 : 1) - hits);
    }
    const three = countThreeAway();
    // 分层：城市/占用量级远大于下层可能的最大三连客数
    return city * 100_000 + blocked * 10_000 + derby * 1_000 + three;
  };

  // ---------- 阶段二：两阶段退火 ----------
  // 阶段 A：混合邻域，目标 = 三连客 + 城市（等权），快速逼近联合可行域
  // 阶段 B：仅城市配对移动，强制清零城市，且不接受三连客回升
  initialize();
  const phaseAShare = 0.7;
  let currentPenalty = penaltyBalanced();
  let bestPenalty = currentPenalty;
  const bestWork = new Uint8Array(work);
  let iterations = 0;
  let sinceImprove = 0;
  const RESTART = 8000;
  const start = Date.now();

  // 平衡惩罚（阶段 A）：城市与三连客等权，允许互相置换以找到联合低点
  function penaltyBalanced(): number {
    const city = countCity();
    let blocked = 0;
    for (let r = 0; r < totalRounds; r++) {
      for (let s = 0; s < slots; s++) {
        const [x, y] = slotTeams[r]![s]!;
        const home = work[r * slots + s] === 0 ? x : y;
        if (model.blocked[model.stadiumOfTeam[home]! * totalRounds + r] === 1) blocked++;
      }
    }
    let derby = 0;
    for (const d of model.derbyList) {
      let hits = 0;
      for (let r = 0; r < totalRounds; r++) {
        if (model.weekend[r] !== 1) continue;
        for (let s = 0; s < slots; s++) {
          const [x, y] = slotTeams[r]![s]!;
          const lo = x < y ? x : y;
          const hi = x < y ? y : x;
          if (lo === d.a && hi === d.b) hits++;
        }
      }
      derby += Math.max(0, (d.bothLegs ? 2 : 1) - hits);
    }
    return countThreeAway() * 10 + city * 10 + blocked * 10 + derby * 10;
  }

  while (Date.now() < deadline && iterations < maxIterations) {
    iterations++;
    sinceImprove++;
    // 按迭代比例切换阶段，保证同 seed 同迭代上限下结果确定（不依赖墙钟）
    const inPhaseA = iterations < maxIterations * phaseAShare;

    let moveR = rng.int(0, totalRounds);
    let moveSlots: number[];
    const conf = threeAwayConflicts();

    if (inPhaseA) {
      if (conf.length > 0 && rng.next() < 0.7) {
        const c = conf[rng.int(0, conf.length)]!;
        const candidateRounds = [c.r, c.r - 1, c.r + 1].filter(
          (rr) => rr >= 0 && rr < totalRounds,
        );
        moveR = candidateRounds[rng.int(0, candidateRounds.length)]!;
        // 阶段 A 混合：单槽细修与城市配对各半
        moveSlots =
          rng.next() < 0.55 ? [slotOf(moveR, c.t)] : cityMove(moveR, c.t);
      } else if (rng.next() < 0.5) {
        const cityId = cities[rng.int(0, cities.length)]!;
        const anyTeam = cityTeams.get(cityId)![0]!;
        moveSlots = cityMove(moveR, anyTeam);
      } else {
        moveSlots = [rng.int(0, slots)];
      }
    } else {
      // 阶段 B：仅城市配对（保持城市互补），优先针对三连客
      if (conf.length > 0) {
        const c = conf[rng.int(0, conf.length)]!;
        const candidateRounds = [c.r, c.r - 1, c.r + 1].filter(
          (rr) => rr >= 0 && rr < totalRounds,
        );
        moveR = candidateRounds[rng.int(0, candidateRounds.length)]!;
        moveSlots = cityMove(moveR, c.t);
      } else {
        // 三连客已清零：直接定位一个双主轮的违规城市做修复
        const violation = locateCityViolation();
        if (violation) {
          moveR = violation.r;
          // 单槽翻转才能真正改变城市冲突数；配对翻转只在城市间转移
          moveSlots = [slotOf(moveR, violation.t)];
        } else {
          const cityId = cities[rng.int(0, cities.length)]!;
          const anyTeam = cityTeams.get(cityId)![0]!;
          moveSlots = cityMove(moveR, anyTeam);
        }
      }
    }

    if (moveSlots.length === 0 || moveSlots.some((s) => s < 0)) continue;

    // 阶段 B 且三连客已清零：进入纯城市修复，只接受城市严格下降且三连客不回升
    const strictCityRepair = !inPhaseA && conf.length === 0;
    const cityBefore = strictCityRepair ? countCity() : 0;

    if (strictCityRepair) {
      // 枚举该轮所有槽的单槽翻转，选三连客保持零且城市降最多的；找不到再试原移动
      let bestCity = cityBefore;
      let bestSlot = -1;
      for (let s = 0; s < slots; s++) {
        flipSlotWrite(moveR, s);
        const cAfter = countCity();
        const tAfter = countThreeAway();
        flipSlotWrite(moveR, s);
        if (tAfter === 0 && cAfter < bestCity) {
          bestCity = cAfter;
          bestSlot = s;
        }
      }
      if (bestSlot >= 0) {
        flipSlotWrite(moveR, bestSlot);
        currentPenalty = penaltyBalanced();
        if (currentPenalty < bestPenalty) {
          bestPenalty = currentPenalty;
          bestWork.set(work);
          sinceImprove = 0;
        }
      }
      // 无严格改进则跳过（不做会破坏零三连客的横移）
    } else {
      for (const s of moveSlots) flipSlotWrite(moveR, s);
      // 阶段 A 用平衡惩罚；阶段 B（仍有三连客）用词序惩罚
      const trialPenalty = inPhaseA ? penaltyBalanced() : penalty();
      const baseline = currentPenalty;

      const frac = Math.min(1, iterations / maxIterations);
      const temp = (inPhaseA ? 8 : 3) * (1 - frac) + 0.2;
      const accept =
        trialPenalty <= baseline ||
        rng.next() < Math.exp(-(trialPenalty - baseline) / Math.max(temp, 1e-9));

      if (accept) {
        currentPenalty = trialPenalty;
        if (trialPenalty < bestPenalty) {
          bestPenalty = trialPenalty;
          bestWork.set(work);
          sinceImprove = 0;
        }
      } else {
        for (const s of moveSlots) flipSlotWrite(moveR, s);
      }
    }

    if (bestPenalty === 0) break;
    if (sinceImprove >= RESTART) {
      initialize();
      currentPenalty = penaltyBalanced();
      sinceImprove = 0;
      if (currentPenalty < bestPenalty) {
        bestPenalty = currentPenalty;
        bestWork.set(work);
      }
    }
  }

  // 恢复最优并重建 venue
  work.set(bestWork);
  for (const row of venue) row.fill(0);
  for (let r = 0; r < totalRounds; r++) {
    for (let s = 0; s < slots; s++) {
      const [x, y] = slotTeams[r]![s]!;
      const home = work[r * slots + s] === 0 ? x : y;
      const away = home === x ? y : x;
      venue[home]![r] = 1;
      venue[away]![r] = -1;
    }
  }
  state.orientation = new Uint8Array(work);

  const reasonCounts = { threeAway: 0, blocked: 0, city: 0, derby: 0 };
  for (let r = 0; r < totalRounds; r++) {
    cityHomeScratch.fill(0);
    for (let s = 0; s < slots; s++) {
      const [x, y] = slotTeams[r]![s]!;
      const home = work[r * slots + s] === 0 ? x : y;
      if (model.blocked[model.stadiumOfTeam[home]! * totalRounds + r] === 1) reasonCounts.blocked++;
      const city = model.cityOfTeam[home]!;
      cityHomeScratch[city] = cityHomeScratch[city]! + 1;
      if (cityHomeScratch[city]! === 2) reasonCounts.city++;
    }
  }
  reasonCounts.threeAway = countThreeAway();
  for (const d of model.derbyList) {
    let hits = 0;
    for (let r = 0; r < totalRounds; r++) {
      if (model.weekend[r] !== 1) continue;
      for (let s = 0; s < slots; s++) {
        const [x, y] = slotTeams[r]![s]!;
        const lo = x < y ? x : y;
        const hi = x < y ? y : x;
        if (lo === d.a && hi === d.b) hits++;
      }
    }
    reasonCounts.derby += Math.max(0, (d.bothLegs ? 2 : 1) - hits);
  }
  const hardLeft =
    reasonCounts.threeAway + reasonCounts.blocked + reasonCounts.city + reasonCounts.derby;

  return { ok: hardLeft === 0, iterations, hardLeft, reasonCounts };
}
