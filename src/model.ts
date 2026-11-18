import type { Derby, ScheduleInput } from './types.js';

/**
 * 索引化后的问题模型。求解热循环里全部用 TypedArray，
 * 避免对象寻址和 GC 压力，保证 10 秒内可跑数十万次评估。
 */
export interface ProblemModel {
  n: number;
  half: number; // 单循环轮数 = n-1
  totalRounds: number; // 2*(n-1)
  slots: number; // 每轮比赛数 = n/2

  teamIds: string[];
  teamNames: string[];
  stadiumIds: string[];
  stadiumNames: string[];
  cityIds: string[];

  /** team -> stadium 下标 */
  stadiumOfTeam: Int16Array;
  /** team -> city 下标 */
  cityOfTeam: Int16Array;
  /** team -> 是否欧战球队 */
  isEuropean: Uint8Array;

  /** 扁平 [stadium * totalRounds + round]，1=该球场该轮被占用 */
  blocked: Uint8Array;
  /** 每轮是否周末轮（0 起始轮下标） */
  weekend: Uint8Array;
  /** 每轮所在周是否有欧战周中比赛 */
  euroMidweek: Uint8Array;
  /** 每轮日期 */
  dates: string[];

  /**
   * 德比标记，扁平 pair key = a*n+b（a<b），1=该无向对阵是德比。
   * 圆环法保证任意无向对阵每半程恰好出现一次。
   */
  derbyPair: Uint8Array;
  derbyList: Array<{ a: number; b: number; bothLegs: boolean }>;
}

export function buildModel(input: ScheduleInput): ProblemModel {
  const n = input.teams.length;
  const half = n - 1;
  const totalRounds = 2 * half;
  const slots = n / 2;

  const teamIds = input.teams.map((t) => t.id);
  const teamNames = input.teams.map((t) => t.name);
  const stadiumIds = input.stadiums.map((s) => s.id);
  const stadiumNames = input.stadiums.map((s) => s.name);

  const teamIndex = new Map(teamIds.map((id, i) => [id, i]));
  const stadiumIndex = new Map(stadiumIds.map((id, i) => [id, i]));

  // city 下标按出现顺序压缩
  const cityMap = new Map<string, number>();
  const cityIds: string[] = [];
  const cityOfTeam = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const cid = input.teams[i]!.cityId;
    let ci = cityMap.get(cid);
    if (ci === undefined) {
      ci = cityIds.length;
      cityMap.set(cid, ci);
      cityIds.push(cid);
    }
    cityOfTeam[i] = ci;
  }

  const stadiumOfTeam = new Int16Array(n);
  const isEuropean = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    stadiumOfTeam[i] = stadiumIndex.get(input.teams[i]!.stadiumId)!;
    isEuropean[i] = input.teams[i]!.european ? 1 : 0;
  }

  const blocked = new Uint8Array(stadiumIds.length * totalRounds);
  for (let si = 0; si < stadiumIds.length; si++) {
    for (const roundOneBased of input.stadiums[si]!.blockedRounds ?? []) {
      blocked[si * totalRounds + (roundOneBased - 1)] = 1;
    }
  }

  const weekend = new Uint8Array(totalRounds);
  const euroMidweek = new Uint8Array(totalRounds);
  const dates = new Array<string>(totalRounds);
  for (const r of input.rounds) {
    const idx = r.round - 1;
    weekend[idx] = r.isWeekend ? 1 : 0;
    euroMidweek[idx] = r.hasEuropeanMidweek ? 1 : 0;
    dates[idx] = r.date;
  }

  const derbyPair = new Uint8Array(n * n);
  const derbyList: ProblemModel['derbyList'] = [];
  const addDerby = (d: Derby) => {
    const a = teamIndex.get(d.homeTeamId)!;
    const b = teamIndex.get(d.awayTeamId)!;
    const [lo, hi] = a < b ? [a, b] : [b, a];
    derbyPair[lo * n + hi] = 1;
    derbyList.push({ a: lo, b: hi, bothLegs: d.bothLegs !== false });
  };
  for (const d of input.derbies ?? []) addDerby(d);

  return {
    n, half, totalRounds, slots,
    teamIds, teamNames, stadiumIds, stadiumNames, cityIds,
    stadiumOfTeam, cityOfTeam, isEuropean,
    blocked, weekend, euroMidweek, dates,
    derbyPair, derbyList,
  };
}

/**
 * 圆环法（circle method）基础赛程。
 *
 * 固定圆环位置 0 的球队，其余球队每轮顺时针轮转一个位置，
 * 每轮按 (i, n-1-i) 对称配对。任意无向对阵在单循环内恰好出现一次。
 *
 * 返回 k 轮 s 槽位上的两支球队（无向，主客由 orientation 状态决定）。
 * 这里不做物理轮转，直接用取模公式定位，方便求解器在"球队排列"状态上复用。
 */
export function circleSlotTeams(
  k: number,
  s: number,
  positions: ArrayLike<number>,
  n: number,
  out: [number, number],
): [number, number] {
  const teamAt = (i: number): number => {
    if (i === 0) return positions[0]!;
    // 位置 1..n-1 的元素经过 k 次右转后的归属
    const idx = 1 + (((i - 1 - k) % (n - 1)) + (n - 1)) % (n - 1);
    return positions[idx]!;
  };
  out[0] = teamAt(s);
  out[1] = teamAt(n - 1 - s);
  return out;
}

/** 无向对阵的 pair key（a < b） */
export function pairKey(a: number, b: number, n: number): number {
  return a < b ? a * n + b : b * n + a;
}
