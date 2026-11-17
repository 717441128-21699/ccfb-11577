import { describe, expect, it } from 'vitest';
import librarySource from '../skills/library.ss?raw';
import edgeSource from '../skills/edge_cases.ss?raw';
import { TriggerDepthError } from '../lang/errors';
import { loadPrograms, runBattle } from '../runtime/runner';
import { DebugController } from '../runtime/debugger';
import type { UnitSpec } from '../runtime/types';
import { makeUnit, standardDuo, trio } from './fixtures';

const programs = loadPrograms([
  { name: 'library', source: librarySource },
  { name: 'edge', source: edgeSource },
]);

/** 取某单位运行时状态。 */
function unitOf(result: ReturnType<typeof runBattle>, id: string) {
  return result.engine.requireUnit(id);
}

function battleWith(units: UnitSpec[], casts: { casterId: string; skillName: string; targetId: string }[], seed = 42) {
  return runBattle(units, programs, casts, { seed });
}

/*
 * 手算基准（standardDuo: hero atk100 def40 火, enemy def40 maxHp500 草）
 * - 元素表：火→草 = 2
 * - 防御折算系数 0.5 → 基础减防项 = def*0.5 = 20
 */
describe('20 个技能：结算结果与手算期望值逐条对账', () => {
  it('01 flame_slash：基础(100-20)*火克草2 = 160；critRate25<50 不暴击', () => {
    const r = battleWith(standardDuo(), [{ casterId: 'hero', skillName: 'flame_slash', targetId: 'enemy' }]);
    // (100 - 40*0.5) * 2 = 160
    expect(unitOf(r, 'enemy').hp).toBe(500 - 160);
  });

  it('01b flame_slash 暴击分支：critRate>=50 时 ×1.5（critDmg50）', () => {
    const units = standardDuo();
    units[0].critRate = 50;
    const r = battleWith(units, [{ casterId: 'hero', skillName: 'flame_slash', targetId: 'enemy' }]);
    // 160 * 1.5 = 240
    expect(unitOf(r, 'enemy').hp).toBe(500 - 240);
    expect(r.engine.logs.some((l) => l.kind === 'crit')).toBe(true);
  });

  it('02 power_strike：满血 100*1.2-20=100；残血(<50%)再×1.3=130', () => {
    const full = battleWith(standardDuo(), [{ casterId: 'hero', skillName: 'power_strike', targetId: 'enemy' }]);
    expect(unitOf(full, 'enemy').hp).toBe(500 - 100);

    const units = standardDuo();
    units[1].hp = 200; // 200/500 = 40% < 50%
    const r = battleWith(units, [{ casterId: 'hero', skillName: 'power_strike', targetId: 'enemy' }]);
    expect(unitOf(r, 'enemy').hp).toBe(200 - 130);
  });

  it('03 heavy_blow：有法力 (160-24)*1.25=170，扣20蓝；无法力 136*0.7=95.2→95', () => {
    const r1 = battleWith(standardDuo(), [{ casterId: 'hero', skillName: 'heavy_blow', targetId: 'enemy' }]);
    // 100*1.6-40*0.6=136; 136*1.25=170
    expect(unitOf(r1, 'enemy').hp).toBe(500 - 170);
    expect(unitOf(r1, 'hero').mp).toBe(80);

    const units = standardDuo();
    units[0].maxMp = 10;
    units[0].mp = 10;
    const r2 = battleWith(units, [{ casterId: 'hero', skillName: 'heavy_blow', targetId: 'enemy' }]);
    expect(unitOf(r2, 'enemy').hp).toBe(500 - Math.floor(95.2));
  });

  it('04 heal_light：100*0.8+30=110 治疗量', () => {
    const units = standardDuo();
    units[1].hp = 200;
    const r = battleWith(units, [{ casterId: 'hero', skillName: 'heal_light', targetId: 'enemy' }]);
    expect(unitOf(r, 'enemy').hp).toBe(310);
  });

  it('05 thorns_aura 被动：受击反弹 20%（160*0.2=32）', () => {
    const units = standardDuo();
    units[1].passiveSkills = ['thorns_aura'];
    const r = battleWith(units, [{ casterId: 'hero', skillName: 'flame_slash', targetId: 'enemy' }]);
    expect(unitOf(r, 'enemy').hp).toBe(500 - 160);
    expect(unitOf(r, 'hero').hp).toBe(500 - 32);
  });

  it('06 rage_heart 被动：受击叠 1 层怒意，每层 atk+5，上限 5', () => {
    const units = standardDuo();
    units[1].passiveSkills = ['rage_heart'];
    const r = battleWith(units, [
      { casterId: 'hero', skillName: 'flame_slash', targetId: 'enemy' },
      { casterId: 'hero', skillName: 'flame_slash', targetId: 'enemy' },
    ]);
    expect(r.engine.findBuff('enemy', 'rage')?.stacks).toBe(2);
    // atk 100 + 10 = 110
    expect(r.engine.getStat('enemy', 'atk')).toBe(110);
  });

  it('07 regeneration：3 回合回春，每回合 100*0.2+10=30，refresh 续期', () => {
    const units = standardDuo();
    units[1].hp = 300;
    const r = battleWith(units, [{ casterId: 'hero', skillName: 'regeneration', targetId: 'enemy' }]);
    const buff = r.engine.findBuff('enemy', 'regen');
    expect(buff?.duration).toBe(3);
    // 手动驱动三个回合开始
    r.engine.startTurn();
    r.engine.startTurn();
    r.engine.startTurn();
    // 300 + 30*3 = 390（未超上限 500）
    expect(unitOf(r, 'enemy').hp).toBe(390);
    expect(r.engine.findBuff('enemy', 'regen')).toBeUndefined();
  });

  it('08 burn_dot：3 层灼烧，每层每回合 12，三层 36/回合', () => {
    const r = battleWith(standardDuo(), [
      { casterId: 'hero', skillName: 'burn_dot', targetId: 'enemy' },
      { casterId: 'hero', skillName: 'burn_dot', targetId: 'enemy' },
      { casterId: 'hero', skillName: 'burn_dot', targetId: 'enemy' },
    ]);
    expect(r.engine.findBuff('enemy', 'burn')?.stacks).toBe(3);
    const hpBefore = unitOf(r, 'enemy').hp;
    r.engine.startTurn();
    expect(unitOf(r, 'enemy').hp).toBe(hpBefore - 36);
  });

  it('09 poison_dart：20 直伤 + 2 层毒，每回合 6*2=12', () => {
    const r = battleWith(standardDuo(), [
      { casterId: 'hero', skillName: 'poison_dart', targetId: 'enemy' },
      { casterId: 'hero', skillName: 'poison_dart', targetId: 'enemy' },
    ]);
    expect(unitOf(r, 'enemy').hp).toBe(500 - 40);
    expect(r.engine.findBuff('enemy', 'poison')?.stacks).toBe(2);
    const hpBefore = unitOf(r, 'enemy').hp;
    r.engine.startTurn();
    expect(unitOf(r, 'enemy').hp).toBe(hpBefore - 12);
  });

  it('10 arcane_shield：refresh 规则不叠层，def+20，重复施放只续期', () => {
    const r = battleWith(standardDuo(), [
      { casterId: 'hero', skillName: 'arcane_shield', targetId: 'hero' },
      { casterId: 'hero', skillName: 'arcane_shield', targetId: 'hero' },
    ]);
    const buffs = r.engine.buffs.filter((b) => b.defName === 'shield');
    expect(buffs).toHaveLength(1);
    expect(r.engine.getStat('hero', 'def')).toBe(60);
    expect(r.engine.logs.some((l) => l.kind === 'buff_refresh')).toBe(true);
  });

  it('11 combo_strike：3 段每段 100*0.45-40*0.2=37，总计 111', () => {
    const r = battleWith(standardDuo(), [{ casterId: 'hero', skillName: 'combo_strike', targetId: 'enemy' }]);
    expect(unitOf(r, 'enemy').hp).toBe(500 - 37 * 3);
  });

  it('12 execute：血量高于25%打80；压到25%以下造成9999真实伤害即死', () => {
    const r1 = battleWith(standardDuo(), [{ casterId: 'hero', skillName: 'execute', targetId: 'enemy' }]);
    // 100*0.8 = 80
    expect(unitOf(r1, 'enemy').hp).toBe(420);

    const units = standardDuo();
    units[1].hp = 100; // 100/500 = 20% ≤ 25%
    const r2 = battleWith(units, [{ casterId: 'hero', skillName: 'execute', targetId: 'enemy' }]);
    expect(unitOf(r2, 'enemy').alive).toBe(false);
    expect(r2.winnerTeam).toBe(1);
  });

  it('13 life_drain：伤害 110-16=94，吸血 94*0.5=47（施法者先压到残血验证）', () => {
    const units = standardDuo();
    units[0].hp = 300;
    const r = battleWith(units, [{ casterId: 'hero', skillName: 'life_drain', targetId: 'enemy' }]);
    expect(unitOf(r, 'enemy').hp).toBe(500 - 94);
    expect(unitOf(r, 'hero').hp).toBe(347);
  });

  it('14 elusive_strike：种子42首次随机命中（对照探针输出 89 伤害）', () => {
    const r = battleWith(standardDuo(), [{ casterId: 'hero', skillName: 'elusive_strike', targetId: 'enemy' }]);
    // base = 100*1.05 - 40*0.4 = 89；首次 chance(dodge0)=false 命中，chance(crit25) 探针实测不暴
    expect(unitOf(r, 'enemy').hp).toBe(500 - 89);
  });

  it('14b riposte 被动：受击必定反击 80%*atk=80', () => {
    const units = standardDuo();
    units[1].passiveSkills = ['riposte'];
    const r = battleWith(units, [{ casterId: 'hero', skillName: 'flame_slash', targetId: 'enemy' }]);
    // hero 受 80 反击
    expect(unitOf(r, 'hero').hp).toBe(500 - 80);
  });

  it('15 sweep：主目标 80，另一敌人溅射 40（同队两人不受影响）', () => {
    const r = battleWith(trio(), [{ casterId: 'hero', skillName: 'sweep', targetId: 'enemy' }]);
    // 主目标：100 - 20 = 80
    expect(unitOf(r, 'enemy').hp).toBe(500 - 80);
    // 敌方只有 enemy 一人，无溅射对象；再构造双敌人
    const four = [
      makeUnit({ id: 'h', name: '攻方', team: 1 }),
      makeUnit({ id: 'e1', name: '敌1', team: 2 }),
      makeUnit({ id: 'e2', name: '敌2', team: 2 }),
    ];
    const r2 = battleWith(four, [{ casterId: 'h', skillName: 'sweep', targetId: 'e1' }]);
    expect(unitOf(r2, 'e1').hp).toBe(500 - 80);
    expect(unitOf(r2, 'e2').hp).toBe(500 - 40);
    expect(unitOf(r2, 'h').hp).toBe(500);
  });

  it('16 purifying_strike：先挂护盾(def+20)，技能驱散后按基础 def 结算 80 伤害', () => {
    const r = battleWith(standardDuo(), [
      { casterId: 'hero', skillName: 'arcane_shield', targetId: 'enemy' },
      { casterId: 'hero', skillName: 'purifying_strike', targetId: 'enemy' },
    ]);
    // 驱散发生在伤害之后，故本次仍按 60 防结算：100-30=70
    expect(r.engine.findBuff('enemy', 'shield')).toBeUndefined();
    expect(unitOf(r, 'enemy').hp).toBe(500 - 70);
    // 第二次施放时已无护盾，回到基础 def40：100-20=80
    const r2 = battleWith(standardDuo(), [{ casterId: 'hero', skillName: 'purifying_strike', targetId: 'enemy' }]);
    expect(unitOf(r2, 'enemy').hp).toBe(500 - 80);
  });

  it('17 weaken_curse：atk 降低 30% → 100*(1-0.3)=70', () => {
    const r = battleWith(standardDuo(), [{ casterId: 'hero', skillName: 'weaken_curse', targetId: 'enemy' }]);
    expect(r.engine.getStat('enemy', 'atk')).toBe(70);
    // 持续 3 回合后消失
    r.engine.startTurn();
    r.engine.startTurn();
    r.engine.startTurn();
    expect(r.engine.findBuff('enemy', 'weakness')).toBeUndefined();
    expect(r.engine.getStat('enemy', 'atk')).toBe(100);
  });

  it('18 last_blessing 被动：死亡时为存活的同队队友各回 50（亡语者与队友同队）', () => {
    const units = [
      makeUnit({ id: 'dying', name: '牺牲者', team: 1, hp: 1, passiveSkills: ['last_blessing'] }),
      makeUnit({ id: 'hero', name: '勇者', team: 1, hp: 300 }),
      makeUnit({ id: 'cleric', name: '牧师', team: 1, hp: 250 }),
      makeUnit({ id: 'enemy', name: '魔像', team: 2 }),
    ];
    const r = battleWith(units, [{ casterId: 'enemy', skillName: 'execute', targetId: 'dying' }]);
    expect(unitOf(r, 'dying').alive).toBe(false);
    expect(unitOf(r, 'hero').hp).toBe(350);
    expect(unitOf(r, 'cleric').hp).toBe(300);
  });

  it('19 chain_lightning：主伤 90-12=78 + 触发 on_hit 追加 40 = 118', () => {
    const r = battleWith(standardDuo(), [{ casterId: 'hero', skillName: 'chain_lightning', targetId: 'enemy' }]);
    expect(unitOf(r, 'enemy').hp).toBe(500 - 78 - 40);
    expect(r.engine.logs.some((l) => l.message.includes('连锁闪电'))).toBe(true);
  });

  it('20 mana_burn：70 + 100*1.5 = 220 伤害并清空法力', () => {
    const r = battleWith(standardDuo(), [{ casterId: 'hero', skillName: 'mana_burn', targetId: 'enemy' }]);
    expect(unitOf(r, 'enemy').hp).toBe(500 - 220);
    expect(unitOf(r, 'enemy').mp).toBe(0);
  });
});

