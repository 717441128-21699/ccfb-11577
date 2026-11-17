import type { BuffDecl, SkillDecl } from '../lang/ast';
import { TriggerDepthError } from '../lang/errors';
import { SeededRng } from './rng';
import type {
  ActiveBuff,
  BattleConfig,
  BattleEvent,
  BattleLogEntry,
  ChangeRecord,
  LogKind,
  ModMode,
  StackingRule,
  StatMod,
  StatName,
  UnitRuntime,
  UnitSnapshot,
  UnitSpec,
} from './types';
import { STAT_NAMES } from './types';

export interface BattleDefs {
  skills: Map<string, SkillDecl>;
  buffs: Map<string, BuffDecl>;
}

/**
 * 战斗引擎：维护单位/buff/事件，负责有效属性结算、buff 同名规则、
 * 触发器连锁与深度保护、伤害治疗、日志与逐步变更追踪。
 * 语句执行与内置函数由 Interpreter 驱动本引擎完成。
 */
export class BattleEngine {
  readonly units = new Map<string, UnitRuntime>();
  readonly buffs: ActiveBuff[] = [];
  readonly rng: SeededRng;
  readonly logs: BattleLogEntry[] = [];
  readonly changes: ChangeRecord[] = [];

  /** 触发器连锁深度（事件嵌套层数）。 */
  depth = 0;
  turn = 0;
  /** 当前正在执行的 buff 实例，供 buff 体内配置类内置函数使用。 */
  currentBuff: ActiveBuff | null = null;
  /** 当前执行中的主动技能（用于技能级 on_hit 等触发器）。 */
  currentSkill: string | null = null;
  breakpoints = new Set<number>();
  currentStepIndex = -1;

  private buffSeq = 0;
  private passiveTriggers = new Map<string, { skill: SkillDecl }[]>();

  constructor(
    unitSpecs: UnitSpec[],
    public readonly defs: BattleDefs,
    public readonly config: BattleConfig,
  ) {
    for (const spec of unitSpecs) {
      this.units.set(spec.id, {
        spec,
        hp: spec.hp ?? spec.maxHp,
        mp: spec.mp ?? spec.maxMp,
        alive: true,
      });
    }
    this.rng = new SeededRng(config.seed);
  }

  // ---------- 初始化与回合 ----------

  /** 注册所有单位的被动技能触发器。 */
  startBattle(): void {
    for (const unit of this.units.values()) {
      const list: { skill: SkillDecl }[] = [];
      for (const skillName of unit.spec.passiveSkills ?? []) {
        const skill = this.defs.skills.get(skillName);
        if (!skill) throw new Error(`单位 ${unit.spec.id} 引用了不存在的被动技能 ${skillName}`);
        list.push({ skill });
      }
      this.passiveTriggers.set(unit.spec.id, list);
    }
    this.log('info', `战斗开始（种子 ${this.config.seed}），共 ${this.units.size} 个单位`);
  }

  /** 回合开始：按速度排序触发 turn_start，随后结算持续时间。 */
  startTurn(): void {
    this.turn++;
    this.log('info', `—— 第 ${this.turn} 回合开始 ——`);
    const ordered = [...this.units.values()].filter((u) => u.alive).sort((a, b) => this.getStat(b.spec.id, 'spd') - this.getStat(a.spec.id, 'spd'));
    for (const unit of ordered) {
      if (!unit.alive) continue;
      this.fireEventSync({ kind: 'on_turn_start', unitId: unit.spec.id });
    }
    this.tickDurations();
  }

  private tickDurations(): void {
    for (const buff of [...this.buffs]) {
      if (buff.duration < 0) continue;
      buff.duration--;
      if (buff.duration <= 0) {
        this.removeBuff(buff, '持续时间结束');
      }
    }
  }

  // ---------- 有效属性 ----------

