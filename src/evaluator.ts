import { circleSlotTeams, type ProblemModel } from './model.js';
import type { Violation, ViolationType } from './types.js';

/** 硬约束权重：任何一个硬违规都压过所有软违规之和 */
export const HARD_WEIGHT = 1000;

/** 软约束权重 */
export const SOFT_WEIGHTS = {
  homeAwayAlternation: 1,
  europeTravelStrain: 4,
  halfBalance: 2,
} as const;

/** 按约束族统计的违规计数（键见 familyKey） */
export type FamilyCounts = Record<string, number>;

export interface EvalScore {
  total: number;
  hardTotal: number;
  softTotal: number;
  counts: FamilyCounts;
}

/** 全部约束族的固定顺序，诊断/探针按此族名开关 */
export const HARD_FAMILIES = [
  'stadium_blocked',
  'stadium_double_booking',
  'city_home_conflict',
  'three_consecutive_away',
  'derby_not_weekend',
] as const;

export type HardFamily = (typeof HARD_FAMILIES)[number];

export function familyKey(type: ViolationType): string {
  return type;
}

/**
 * 求解热循环用的评估器。所有缓冲区预分配、复用，
 * 一次评估只做 O(N*R) 的 TypedArray 读写（20 队时约 3~5k 次操作）。
 */
export class Evaluator {
  private readonly m: ProblemModel;
  private readonly n: number;
  private readonly half: number;
  private readonly totalRounds: number;
  private readonly slots: number;

  /** venue[team * totalRounds + r]：+1 主场 / -1 客场 */
  readonly venue: Int8Array;
  /** homeStadiumByRound[r * slots + s]：该场主队的球场下标 */
  readonly homeStadium: Int16Array;
  /** matchTeamByRound[r * slots*2 + s*2 + {0,1}]：主、客队下标 */
  readonly matchTeams: Int16Array;
  private readonly pair: [number, number] = [0, 0];

  /** 被禁用的硬约束族（诊断探针用） */
  disabledFamilies = new Set<string>();

  constructor(model: ProblemModel) {
    this.m = model;
    this.n = model.n;
    this.half = model.half;
    this.totalRounds = model.totalRounds;
    this.slots = model.slots;
    this.venue = new Int8Array(this.n * this.totalRounds);
    this.homeStadium = new Int16Array(this.totalRounds * this.slots);
    this.matchTeams = new Int16Array(this.totalRounds * this.slots * 2);
  }

  private enabled(type: HardFamily): boolean {
    return !this.disabledFamilies.has(type);
  }

  /**
   * 把搜索状态物化为完整赛程矩阵。
   * positions  : 球队圆环排列（长度 n 的排列）
   * roundOrder : 前半程轮次排列（长度 half 的排列）
   * orientation: 朝向数组，长度 totalRounds*slots，前半程 half*slots + 后半程 half*slots，
   *              两个半程独立决定主客（圆环法保证对阵结构，朝向只决定谁主场）。
   */
  materialize(
    positions: ArrayLike<number>,
    roundOrder: ArrayLike<number>,
    orientation: ArrayLike<number>,
  ): void {
    const { n, half, totalRounds, slots } = this;
    this.venue.fill(0);

    for (let rp = 0; rp < half; rp++) {
      const k = roundOrder[rp]!; // 取基础圆环的第 k 轮
      for (let s = 0; s < slots; s++) {
        circleSlotTeams(k, s, positions, n, this.pair);
        let home = this.pair[0]!;
        let away = this.pair[1]!;
        if (orientation[rp * slots + s] === 1) {
          const tmp = home;
          home = away;
          away = tmp;
        }
        // 前半程
        this.writeMatch(rp, s, home, away, this.m.stadiumOfTeam[home]!);

        // 后半程：同一对球队再次对阵，朝向独立决定（不再强制镜像）
        let home2 = this.pair[0]!;
        let away2 = this.pair[1]!;
        if (orientation[(half + rp) * slots + s] === 1) {
          const tmp = home2;
          home2 = away2;
          away2 = tmp;
        }
        this.writeMatch(half + rp, s, home2, away2, this.m.stadiumOfTeam[home2]!);
      }
    }
  }

