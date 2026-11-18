/**
 * 生成示例输入：
 *   data/sample-input.json      —— 可编排的 20 队场景
 *   data/infeasible-input.json  —— 故意制造容量冲突的不可行场景
 * 运行：npx tsx scripts/make-sample.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ScheduleInput, Stadium, Team } from '../src/types.js';

interface CitySpec {
  city: string;
  prefix: string;
  teams: Array<{ suffix: string; euro?: boolean; blocked?: number[] }>;
}

// 20 队 = 2 个同城配对（4 队，覆盖同城互补约束）+ 16 个独立城市
// 真实联赛中同城队通常只有极少数几对；配对越多朝向 XOR 图越连通、联合可行域越窄
const CITY_SPECS: CitySpec[] = [
  { city: 'city_red', prefix: 'Crimson', teams: [{ suffix: 'FC', euro: true }, { suffix: 'United' }] },
  { city: 'city_blue', prefix: 'Azure', teams: [{ suffix: 'City', euro: true }, { suffix: 'Wanderers' }] },
  { city: 'city_gold', prefix: 'Golden', teams: [{ suffix: 'Athletic', euro: true }] },
  { city: 'city_green', prefix: 'Emerald', teams: [{ suffix: 'Town' }] },
  { city: 'city_onyx', prefix: 'Onyx', teams: [{ suffix: 'SC' }] },
  { city: 'city_pearl', prefix: 'Pearl', teams: [{ suffix: 'Dynamo' }] },
  { city: 'city_violet', prefix: 'Violet', teams: [{ suffix: 'Real' }] },
  { city: 'city_amber', prefix: 'Amber', teams: [{ suffix: 'Kings' }] },
  { city: 'city_teal', prefix: 'Teal', teams: [{ suffix: 'Harbor' }] },
  { city: 'city_silver', prefix: 'Silver', teams: [{ suffix: 'Lakeside' }] },
  { city: 'city_coral', prefix: 'Coral', teams: [{ suffix: 'Rangers' }] },
  { city: 'city_ivory', prefix: 'Ivory', teams: [{ suffix: 'Sporting' }] },
  { city: 'city_indigo', prefix: 'Indigo', teams: [{ suffix: 'Deportivo' }] },
  { city: 'city_jade', prefix: 'Jade', teams: [{ suffix: 'Legion' }] },
  { city: 'city_cobalt', prefix: 'Cobalt', teams: [{ suffix: 'Mariners' }] },
  { city: 'city_bronze', prefix: 'Bronze', teams: [{ suffix: 'Peak' }] },
  { city: 'city_ruby', prefix: 'Ruby', teams: [{ suffix: 'Rovers' }] },
  { city: 'city_slate', prefix: 'Slate', teams: [{ suffix: 'Albion' }] },
];

const TEAM_NAMES = [
  '红都', '红联', '蓝城', '蓝游', '金竞技', '金流浪',
  '翠镇', '翠宾', '曜石', '珍珠迪纳摩', '紫罗兰皇家', '琥珀君王',
  '青港', '银湖', '珊瑚骑兵', '象牙体育', '靛蓝拉科', '翡翠军团',
  '钴蓝海员', '青铜峰',
];

function buildTeamsAndStadiums(forceInfeasible: boolean): { teams: Team[]; stadiums: Stadium[] } {
  const teams: Team[] = [];
  const stadiums: Stadium[] = [];
  let nameIdx = 0;
  // 常规场景的演唱会占用：按球队 id 指定
  const normalBlocked: Record<string, number[]> = {
    team_crimson_fc: [5, 18],
    team_azure_city: [12],
  };

  CITY_SPECS.forEach((spec) => {
    spec.teams.forEach((t, ti) => {
      const id = `team_${spec.prefix.toLowerCase()}_${t.suffix.toLowerCase()}`;
      const stadiumId = `std_${spec.prefix.toLowerCase()}_${ti}`;
      const blocked = forceInfeasible && id === 'team_crimson_fc'
        ? // 不可行场景：红都主场占用 22 轮，只剩 16 轮可放 19 个主场
          Array.from({ length: 22 }, (_, i) => i + 1)
        : (t.blocked ?? normalBlocked[id] ?? []);

      teams.push({
        id,
        name: TEAM_NAMES[nameIdx++]!,
        stadiumId,
        cityId: spec.city,
        european: t.euro === true,
      });
      stadiums.push({
        id: stadiumId,
        name: `${spec.prefix} ${t.suffix} Stadium`,
        blockedRounds: blocked,
      });
    });
  });

  return { teams, stadiums };
}

function buildRounds(): ScheduleInput['rounds'] {
  // 38 轮：周六/周日为周末轮，穿插周中杯赛轮；欧战周中标记在部分周末轮前后
  const rounds = [];
  const start = new Date('2026-08-15T00:00:00Z');
  for (let i = 0; i < 38; i++) {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + i * 7);
    const isWeekend = i % 3 !== 2; // 每逢第 3、6、9... 轮为周中轮
    rounds.push({
      round: i + 1,
      date: date.toISOString().slice(0, 10),
      isWeekend,
      // 第 8、14、22、30 轮所在周有欧冠/欧联周中赛
      hasEuropeanMidweek: [7, 13, 21, 29].includes(i),
    });
  }
  return rounds;
}

function buildInput(forceInfeasible: boolean): ScheduleInput {
  const { teams, stadiums } = buildTeamsAndStadiums(forceInfeasible);
  const rounds = buildRounds();
  const derbies = [
    // 红都 vs 红联：两回合都要周末（同城德比）
    { homeTeamId: 'team_crimson_fc', awayTeamId: 'team_crimson_united', bothLegs: true },
    // 蓝城 vs 蓝游：只要求一回合周末（同城德比）
    { homeTeamId: 'team_azure_city', awayTeamId: 'team_azure_wanderers', bothLegs: false },
    // 金竞技 vs 红宝石流浪者：跨城德比，一回合周末
    { homeTeamId: 'team_golden_athletic', awayTeamId: 'team_ruby_rovers', bothLegs: false },
    // 跨城德比：翠镇 vs 曜石，只要求一回合周末
    { homeTeamId: 'team_emerald_town', awayTeamId: 'team_onyx_sc', bothLegs: false },
    // 跨城德比：紫罗兰皇家 vs 琥珀君王，只要求一回合周末
    { homeTeamId: 'team_violet_real', awayTeamId: 'team_amber_kings', bothLegs: false },
  ];
  return {
    leagueName: forceInfeasible ? 'Infeasible Demo League' : 'Demo Premier League',
    season: '2026-27',
    teams,
    stadiums,
    rounds,
    derbies,
    seed: 42,
  };
}

mkdirSync(resolve('data'), { recursive: true });
writeFileSync('data/sample-input.json', JSON.stringify(buildInput(false), null, 2), 'utf8');
writeFileSync('data/infeasible-input.json', JSON.stringify(buildInput(true), null, 2), 'utf8');
console.log('已生成 data/sample-input.json 与 data/infeasible-input.json');
