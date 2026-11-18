import type { Evaluator } from './evaluator.js';
import type { ProblemModel } from './model.js';
import type { Schedule, ScheduledRound } from './types.js';

/** 把评估器里已物化的 TypedArray 赛程转成对外的对象结构 */
export function buildSchedule(
  model: ProblemModel,
  evaluator: Evaluator,
  leagueName: string,
  season: string,
): Schedule {
  const { n, totalRounds, slots } = model;
  const rounds: ScheduledRound[] = [];

  for (let r = 0; r < totalRounds; r++) {
    const matches = [];
    for (let s = 0; s < slots; s++) {
      const base = r * slots * 2;
      const home = evaluator.matchTeams[base + s * 2]!;
      const away = evaluator.matchTeams[base + s * 2 + 1]!;
      const stadium = evaluator.homeStadium[r * slots + s]!;
      const lo = home < away ? home : away;
      const hi = home < away ? away : home;
      matches.push({
        round: r + 1,
        date: model.dates[r]!,
        homeTeamId: model.teamIds[home]!,
        awayTeamId: model.teamIds[away]!,
        stadiumId: model.stadiumIds[stadium]!,
        isWeekend: model.weekend[r] === 1,
        isDerby: model.derbyPair[lo * n + hi] === 1,
      });
    }
    rounds.push({
      round: r + 1,
      date: model.dates[r]!,
      isWeekend: model.weekend[r] === 1,
      hasEuropeanMidweek: model.euroMidweek[r] === 1,
      matches,
    });
  }

  return {
    leagueName,
    season,
    teamCount: n,
    totalRounds,
    rounds,
  };
}