  getStat(unitId: string, stat: StatName): number {
    const unit = this.requireUnit(unitId);
    const base = unit.spec[stat];
    let flat = 0;
    // 百分比修正采用加性模型：+30% 与 -30% 可正确抵消，避免负数累乘出错
    let pctSum = 0;
    for (const buff of this.buffs.filter((b) => b.ownerId === unitId)) {
      for (const mod of buff.mods) {
        if (mod.stat !== stat) continue;
        if (mod.mode === 'flat') flat += mod.value * buff.stacks;
        else pctSum += mod.value * buff.stacks;
      }
    }
    const value = (base + flat) * (1 + pctSum / 100);
    // 速率/攻击/防御/生命上限取整，概率类属性保留小数
    return stat === 'critRate' || stat === 'critDmg' || stat === 'dodge' ? value : Math.floor(value);
  }

  getEffectiveSpec(unitId: string) {
    return {
      maxHp: this.getStat(unitId, 'maxHp'),
      maxMp: this.getStat(unitId, 'maxMp'),
      atk: this.getStat(unitId, 'atk'),
      def: this.getStat(unitId, 'def'),
      spd: this.getStat(unitId, 'spd'),
      critRate: this.getStat(unitId, 'critRate'),
      critDmg: this.getStat(unitId, 'critDmg'),
      dodge: this.getStat(unitId, 'dodge'),
    };
  }

  // ---------- Buff ----------

  /**
   * 施加 buff。同名效果按 stacking 规则处理：
   * - refresh：刷新持续时间，层数不变
   * - stack：层数 +1（不超过 maxStacks），并刷新持续时间
   * - separate：总是创建独立实例
   */
  addBuff(ownerId: string, defName: string, sourceId: string, configure: (buff: ActiveBuff) => void): ActiveBuff {
    const def = this.defs.buffs.get(defName);
    if (!def) throw new Error(`未知 buff 定义：${defName}`);
    const existing = this.buffs.find((b) => b.ownerId === ownerId && b.defName === defName);

    if (existing && existing.stacking !== 'separate') {
      if (existing.stacking === 'refresh') {
        existing.duration = existing.duration < 0 ? existing.duration : Math.max(existing.duration, this.defaultDuration(defName));
        this.log('buff_refresh', `${this.nameOf(ownerId)} 的 ${existing.displayName} 刷新（剩余 ${this.durationText(existing)}）`);
        return existing;
      }
      // stack
      if (existing.stacks < existing.maxStacks) {
        existing.stacks++;
        this.log('buff_stack', `${this.nameOf(ownerId)} 的 ${existing.displayName} 叠加到 ${existing.stacks} 层`);
      } else {
        this.log('buff_refresh', `${this.nameOf(ownerId)} 的 ${existing.displayName} 已达 ${existing.maxStacks} 层上限，仅刷新持续时间`);
      }
      existing.duration = existing.duration < 0 ? existing.duration : Math.max(existing.duration, this.defaultDuration(defName));
      this.clampHp(ownerId);
      return existing;
    }

    const buff: ActiveBuff = {
      instanceId: `buff_${++this.buffSeq}`,
      defName,
      displayName: defName,
      ownerId,
      sourceId,
      stacks: 1,
      maxStacks: 1,
      duration: this.defaultDuration(defName),
      stacking: 'refresh',
      mods: [],
      vars: {},
      order: this.buffSeq,
    };
    this.buffs.push(buff);
    this.currentBuff = buff;
    try {
      configure(buff);
    } finally {
      this.currentBuff = null;
    }
    this.log('buff_add', `${this.nameOf(ownerId)} 获得 ${buff.displayName}（${buff.stacking}，${this.durationText(buff)}）`);
    this.clampHp(ownerId);
    return buff;
  }

  private defaultDuration(_defName: string): number {
    return 3;
  }

  configureCurrentBuff(opts: { duration?: number; stacking?: StackingRule; maxStacks?: number }): void {
    if (!this.currentBuff) throw new Error('buff 配置函数只能在 buff 声明体内调用');
    if (opts.duration !== undefined) this.currentBuff.duration = opts.duration;
    if (opts.stacking !== undefined) this.currentBuff.stacking = opts.stacking;
    if (opts.maxStacks !== undefined) this.currentBuff.maxStacks = opts.maxStacks;
  }