  private writeMatch(
    r: number,
    s: number,
    home: number,
    away: number,
    stadium: number,
  ): void {
    const { totalRounds, slots } = this;
    this.venue[home * totalRounds + r] = 1;
    this.venue[away * totalRounds + r] = -1;
    const base = r * slots + s;
    this.homeStadium[base] = stadium;
    this.matchTeams[base * 2] = home;
    this.matchTeams[base * 2 + 1] = away;
  }

  /** 只算分数（求解器热路径，零对象分配） */
  score(): EvalScore {
    const counts: FamilyCounts = {};
    for (const f of HARD_FAMILIES) counts[f] = 0;
    counts.home_away_not_alternating = 0;
    counts.europe_travel_strain = 0;
    counts.half_balance = 0;

    this.scoreStadiums(counts);
    this.scoreCities(counts);
    this.scoreTeamSequences(counts);
    this.scoreDerbies(counts);

    let hardTotal = 0;
    for (const f of HARD_FAMILIES) hardTotal += counts[f]!;
    const softTotal =
      counts.home_away_not_alternating! * SOFT_WEIGHTS.homeAwayAlternation +
      counts.europe_travel_strain! * SOFT_WEIGHTS.europeTravelStrain +
      counts.half_balance! * SOFT_WEIGHTS.halfBalance;

    return {
      total: hardTotal * HARD_WEIGHT + softTotal,
      hardTotal,
      softTotal,
      counts,
    };
  }

  private scoreStadiums(counts: FamilyCounts): void {
    const { totalRounds, slots } = this;
    const checkBlocked = this.enabled('stadium_blocked');
    const checkDouble = this.enabled('stadium_double_booking');
    const stadiumCount = this.m.stadiumIds.length;
    const seen = new Int16Array(stadiumCount);

    for (let r = 0; r < totalRounds; r++) {
      const baseRound = r * slots;
      for (let s = 0; s < slots; s++) {
        const stadium = this.homeStadium[baseRound + s]!;
        if (checkBlocked && this.m.blocked[stadium * totalRounds + r] === 1) {
          counts.stadium_blocked = counts.stadium_blocked! + 1;
        }
        if (checkDouble) {
          seen[stadium] = seen[stadium]! + 1;
          // 同球场第 2、3... 场都算一次双订违规
          if (seen[stadium]! > 1) {
            counts.stadium_double_booking = counts.stadium_double_booking! + 1;
          }
        }
      }
      seen.fill(0);
    }
  }

  private scoreCities(counts: FamilyCounts): void {
    if (!this.enabled('city_home_conflict')) return;
    const { n, totalRounds } = this;
    const cityCount = this.m.cityIds.length;
    const homeCount = new Int16Array(cityCount);

    for (let r = 0; r < totalRounds; r++) {
      for (let t = 0; t < n; t++) {
        if (this.venue[t * totalRounds + r] === 1) {
          const c = this.m.cityOfTeam[t]!;
          homeCount[c] = homeCount[c]! + 1;
          if (homeCount[c]! === 2) {
            counts.city_home_conflict = counts.city_home_conflict! + 1;
          }
        }
      }
      homeCount.fill(0);
    }
  }

  private scoreTeamSequences(counts: FamilyCounts): void {
    const { n, totalRounds, half } = this;
    const checkThreeAway = this.enabled('three_consecutive_away');
    const idealHomePerHalf = half / 2;

    for (let t = 0; t < n; t++) {
      const row = t * totalRounds;
      let firstHalfHome = 0;
      for (let r = 0; r < half; r++) {
        if (this.venue[row + r] === 1) firstHalfHome++;
      }
      counts.half_balance =
        counts.half_balance! + Math.abs(firstHalfHome - idealHomePerHalf);

      for (let r = 0; r + 2 < totalRounds; r++) {
        if (
          checkThreeAway &&
          this.venue[row + r] === -1 &&
          this.venue[row + r + 1] === -1 &&
          this.venue[row + r + 2] === -1
        ) {
          counts.three_consecutive_away = counts.three_consecutive_away! + 1;
        }
      }

      // 软约束：相邻两轮主客不交替的次数（三连客在硬约束里另计，这里仍计软分）
      for (let r = 0; r + 1 < totalRounds; r++) {
        if (this.venue[row + r] === this.venue[row + r + 1]) {
          counts.home_away_not_alternating =
            counts.home_away_not_alternating! + 1;
        }
      }

      if (this.m.isEuropean[t] === 1) {
        for (let r = 0; r < totalRounds; r++) {
          if (this.m.euroMidweek[r] !== 1) continue;
          // 情形 A：欧战周的联赛轮本身是客场，且下一轮继续客场
          if (
            this.venue[row + r] === -1 &&
            r + 1 < totalRounds &&
            this.venue[row + r + 1] === -1
          ) {
            counts.europe_travel_strain = counts.europe_travel_strain! + 1;
          }
          // 情形 B：欧战前一轮已在客场奔波，欧战周联赛又客场
          if (r - 1 >= 0 && this.venue[row + r - 1] === -1 && this.venue[row + r] === -1) {
            counts.europe_travel_strain = counts.europe_travel_strain! + 1;
          }
        }
      }
    }
  }

