import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  applyEdit,
  exportMatchesCsv,
  exportResultJson,
  exportScheduleJson,
  exportTeamMatrixCsv,
  generateSchedule,
  validateSchedule,
} from './index.js';
import type { ScheduleEdit } from './types.js';

function usage(): never {
  console.error(`用法:
  generate <input.json> [--out <目录>] [--time <毫秒>] [--seed <整数>]
  validate <input.json> <schedule.json>
  edit     <input.json> <schedule.json> <edit.json> [--out <目录>]

edit.json 示例:
  {"kind":"swapRounds","roundA":3,"roundB":7}
  {"kind":"flipVenue","round":5,"matchIndexOrTeamId":"team_eagles"}
  {"kind":"swapHomes","round":2,"matchAIndexOrTeamId":0,"matchBIndexOrTeamId":3}`);
  process.exit(1);
}

function parseArgs(argv: string[]): { positional: string[]; flags: Map<string, string> } {
  const positional: string[] = [];
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      flags.set(a.slice(2), argv[i + 1]!);
      i++;
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function writeOut(dir: string, name: string, content: string): string {
  const path = resolve(dir, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
  return path;
}

function main(): void {
  const [command, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseArgs(rest);

  if (command === 'generate') {
    const inputPath = positional[0];
    if (!inputPath) usage();
    const input = JSON.parse(readFileSync(inputPath, 'utf8'));
    const result = generateSchedule(input, {
      timeBudgetMs: Number(flags.get('time') ?? 9000),
      seed: flags.has('seed') ? Number(flags.get('seed')) : undefined,
    });
    console.log(`编排完成，耗时 ${result.elapsedMs}ms，迭代 ${result.iterations} 次`);

    if (!result.feasible) {
      console.log('\n❌ 未能排出零硬违规赛程。违规明细：');
      for (const v of result.violations) console.log(`  [${v.severity}] ${v.message}`);
      if (result.diagnosis) {
        console.log('\n冲突诊断：');
        for (const h of result.diagnosis.hints) console.log(`  - ${h}`);
        if (result.diagnosis.minimalRelaxFamilies.length > 0) {
          console.log(
            `  最小松弛集：${result.diagnosis.minimalRelaxFamilies.join('、')}`,
          );
        }
      }
    } else {
      const hard = result.violations.filter((v) => v.severity === 'hard');
      const soft = result.violations.filter((v) => v.severity === 'soft');
      console.log(`✅ 成功：硬违规 ${hard.length} 处，软违规 ${soft.length} 处`);
      if (soft.length > 0) {
        console.log('软违规（优化质量提示，不阻塞使用）：');
        for (const v of soft.slice(0, 10)) console.log(`  - ${v.message}`);
        if (soft.length > 10) console.log(`  ... 其余 ${soft.length - 10} 条见 JSON 导出`);
      }
    }

    if (flags.has('out')) {
      const dir = flags.get('out')!;
      const p1 = writeOut(dir, 'result.json', exportResultJson(result));
      console.log(`\n已写出 ${p1}`);
      if (result.schedule) {
        const p2 = writeOut(dir, 'schedule.json', exportScheduleJson(result.schedule));
        const p3 = writeOut(dir, 'matches.csv', exportMatchesCsv(result.schedule));
        const p4 = writeOut(dir, 'team-matrix.csv', exportTeamMatrixCsv(result.schedule));
        console.log(`已写出 ${p2}`);
        console.log(`已写出 ${p3}`);
        console.log(`已写出 ${p4}`);
      }
    }
    process.exit(result.feasible ? 0 : 2);
  }

  if (command === 'validate') {
    const [inputPath, schedulePath] = positional;
    if (!inputPath || !schedulePath) usage();
    const input = JSON.parse(readFileSync(inputPath, 'utf8'));
    const schedule = JSON.parse(readFileSync(schedulePath, 'utf8'));
    const violations = validateSchedule(input, schedule);
    const hard = violations.filter((v) => v.severity === 'hard');
    if (violations.length === 0) {
      console.log('✅ 赛程合规，无任何违规');
    } else {
      console.log(`共 ${violations.length} 条违规（硬 ${hard.length} / 软 ${violations.length - hard.length}）：`);
      for (const v of violations) console.log(`  [${v.severity}] ${v.message}`);
    }
    process.exit(hard.length === 0 ? 0 : 2);
  }

  if (command === 'edit') {
    const [inputPath, schedulePath, editPath] = positional;
    if (!inputPath || !schedulePath || !editPath) usage();
    const input = JSON.parse(readFileSync(inputPath, 'utf8'));
    const schedule = JSON.parse(readFileSync(schedulePath, 'utf8'));
    const edit = JSON.parse(readFileSync(editPath, 'utf8')) as ScheduleEdit;
    const { schedule: next, violations } = applyEdit(input, schedule, edit);
    const hard = violations.filter((v) => v.severity === 'hard');
    console.log(`编辑完成，即时校验：${violations.length} 条违规（硬 ${hard.length} / 软 ${violations.length - hard.length}）`);
    for (const v of violations) console.log(`  [${v.severity}] ${v.message}`);
    if (flags.has('out')) {
      const dir = flags.get('out')!;
      const p = writeOut(dir, 'schedule-edited.json', exportScheduleJson(next));
      console.log(`已写出 ${p}`);
    }
    process.exit(hard.length === 0 ? 0 : 2);
  }

  usage();
}

main();
