import type { Program, SkillDecl, BuffDecl } from '../lang/ast';
import { parseSource } from '../lang/compiler';
import { BattleEngine } from './battle';
import { Interpreter } from './interpreter';
import type { BattleConfig, UnitRef, UnitSpec, SSValue } from './types';
import { DEFAULT_CONFIG } from './types';

export interface LoadedPrograms {
  skills: Map<string, SkillDecl>;
  buffs: Map<string, BuffDecl>;
}

/** 把多份 SkillScript 源码解析成技能/buff 定义表，重名直接报错。 */
export function loadPrograms(sources: { name: string; source: string }[]): LoadedPrograms {
  const skills = new Map<string, SkillDecl>();
  const buffs = new Map<string, BuffDecl>();
  for (const { name, source } of sources) {
    const result = parseSource(source);
    if (!result.ok || !result.program) {
      const err = result.errors[0];
      throw new Error(`[${name}] ${err.full}`);
    }
    for (const decl of result.program.decls) {
      if (decl.kind === 'SkillDecl') {
        if (skills.has(decl.name)) throw new Error(`技能 "${decl.name}" 在多个脚本中重复定义`);
        skills.set(decl.name, decl);
      } else {
        if (buffs.has(decl.name)) throw new Error(`buff "${decl.name}" 在多个脚本中重复定义`);
        buffs.set(decl.name, decl);
      }
    }
  }
  return { skills, buffs };
}

export interface CastOrder {
  casterId: string;
  skillName: string;
  targetId: string;
}

export interface BattleResult {
  engine: BattleEngine;
  interpreter: Interpreter;
  winnerTeam: number | null;
}

/** 战斗门面：建引擎、装解释器、按指令施法，返回完整引擎与 trace 供调试/断言。 */
export function runBattle(
  unitSpecs: UnitSpec[],
  programs: LoadedPrograms,
  casts: CastOrder[],
  configOverrides: Partial<BattleConfig> = {},
): BattleResult {
  const config: BattleConfig = { ...DEFAULT_CONFIG, ...configOverrides };
  const engine = new BattleEngine(unitSpecs, programs, config);
  const merged: Program = {
    kind: 'Program',
    decls: [...programs.skills.values(), ...programs.buffs.values()],
  };
  const interpreter = new Interpreter(engine, merged, { captureTrace: true });
  engine.startBattle();

  for (const cast of casts) {
    const caster = engine.requireUnit(cast.casterId);
    if (!caster.alive) continue;
    const skill = programs.skills.get(cast.skillName);
    if (!skill) throw new Error(`未知技能：${cast.skillName}`);
    const target = engine.requireUnit(cast.targetId);
    engine.log('cast', `${caster.spec.name} 施放 ${skill.name}，目标 ${target.spec.name}`);
    const context: Record<string, SSValue> = {
      caster: { __unit: true, id: cast.casterId } as UnitRef,
      target: { __unit: true, id: cast.targetId } as UnitRef,
      self: { __unit: true, id: cast.casterId } as UnitRef,
    };
    interpreter.runSkill(skill, context);
    if (engine.isOver()) break;
  }

  const aliveTeams = new Set([...engine.units.values()].filter((u) => u.alive).map((u) => u.spec.team));
  return { engine, interpreter, winnerTeam: aliveTeams.size === 1 ? [...aliveTeams][0] : null };
}