describe('防死循环与异常保护', () => {
  it('while 死循环触发迭代上限报错', () => {
    expect(() => battleWith(standardDuo(), [{ casterId: 'hero', skillName: 'infinite_loop', targetId: 'enemy' }])).toThrowError(/迭代上限/);
  });

  it('触发器连锁超过深度上限抛 TriggerDepthError 并带连锁链', () => {
    const units = standardDuo();
    units[1].passiveSkills = ['chain_reaction'];
    let caught: unknown;
    try {
      battleWith(units, [{ casterId: 'hero', skillName: 'flame_slash', targetId: 'enemy' }], 1);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(TriggerDepthError);
    expect((caught as TriggerDepthError).chain.length).toBeGreaterThan(30);
  });
});

describe('单步调试轨迹', () => {
  it('trace 记录每条语句、变量快照与属性变更', () => {
    const r = battleWith(standardDuo(), [{ casterId: 'hero', skillName: 'flame_slash', targetId: 'enemy' }]);
    expect(r.interpreter.trace.length).toBeGreaterThan(5);
    const damageStep = r.interpreter.trace.find((s) => s.changes.some((c) => c.prop === 'hp'));
    expect(damageStep).toBeDefined();
    expect(damageStep!.changes.some((c) => c.unitId === 'enemy')).toBe(true);
    expect(damageStep!.varsBefore).toHaveProperty('dmg');

    const dbg = new DebugController(r.interpreter.trace, r.engine.logs, r.engine.changes, r.engine.snapshot());
    const firstLine = r.interpreter.trace[0].line;
    dbg.toggleBreakpoint(firstLine);
    const stopped = dbg.runToBreakpoint();
    expect(stopped?.line).toBe(firstLine);
  });
});