  addCurrentBuffMod(stat: StatName, value: number, mode: ModMode): void {
    if (!this.currentBuff) throw new Error('mod_stat 只能在 buff 声明体内调用');
    const mod: StatMod = { stat, value, mode };
    this.currentBuff.mods.push(mod);
  }

  removeBuff(buff: ActiveBuff, reason: string): void {
    const idx = this.buffs.indexOf(buff);
    if (idx < 0) return;
    this.buffs.splice(idx, 1);
    this.log('buff_remove', `${this.nameOf(buff.ownerId)} 的 ${buff.displayName} 移除（${reason}）`);
    this.clampHp(buff.ownerId);
  }

  removeBuffByName(ownerId: string, defName: string): boolean {
    const found = this.buffs.filter((b) => b.ownerId === ownerId && b.defName === defName);
    for (const buff of found) this.removeBuff(buff, '技能驱散');
    return found.length > 0;
  }

  findBuff(ownerId: string, defName: string): ActiveBuff | undefined {
    return this.buffs.find((b) => b.ownerId === ownerId && b.defName === defName);
  }

  // ---------- 伤害与治疗 ----------

  /** 施加最终伤害（闪避/暴击/克制由脚本算好后调用），返回实际扣血量。 */
  applyDamage(attackerId: string, targetId: string, amount: number, element: string): number {
    const target = this.requireUnit(targetId);
    if (!target.alive) return 0;
    const before = target.hp;
    const dmg = Math.max(0, Math.floor(amount));
    target.hp = Math.max(0, target.hp - dmg);
    this.recordChange({
      unitId: targetId,
      unitName: target.spec.name,
      prop: 'hp',
      oldValue: String(before),
      newValue: String(target.hp),
      reason: `${this.nameOf(attackerId)} 的 ${this.elementName(element)} 伤害`,
    });
    this.log('damage', `${this.nameOf(attackerId)} 对 ${this.nameOf(targetId)} 造成 ${dmg} 点 ${this.elementName(element)} 伤害（${before} → ${target.hp}）`);
    const event: BattleEvent = { kind: 'on_take_hit', attackerId, targetId, amount: dmg, element };
    this.fireEventSync(event);
    if (target.hp <= 0 && target.alive) {
      target.alive = false;
      this.recordChange({
        unitId: targetId,
        unitName: target.spec.name,
        prop: 'alive',
        oldValue: 'true',
        newValue: 'false',
        reason: '生命归零阵亡',
      });
      this.log('death', `${this.nameOf(targetId)} 阵亡`);
      this.fireEventSync({ kind: 'on_death', unitId: targetId, killerId: attackerId });
    }
    return before - target.hp;
  }

  applyHeal(sourceId: string, targetId: string, amount: number): number {
    const target = this.requireUnit(targetId);
    if (!target.alive) return 0;
    const before = target.hp;
    const maxHp = this.getStat(targetId, 'maxHp');
    target.hp = Math.min(maxHp, target.hp + Math.max(0, Math.floor(amount)));
    const healed = target.hp - before;
    if (healed > 0) {
      this.recordChange({
        unitId: targetId,
        unitName: target.spec.name,
        prop: 'hp',
        oldValue: String(before),
        newValue: String(target.hp),
        reason: `${this.nameOf(sourceId)} 的治疗`,
      });
    }
    this.log('heal', `${this.nameOf(sourceId)} 为 ${this.nameOf(targetId)} 恢复 ${healed} 点生命（${before} → ${target.hp}）`);
    return healed;
  }

  addMp(unitId: string, delta: number): number {
    const unit = this.requireUnit(unitId);
    const before = unit.mp;
    const maxMp = this.getStat(unitId, 'maxMp');
    unit.mp = Math.max(0, Math.min(maxMp, unit.mp + Math.floor(delta)));
    if (unit.mp !== before) {
      this.recordChange({
        unitId,
        unitName: unit.spec.name,
        prop: 'mp',
        oldValue: String(before),
        newValue: String(unit.mp),
        reason: '法力变化',
      });
    }
    return unit.mp - before;
  }

  setBaseStat(unitId: string, stat: StatName, value: number): void {
    const unit = this.requireUnit(unitId);
    unit.spec[stat] = value;
    this.clampHp(unitId);
  }

