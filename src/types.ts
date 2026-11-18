/**
 * 赛程编排工具的输入 / 输出类型定义
 *
 * 轮次编号约定：1 ~ 38（双循环共 2*(N-1) 轮）。
 */

/** 球队定义 */
export interface Team {
  /** 球队唯一 ID，如 "team_arsenal" */
  id: string;
  /** 展示名 */
  name: string;
  /** 主场球场 ID，对应 stadiums[].id */
  stadiumId: string;
  /** 同城分组 ID，同一 cityId 的球队视为同城（共用球迷/安保/交通资源） */
  cityId: string;
  /** 是否参加欧战（需要周末前后留休息，软约束） */
  european?: boolean;
}

/** 球场定义 */
export interface Stadium {
  id: string;
  name: string;
  /** 被演唱会等占用的轮次（1 起始），这些轮次该球场不能安排联赛主场比赛 */
  blockedRounds?: number[];
}

/** 每一轮的日历信息 */
export interface RoundInfo {
  /** 轮次号，1 起始 */
  round: number;
  /** 该轮比赛日期，ISO 日期字符串，如 "2026-08-15" */
  date: string;
  /** true=周末轮，false=周中轮；德比必须落在周末轮 */
  isWeekend: boolean;
  /** true=该轮的周中（或紧邻周中）有欧战比赛，欧战球队前后需要休息 */
  hasEuropeanMidweek?: boolean;
}

/** 德比（需要安排在周末的对阵） */
export interface Derby {
  /** 任意顺序的两支球队 ID */
  homeTeamId: string;
  awayTeamId: string;
  /** 要求两回合都在周末（默认 true）；设为 false 则只要求第一回合 */
  bothLegs?: boolean;
}

/** 编排工具的完整输入 */
export interface ScheduleInput {
  /** 联赛名称 */
  leagueName: string;
  /** 赛季标签，如 "2026-27" */
  season: string;
  teams: Team[];
  stadiums: Stadium[];
  rounds: RoundInfo[];
  derbies?: Derby[];
  /** 随机种子，传入后结果可复现 */
  seed?: number;
}

/** 一场已编排的比赛 */
export interface Match {
  /** 轮次号，1 起始 */
  round: number;
  /** 比赛日期（取自 rounds[].date） */
  date: string;
  homeTeamId: string;
  awayTeamId: string;
  stadiumId: string;
  /** 该轮是否为周末轮 */
  isWeekend: boolean;
  /** 是否为德比（输入里声明过的对阵，两个方向都算） */
  isDerby: boolean;
}

/** 完整赛程：按轮次组织，每轮 N/2 场 */
export interface Schedule {
  leagueName: string;
  season: string;
  /** 球队数 */
  teamCount: number;
  /** 总轮次数 */
  totalRounds: number;
  rounds: ScheduledRound[];
}

export interface ScheduledRound {
  round: number;
  date: string;
  isWeekend: boolean;
  hasEuropeanMidweek: boolean;
  matches: Match[];
}

/** 违规严重程度 */
export type Severity = 'hard' | 'soft';

/** 违规类型，硬约束必须清零，软约束用于评估编排质量 */
export type ViolationType =
  // ---- 硬约束 ----
  | 'stadium_blocked'        // 球场在被占用的轮次排了主场
  | 'stadium_double_booking' // 同一球场同一轮排了两场
  | 'city_home_conflict'     // 同城球队同一轮都在主场
  | 'three_consecutive_away' // 连续三个客场
  | 'derby_not_weekend'      // 德比赛事未安排在周末
  // ---- 软约束 ----
  | 'europe_travel_strain'   // 欧战球队在欧战周前后连客
  | 'home_away_not_alternating' // 主客未尽量交替（连续同主/同客，三连客另计硬违规）
  | 'half_balance';          // 每半程主场数与理想值偏差

export interface Violation {
  type: ViolationType;
  severity: Severity;
  /** 给策划看的中文说明 */
  message: string;
  /** 涉及的轮次（1 起始，可能多个） */
  rounds?: number[];
  /** 涉及的球队 ID */
  teamIds?: string[];
  /** 涉及的球场 ID */
  stadiumId?: string;
}

/** 编排结果 */
export interface ScheduleResult {
  /** 是否在预算内找到零硬违规的解 */
  feasible: boolean;
  /** 最优努力赛程；结构性预检失败（输入容量冲突）时缺失，其余情况始终返回 */
  schedule?: Schedule;
  /** 当前最优解上的全部违规（feasible=true 时只剩软违规） */
  violations: Violation[];
  /** 排程耗时（毫秒） */
  elapsedMs: number;
  /** 搜索迭代次数 */
  iterations: number;
  /** 不可行 / 难可行时的冲突诊断信息 */
  diagnosis?: ConflictDiagnosis;
  /** 各约束族（硬约束）在最优解上的剩余违规数，便于观察瓶颈 */
  hardViolationCounts: Record<string, number>;
}

/** 冲突诊断：说明是哪几条条件互相冲突 */
export interface ConflictDiagnosis {
  /** 预检阶段就能确定的结构性冲突（容量/引用类，无需搜索） */
  structural: Violation[];
  /**
   * 松弛探针结果：移除某个约束族后，其余硬约束能否在短预算内满足。
   * 用于定位"搜索失败时是哪几条条件在打架"。
   */
  relaxationProbes: RelaxationProbe[];
  /** 推断出的最小冲突约束族集合（移除这些族后问题可解） */
  minimalRelaxFamilies: string[];
  /** 给策划的中文行动建议 */
  hints: string[];
}

export interface RelaxationProbe {
  /** 被松弛（暂时关闭）的约束族名 */
  relaxedFamilies: string[];
  /** 短预算搜索后是否零硬违规 */
  feasible: boolean;
  /** 剩余硬违规数（按族统计） */
  remainingCounts: Record<string, number>;
}

/** 手动编辑请求：交换两个完整轮次的比赛日期/顺序 */
export interface SwapRoundsEdit {
  kind: 'swapRounds';
  roundA: number;
  roundB: number;
}

/** 手动编辑请求：翻转某一轮某场比赛的主客场 */
export interface FlipVenueEdit {
  kind: 'flipVenue';
  round: number;
  /** 该轮内的比赛序号（0 起始）或任一球队 ID */
  matchIndexOrTeamId: number | string;
}

/** 手动编辑请求：同一轮内两场比赛交换主队身份（客队不动） */
export interface SwapHomesEdit {
  kind: 'swapHomes';
  round: number;
  matchAIndexOrTeamId: number | string;
  matchBIndexOrTeamId: number | string;
}

export type ScheduleEdit = SwapRoundsEdit | FlipVenueEdit | SwapHomesEdit;