  private scoreDerbies(counts: FamilyCounts): void {
    if (!this.enabled('derby_not_weekend')) return;
    const { totalRounds, slots } = this;
    for (const d of this.m.derbyList) {
      let weekendHits = 0;
      for (let r = 0; r < totalRounds; r++) {
        const base = r * slots * 2;
        for (let s = 0; s < slots; s++) {
          const h = this.matchTeams[base + s * 2]!;
          const a = this.matchTeams[base + s * 2 + 1]!;
          const lo = h < a ? h : a;
          const hi = h < a ? a : h;
          if (lo === d.a && hi === d.b && this.m.weekend[r] === 1) {
            weekendHits++;
          }
        }
      }
      const required = d.bothLegs ? 2 : 1;
      // 双循环保证该对阵恰好出现两次；缺失的周末名额即违规数
      counts.derby_not_weekend =
        counts.derby_not_weekend! + Math.max(0, required - weekendHits);
    }
  }

  /**
   * 基于当前已物化的赛程，产出给策划看的完整违规明细（含中文说明）。
   * 仅在最终输出 / 手动编辑校验时调用，不在热路径上。
   */
  collectViolations(): Violation[] {
    const out: Violation[] = [];
    const m = this.m;
    const { n, totalRounds, slots } = this;
    const nameOf = (t: number): string => m.teamNames[t]!;

    // 球场占用 & 同球场双赛
    const stadiumCount = m.stadiumIds.length;
    const seen = new Int16Array(stadiumCount);
    for (let r = 0; r < totalRounds; r++) {
      const baseRound = r * slots;
      for (let s = 0; s < slots; s++) {
        const stadium = this.homeStadium[baseRound + s]!;
        seen[stadium] = seen[stadium]! + 1;
        if (m.blocked[stadium * totalRounds + r] === 1) {
          out.push({
            type: 'stadium_blocked',
            severity: 'hard',
            message: `第 ${r + 1} 轮 ${m.stadiumNames[stadium]} 被演唱会等活动占用，不能安排主场比赛`,
            rounds: [r + 1],
            stadiumId: m.stadiumIds[stadium],
          });
        }
      }
      for (let s = 0; s < slots; s++) {
        const stadium = this.homeStadium[baseRound + s]!;
        if (seen[stadium]! >= 2) {
          out.push({
            type: 'stadium_double_booking',
            severity: 'hard',
            message: `第 ${r + 1} 轮 ${m.stadiumNames[stadium]} 同时排了 ${seen[stadium]} 场比赛`,
            rounds: [r + 1],
            stadiumId: m.stadiumIds[stadium],
          });
        }
      }
      seen.fill(0);
    }

    // 同城同轮主场
    const cityCount = m.cityIds.length;
    const homeTeams: number[][] = Array.from({ length: cityCount }, () => []);
    for (let r = 0; r < totalRounds; r++) {
      for (let c = 0; c < cityCount; c++) homeTeams[c]!.length = 0;
      for (let t = 0; t < n; t++) {
        if (this.venue[t * totalRounds + r] === 1) {
          homeTeams[m.cityOfTeam[t]!]!.push(t);
        }
      }
      for (let c = 0; c < cityCount; c++) {
        if (homeTeams[c]!.length >= 2) {
          const ids = homeTeams[c]!;
          out.push({
            type: 'city_home_conflict',
            severity: 'hard',
            message: `第 ${r + 1} 轮同城（${m.cityIds[c]}）球队 ${ids
              .map(nameOf)
              .join('、')} 同时在主场`,
            rounds: [r + 1],
            teamIds: ids.map((t) => m.teamIds[t]!),
          });
        }
      }
    }

    // 球队序列：三连客 / 交替 / 欧战 / 半程均衡
    for (let t = 0; t < n; t++) {
      const row = t * totalRounds;

      for (let r = 0; r + 2 < totalRounds; r++) {
        if (
          this.venue[row + r] === -1 &&
          this.venue[row + r + 1] === -1 &&
          this.venue[row + r + 2] === -1
        ) {
          out.push({
            type: 'three_consecutive_away',
            severity: 'hard',
            message: `${nameOf(t)} 在第 ${r + 1}-${r + 3} 轮连续三个客场`,
            rounds: [r + 1, r + 2, r + 3],
            teamIds: [m.teamIds[t]!],
          });
        }
      }

      for (let r = 0; r + 1 < totalRounds; r++) {
        if (this.venue[row + r] === this.venue[row + r + 1]) {
          const what = this.venue[row + r] === 1 ? '连续主场' : '连续客场';
          out.push({
            type: 'home_away_not_alternating',
            severity: 'soft',
            message: `${nameOf(t)} 第 ${r + 1}、${r + 2} 轮${what}，主客未交替`,
            rounds: [r + 1, r + 2],
            teamIds: [m.teamIds[t]!],
          });
        }
      }

      if (m.isEuropean[t] === 1) {
        for (let r = 0; r < totalRounds; r++) {
          if (m.euroMidweek[r] !== 1) continue;
          if (
            this.venue[row + r] === -1 &&
            r + 1 < totalRounds &&
            this.venue[row + r + 1] === -1
          ) {
            out.push({
              type: 'europe_travel_strain',
              severity: 'soft',
              message: `${nameOf(t)} 第 ${r + 1} 轮欧战周联赛客场后，第 ${r + 2} 轮继续客场，休息不足`,
              rounds: [r + 1, r + 2],
              teamIds: [m.teamIds[t]!],
            });
          }
          if (
            r - 1 >= 0 &&
            this.venue[row + r - 1] === -1 &&
            this.venue[row + r] === -1
          ) {
            out.push({
              type: 'europe_travel_strain',
              severity: 'soft',
              message: `${nameOf(t)} 第 ${r} 轮客场奔波后，第 ${r + 1} 轮欧战周联赛仍是客场`,
              rounds: [r, r + 1],
              teamIds: [m.teamIds[t]!],
            });
          }
        }
      }

      const ideal = this.half / 2;
      let firstHalfHome = 0;
      for (let r = 0; r < this.half; r++) {
        if (this.venue[row + r] === 1) firstHalfHome++;
      }
      if (firstHalfHome !== ideal) {
        out.push({
          type: 'half_balance',
          severity: 'soft',
          message: `${nameOf(t)} 上半程主场 ${firstHalfHome} 场（理想 ${ideal} 场），主客分布不均`,
          rounds: Array.from({ length: this.half }, (_, i) => i + 1),
          teamIds: [m.teamIds[t]!],
        });
      }
    }

    // 德比未在周末
    for (const d of m.derbyList) {
      const badRounds: number[] = [];
      for (let r = 0; r < totalRounds; r++) {
        const base = r * slots * 2;
        for (let s = 0; s < slots; s++) {
          const h = this.matchTeams[base + s * 2]!;
          const a = this.matchTeams[base + s * 2 + 1]!;
          const lo = h < a ? h : a;
          const hi = h < a ? a : h;
          if (lo === d.a && hi === d.b && m.weekend[r] !== 1) {
            badRounds.push(r + 1);
          }
        }
      }
      const required = d.bothLegs ? 2 : 1;
      // 两次出现里落在非周末的次数超过 (2-要求次数)，即周末名额不足
      if (badRounds.length > 2 - required) {
        out.push({
          type: 'derby_not_weekend',
          severity: 'hard',
          message: `${nameOf(d.a)} vs ${nameOf(d.b)} 的德比在第 ${badRounds.join(
            '、',
          )} 轮未安排在周末`,
          rounds: badRounds,
          teamIds: [m.teamIds[d.a]!, m.teamIds[d.b]!],
        });
      }
    }

    return out;
  }
}