  private clampHp(unitId: string): void {
    const unit = this.units.get(unitId);
    if (!unit) return;
    const maxHp = this.getStat(unitId, 'maxHp');
    if (unit.hp > maxHp) unit.hp = maxHp;
  }

  // ---------- 触发器连锁 ----------

  /** 触发一个事件，立即同步执行全部匹配处理器。 */
  fireEventSync(event: BattleEvent): void {
    if (!this.eventHandler) throw new Error('事件处理器未安装');
    this.depth++;
    const label = this.eventLabel(event);
    try {
      if (this.depth > this.config.maxTriggerDepth) {
        throw new TriggerDepthError(
          `触发器连锁深度超过上限 ${this.config.maxTriggerDepth}，疑似死循环（连锁链：${this.chainLog.join(' → ')} → ${label}）`,
          { line: 0, col: 1, index: 0 },
          [...this.chainLog, label],
        );
      }
      this.chainLog.push(label);
      this.eventHandler(event, this.depth);
    } finally {
      this.chainLog.pop();
      this.depth--;
    }
  }

  /** 解释器注入：执行一个事件对应的全部处理器。 */
  eventHandler: ((event: BattleEvent, depth: number) => void) | null = null;
  private chainLog: string[] = [];

  private eventLabel(event: BattleEvent): string {
    const who = event.unitId ?? event.targetId ?? event.attackerId ?? '?';
    return `${event.kind}@${who}`;
  }

  // ---------- 被动触发器查询 ----------

  getPassiveTriggers(unitId: string): { skill: SkillDecl }[] {
    return this.passiveTriggers.get(unitId) ?? [];
  }

  // ---------- 工具 ----------

  requireUnit(id: string): UnitRuntime {
    const unit = this.units.get(id);
    if (!unit) throw new Error(`不存在的单位：${id}`);
    return unit;
  }

  nameOf(id: string): string {
    return this.units.get(id)?.spec.name ?? id;
  }

  elementName(el: string): string {
    return { fire: '火', water: '水', grass: '草', phys: '物理', none: '无' }[el] ?? el;
  }

  elementMult(atkEl: string, defEl: string): number {
    return this.config.elementChart[atkEl]?.[defEl] ?? 1;
  }

  durationText(buff: ActiveBuff): string {
    return buff.duration < 0 ? '永久' : `${buff.duration} 回合`;
  }

  log(kind: LogKind, message: string): void {
    this.logs.push({
      index: this.logs.length,
      stepIndex: this.changes.length ? this.changes[this.changes.length - 1].stepIndex : -1,
      turn: this.turn,
      depth: this.depth,
      kind,
      message,
    });
  }

  recordChange(rec: Omit<ChangeRecord, 'stepIndex' | 'index'>): void {
    this.changes.push({ ...rec, stepIndex: this.currentStepIndex, index: this.changes.length });
  }

  snapshot(): UnitSnapshot[] {
    return [...this.units.values()].map((u) => ({
      id: u.spec.id,
      name: u.spec.name,
      team: u.spec.team,
      hp: u.hp,
      mp: u.mp,
      maxHp: this.getStat(u.spec.id, 'maxHp'),
      maxMp: this.getStat(u.spec.id, 'maxMp'),
      alive: u.alive,
      atk: this.getStat(u.spec.id, 'atk'),
      def: this.getStat(u.spec.id, 'def'),
      spd: this.getStat(u.spec.id, 'spd'),
      critRate: this.getStat(u.spec.id, 'critRate'),
      critDmg: this.getStat(u.spec.id, 'critDmg'),
      dodge: this.getStat(u.spec.id, 'dodge'),
      buffs: this.buffs.filter((b) => b.ownerId === u.spec.id).map((b) => ({ name: b.defName, stacks: b.stacks, duration: b.duration })),
    }));
  }

  isOver(): boolean {
    const teams = new Set([...this.units.values()].filter((u) => u.alive).map((u) => u.spec.team));
    return teams.size <= 1;
  }

  // 供解释器校验属性名
  static isStatName(name: string): name is StatName {
    return (STAT_NAMES as string[]).includes(name);
  }
}
