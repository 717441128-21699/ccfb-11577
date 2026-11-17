import type {
  ArrayExpr,
  Assignment,
  BinaryExpr,
  BuffDecl,
  CallExpr,
  Expr,
  MemberExpr,
  Program,
  SkillDecl,
  Stmt,
  TriggerBlock,
  UnaryExpr,
} from '../lang/ast';
import { RuntimeError, SkillScriptError } from '../lang/errors';
import { BattleEngine } from './battle';
import { Environment } from './environment';
import type { StepEvent, StepFrame } from './trace';
import type {
  ActiveBuff,
  BattleEvent,
  BuiltinFn,
  LogKind,
  SSValue,
  UnitRef,
} from './types';
import { isUnitRef } from './types';

class BreakSignal {
  static readonly INSTANCE = new BreakSignal();
}
class ContinueSignal {
  static readonly INSTANCE = new ContinueSignal();
}
class ReturnSignal {
  constructor(public readonly value: SSValue) {}
}

interface BuiltinDef {
  name: string;
  fn: (args: SSValue[], callPos: Expr['span']) => SSValue;
}

export interface InterpreterOptions {
  captureTrace: boolean;
  breakpoints?: Set<number>;
}

/**
 * 树遍历解释器。
 * - 词法作用域 + let 块级变量
 * - 语句级 trace 钩子：每条语句记录变量快照与该语句引起的属性变化
 * - 内置函数通过 builtin 值传递，支持一等调用与成员方法风格
 */
export class Interpreter {
  readonly trace: StepEvent[] = [];
  private stepCounter = 0;
  private frames: StepFrame[] = [];
  private readonly builtins = new Map<string, BuiltinDef>();

  /** 全局环境：内置函数以 BuiltinFn 值存在其中。 */
  readonly globalEnv: Environment;

  constructor(
    private readonly engine: BattleEngine,
    private readonly program: Program,
    private readonly options: InterpreterOptions = { captureTrace: true },
  ) {
    this.installBuiltins();
    this.globalEnv = new Environment('全局');
    for (const name of this.builtins.keys()) {
      const fnValue: BuiltinFn = { __builtin: true, name };
      this.globalEnv.declare(name, fnValue, { line: 0, col: 1, index: 0 });
    }
    this.engine.eventHandler = (event, depth) => this.handleEvent(event, depth);
  }

  // ---------- 对外入口 ----------

  /** 执行主动技能。context 提供 caster/target/skill 等上下文变量。 */
  runSkill(skill: SkillDecl, context: Record<string, SSValue>): void {
    const env = new Environment(`技能 ${skill.name}`, this.globalEnv);
    for (const [k, v] of Object.entries(context)) env.declare(k, v, { line: 0, col: 1, index: 0 });
    this.engine.currentSkill = skill.name;
    const casterVar = context['caster'];
    this.skillCasterId = isUnitRef(casterVar) ? casterVar.id : null;
    this.pushFrame('skill', skill.name);
    try {
      this.execBlock(skill.body, env);
    } finally {
      this.popFrame();
      this.engine.currentSkill = null;
      this.skillCasterId = null;
    }
  }

  /** 执行 buff 声明体（在 add_buff 时由引擎调用链触发），返回持久化环境供触发器使用。 */
  runBuffBody(buff: BuffDecl, env: Environment): Environment {
    this.pushFrame('buff', buff.name);
    try {
      this.execBlock(buff.body, env);
    } finally {
      this.popFrame();
    }
    return env;
  }

  // ---------- 事件分发 ----------

  private handleEvent(event: BattleEvent, depth: number): void {
    void depth;
    const ctx = this.eventContext(event);
    // 1. 单位被动技能里的触发器：
    //    take_hit/hit 的承载者是受击者/攻击者；turn_start/death 的承载者是 unit 自身
    const carrierId =
      event.kind === 'on_take_hit' ? event.targetId
      : event.kind === 'on_hit' ? event.attackerId
      : event.unitId;
    if (carrierId) {
      for (const { skill } of this.engine.getPassiveTriggers(carrierId)) {
        for (const trigger of skill.triggers) {
          if (trigger.event !== event.kind) continue;
          this.runTrigger(trigger, skill.name, ctx);
        }
      }
    }
    // 2. buff 实例上的触发器（每个实例拥有自己的持久化环境）
    for (const buff of [...this.engine.buffs]) {
      const def = this.program.decls.find((d): d is BuffDecl => d.kind === 'BuffDecl' && d.name === buff.defName);
      if (!def) continue;
      for (const trigger of def.triggers) {
        if (trigger.event !== event.kind) continue;
        if (!this.buffTriggerMatches(buff, event)) continue;
        this.runBuffTrigger(trigger, def, buff, ctx);
      }
    }
    // 3. 当前主动技能体内的触发器：fire_event 显式触发一律放行；隐式事件需施法者匹配
    if (this.engine.currentSkill && this.skillCasterId) {
      const skill = this.program.decls.find((d): d is SkillDecl => d.kind === 'SkillDecl' && d.name === this.engine.currentSkill);
      if (skill) {
        for (const trigger of skill.triggers) {
          if (trigger.event !== event.kind) continue;
          if (!event.explicit) {
            if (event.attackerId && event.attackerId !== this.skillCasterId) continue;
          }
          this.runTrigger(trigger, skill.name, ctx);
        }
      }
    }
  }

  /** 最近一次 runSkill 的施法者 id，用于技能级触发器过滤。 */
  private skillCasterId: string | null = null;

  /**
   * buff 触发器匹配规则：
   * - take_hit：buff 拥有者是受击者
   * - hit：buff 拥有者是攻击者
   * - turn_start：buff 拥有者是回合单位
   * - death：buff 拥有者是死亡单位
   */
  private buffTriggerMatches(buff: ActiveBuff, event: BattleEvent): boolean {
    switch (event.kind) {
      case 'on_take_hit':
        return event.targetId === buff.ownerId;
      case 'on_hit':
        return event.attackerId === buff.ownerId;
      case 'on_turn_start':
        return event.unitId === buff.ownerId;
      case 'on_death':
        return event.unitId === buff.ownerId;
      default:
        return false;
    }
  }

  private eventContext(event: BattleEvent): Record<string, SSValue> {
    // 注意：上下文中的伤害量命名为 damage_amount，避免遮蔽内建函数 damage()
    const ctx: Record<string, SSValue> = { event: event.kind };
    if (event.attackerId) ctx.attacker = this.unitRef(event.attackerId);
    if (event.targetId) ctx.target = this.unitRef(event.targetId);
    if (event.unitId) ctx.unit = this.unitRef(event.unitId);
    if (event.killerId) ctx.killer = this.unitRef(event.killerId);
    if (event.amount !== undefined) ctx.damage_amount = event.amount;
    if (event.element !== undefined) ctx.element = event.element;
    return ctx;
  }

  private runTrigger(trigger: TriggerBlock, ownerName: string, context: Record<string, SSValue>): void {
    const env = new Environment(`触发器 ${ownerName}:${trigger.event}`, this.globalEnv);
    for (const [k, v] of Object.entries(context)) env.declare(k, v, { line: 0, col: 1, index: 0 });
    this.pushFrame('trigger', `${ownerName} on "${trigger.event}"`);
    try {
      this.execBlock(trigger.body, env);
    } finally {
      this.popFrame();
    }
  }

  /** buff 实例 id → 持久化环境（buff 体声明的变量在触发器里持续可见）。 */
  private buffEnvs = new Map<string, Environment>();

  private runBuffTrigger(trigger: TriggerBlock, def: BuffDecl, buff: ActiveBuff, context: Record<string, SSValue>): void {
    const base = this.buffEnvs.get(buff.instanceId) ?? this.globalEnv;
    const env = new Environment(`触发器 ${def.name}:${trigger.event}`, base);
    env.declare('owner', this.unitRef(buff.ownerId), { line: 0, col: 1, index: 0 });
    env.declare('source', this.unitRef(buff.sourceId), { line: 0, col: 1, index: 0 });
    for (const [k, v] of Object.entries(context)) {
      if (!env.has(k)) env.declare(k, v, { line: 0, col: 1, index: 0 });
    }
    this.pushFrame('trigger', `${def.name}@${this.engine.nameOf(buff.ownerId)} on "${trigger.event}"`);
    try {
      this.execBlock(trigger.body, env);
    } finally {
      this.popFrame();
    }
  }

  // ---------- 语句执行 ----------

  private execBlock(stmts: Stmt[], env: Environment): void {
    for (const stmt of stmts) this.exec(stmt, env);
  }

  private exec(stmt: Stmt, env: Environment): void {
    const before = this.beginStep(stmt, env);
    const changesBefore = this.engine.changes.length;
    try {
      switch (stmt.kind) {
        case 'VarDecl': {
          env.declare(stmt.name, stmt.init ? this.eval(stmt.init, env) : 0, stmt.span.start);
          break;
        }
        case 'Assignment':
          this.execAssignment(stmt, env);
          break;
        case 'IfStmt':
          if (this.truthy(this.eval(stmt.test, env))) this.execBlock(stmt.consequent, new Environment('if 块', env));
          else if (stmt.alternate) this.execBlock(stmt.alternate, new Environment('else 块', env));
          break;
        case 'WhileStmt':
          this.execWhile(stmt, env);
          break;
        case 'BreakStmt':
          throw BreakSignal.INSTANCE;
        case 'ContinueStmt':
          throw ContinueSignal.INSTANCE;
        case 'ReturnStmt':
          throw new ReturnSignal(stmt.value ? this.eval(stmt.value, env) : null);
        case 'ExprStmt':
          this.eval(stmt.expr, env);
          break;
      }
    } catch (err) {
      if (err instanceof BreakSignal || err instanceof ContinueSignal || err instanceof ReturnSignal) throw err;
      // 所有带位置的脚本错误（含 TriggerDepthError）原样上抛，不二次包装
      if (err instanceof SkillScriptError) throw err;
      throw new RuntimeError(err instanceof Error ? err.message : String(err), stmt.span.start, stmt.span.end);
    } finally {
      this.endStep(before, changesBefore);
    }
  }

  private execWhile(stmt: Stmt & { kind: 'WhileStmt' }, env: Environment): void {
    let guard = 0;
    while (this.truthy(this.eval(stmt.test, env))) {
      if (++guard > this.engine.config.maxLoopIterations) {
        throw new RuntimeError(`while 循环超过 ${this.engine.config.maxLoopIterations} 次迭代上限，疑似死循环`, stmt.span.start, stmt.span.end);
      }
      try {
        this.execBlock(stmt.body, new Environment('while 块', env));
      } catch (err) {
        if (err instanceof ContinueSignal) continue;
        if (err instanceof BreakSignal) break;
        throw err;
      }
    }
  }

  private execAssignment(stmt: Assignment, env: Environment): void {
    const value = this.eval(stmt.value, env);
    const target = stmt.target;
    if (target.kind === 'Identifier') {
      env.set(target.name, value, target.span.start);
      return;
    }
    if (target.kind === 'MemberExpr') {
      const obj = this.eval(target.object, env);
      this.setMember(obj, target.property, value, target.span.start, target.object);
      return;
    }
    const obj = this.eval(target.object, env);
    const index = this.eval(target.index, env);
    this.setIndex(obj, index, value, target.span.start);
  }

  // ---------- 表达式求值 ----------

  private eval(expr: Expr, env: Environment): SSValue {
    switch (expr.kind) {
      case 'NumberLiteral':
        return expr.value;
      case 'StringLiteral':
        return expr.value;
      case 'BoolLiteral':
        return expr.value;
      case 'Identifier':
        return env.get(expr.name, expr.span.start);
      case 'ArrayExpr':
        return (expr as ArrayExpr).elements.map((e) => this.eval(e, env));
      case 'UnaryExpr':
        return this.evalUnary(expr, env);
      case 'BinaryExpr':
        return this.evalBinary(expr, env);
      case 'MemberExpr':
        return this.getMember(this.eval(expr.object, env), expr.property, expr.span.start, expr);
      case 'IndexExpr':
        return this.getIndex(this.eval(expr.object, env), this.eval(expr.index, env), expr.span.start);
      case 'CallExpr':
        return this.evalCall(expr, env);
    }
  }

  private evalUnary(expr: UnaryExpr, env: Environment): SSValue {
    const v = this.eval(expr.operand, env);
    if (expr.op === '-') {
      if (typeof v !== 'number') throw new RuntimeError('一元 "-" 只能作用于数字', expr.span.start, expr.span.end);
      return -v;
    }
    return !this.truthy(v);
  }

  private evalBinary(expr: BinaryExpr, env: Environment): SSValue {
    // and / or 短路
    if (expr.op === 'and') return this.truthy(this.eval(expr.left, env)) && this.truthy(this.eval(expr.right, env));
    if (expr.op === 'or') return this.truthy(this.eval(expr.left, env)) || this.truthy(this.eval(expr.right, env));

    const left = this.eval(expr.left, env);
    const right = this.eval(expr.right, env);

    switch (expr.op) {
      case '==':
        return this.ssEqual(left, right);
      case '!=':
        return !this.ssEqual(left, right);
      case '<': case '>': case '<=': case '>=':
        this.assertNumbers(left, right, expr);
        return expr.op === '<' ? (left as number) < (right as number)
          : expr.op === '>' ? (left as number) > (right as number)
          : expr.op === '<=' ? (left as number) <= (right as number)
          : (left as number) >= (right as number);
      case '+':
        if (typeof left === 'string' || typeof right === 'string') return this.toDisplay(left) + this.toDisplay(right);
        this.assertNumbers(left, right, expr);
        return (left as number) + (right as number);
      case '-': case '*': case '/': case '%':
        this.assertNumbers(left, right, expr);
        if ((expr.op === '/' || expr.op === '%') && (right as number) === 0) {
          throw new RuntimeError('除数不能为 0', expr.span.start, expr.span.end);
        }
        return expr.op === '-' ? (left as number) - (right as number)
          : expr.op === '*' ? (left as number) * (right as number)
          : expr.op === '/' ? (left as number) / (right as number)
          : (left as number) % (right as number);
    }
  }

  private evalCall(expr: CallExpr, env: Environment): SSValue {
    const args = expr.args.map((a) => this.eval(a, env));
    const callee = this.evalCallee(expr.callee, env);
    if (!callee) {
      throw new RuntimeError(`不是可调用的函数：${this.calleeName(expr.callee)}`, expr.span.start, expr.span.end);
    }
    return callee.fn(args, expr.span);
  }

  private evalCallee(callee: Expr, env: Environment): BuiltinDef | null {
    if (callee.kind === 'Identifier') {
      const v = env.get(callee.name, callee.span.start);
      return typeof v === 'object' && v !== null && '__builtin' in v ? this.builtins.get((v as { name: string }).name) ?? null : null;
    }
    if (callee.kind === 'MemberExpr') {
      // 成员调用 target.hp() 风格目前不需要；unit 方法以普通内置函数为主
      const obj = this.eval(callee.object, env);
      if (isUnitRef(obj)) {
        const fn = this.builtins.get(`unit:${callee.property}`);
        return fn ?? null;
      }
    }
    return null;
  }

  private calleeName(expr: Expr): string {
    if (expr.kind === 'Identifier') return expr.name;
    if (expr.kind === 'MemberExpr') return `${this.calleeName(expr.object)}.${expr.property}`;
    return '(表达式)';
  }

  // ---------- 成员与下标 ----------

  private getMember(obj: SSValue, prop: string, pos: Expr['span']['start'], expr: MemberExpr): SSValue {
    if (isUnitRef(obj)) return this.readUnitProp(obj.id, prop, pos, expr);
    if (Array.isArray(obj)) {
      if (prop === 'length') return obj.length;
      throw new RuntimeError(`数组没有属性 "${prop}"`, pos, expr.span.end);
    }
    if (obj !== null && typeof obj === 'object' && !Array.isArray(obj) && !('__builtin' in obj) && !('__unit' in obj)) {
      return (obj as Record<string, SSValue>)[prop] ?? null;
    }
    throw new RuntimeError(`无法读取属性 "${prop}"`, pos, expr.span.end);
  }

  private readUnitProp(unitId: string, prop: string, pos: Expr['span']['start'], expr: MemberExpr): SSValue {
    const unit = this.engine.requireUnit(unitId);
    if (prop === 'id') return unit.spec.id;
    if (prop === 'name') return unit.spec.name;
    if (prop === 'team') return unit.spec.team;
    if (prop === 'element') return unit.spec.element;
    if (prop === 'hp') return unit.hp;
    if (prop === 'mp') return unit.mp;
    if (prop === 'alive') return unit.alive;
    if (BattleEngine.isStatName(prop)) return this.engine.getStat(unitId, prop);
    if (prop === 'buffs') {
      return this.engine.buffs.filter((b) => b.ownerId === unitId).map((b) => b.defName);
    }
    throw new RuntimeError(`单位没有属性 "${prop}"`, pos, expr.span.end);
  }

  private setMember(obj: SSValue, prop: string, value: SSValue, pos: Expr['span']['start'], targetObj: Expr): void {
    if (isUnitRef(obj)) {
      this.writeUnitProp(obj.id, prop, value, pos);
      return;
    }
    if (obj !== null && typeof obj === 'object' && !Array.isArray(obj) && !('__builtin' in obj) && !('__unit' in obj)) {
      (obj as Record<string, SSValue>)[prop] = value;
      return;
    }
    throw new RuntimeError(`无法写入属性 "${prop}"`, pos, targetObj.span.end);
  }

  private writeUnitProp(unitId: string, prop: string, value: SSValue, pos: Expr['span']['start']): void {
    const unit = this.engine.requireUnit(unitId);
    if (prop === 'hp') {
      if (typeof value !== 'number') throw new RuntimeError('hp 必须是数字', pos);
      const before = unit.hp;
      const maxHp = this.engine.getStat(unitId, 'maxHp');
      unit.hp = Math.max(0, Math.min(maxHp, Math.floor(value)));
      this.engine.recordChange({ unitId, unitName: unit.spec.name, prop: 'hp', oldValue: String(before), newValue: String(unit.hp), reason: '脚本赋值' });
      this.engine.log('info', `${unit.spec.name} 的 hp 被脚本设为 ${unit.hp}`);
      if (unit.hp <= 0 && unit.alive) {
        unit.alive = false;
        this.engine.log('death', `${unit.spec.name} 阵亡`);
      }
      return;
    }
    if (prop === 'mp') {
      if (typeof value !== 'number') throw new RuntimeError('mp 必须是数字', pos);
      const before = unit.mp;
      unit.mp = Math.max(0, Math.min(this.engine.getStat(unitId, 'maxMp'), Math.floor(value)));
      this.engine.recordChange({ unitId, unitName: unit.spec.name, prop: 'mp', oldValue: String(before), newValue: String(unit.mp), reason: '脚本赋值' });
      return;
    }
    if (BattleEngine.isStatName(prop)) {
      if (typeof value !== 'number') throw new RuntimeError(`${prop} 必须是数字`, pos);
      this.engine.setBaseStat(unitId, prop, value);
      this.engine.recordChange({ unitId, unitName: unit.spec.name, prop, oldValue: '(基础值)', newValue: String(value), reason: '脚本修改基础属性' });
      return;
    }
    throw new RuntimeError(`单位属性 "${prop}" 只读或不存在`, pos);
  }

  private getIndex(obj: SSValue, index: SSValue, pos: Expr['span']['start']): SSValue {
    if (Array.isArray(obj)) {
      if (typeof index !== 'number') throw new RuntimeError('数组下标必须是数字', pos);
      const i = Math.floor(index);
      if (i < 0 || i >= obj.length) throw new RuntimeError(`数组下标越界：${i}（长度 ${obj.length}）`, pos);
      return obj[i];
    }
    if (typeof obj === 'string') {
      if (typeof index !== 'number') throw new RuntimeError('字符串下标必须是数字', pos);
      return obj.charAt(Math.floor(index));
    }
    throw new RuntimeError('该值不支持下标访问', pos);
  }

  private setIndex(obj: SSValue, index: SSValue, value: SSValue, pos: Expr['span']['start']): void {
    if (Array.isArray(obj)) {
      if (typeof index !== 'number') throw new RuntimeError('数组下标必须是数字', pos);
      const i = Math.floor(index);
      if (i < 0 || i >= obj.length) throw new RuntimeError(`数组下标越界：${i}（长度 ${obj.length}）`, pos);
      obj[i] = value;
      return;
    }
    throw new RuntimeError('该值不支持下标赋值', pos);
  }

  // ---------- 工具 ----------

  private truthy(v: SSValue): boolean {
    if (typeof v === 'boolean') return v;
    if (v === null) return false;
    if (typeof v === 'number') return v !== 0;
    if (typeof v === 'string') return v.length > 0;
    if (Array.isArray(v)) return v.length > 0;
    return true;
  }

  private ssEqual(a: SSValue, b: SSValue): boolean {
    if (isUnitRef(a) || isUnitRef(b)) return isUnitRef(a) && isUnitRef(b) && a.id === b.id;
    if (Array.isArray(a) || Array.isArray(b)) return a === b;
    return a === b;
  }

  private assertNumbers(left: SSValue, right: SSValue, expr: BinaryExpr): void {
    if (typeof left !== 'number' || typeof right !== 'number') {
      throw new RuntimeError(`运算符 "${expr.op}" 要求两个数字操作数`, expr.span.start, expr.span.end);
    }
  }

  private toDisplay(v: SSValue): string {
    if (v === null) return 'null';
    if (isUnitRef(v)) return this.engine.nameOf(v.id);
    if (Array.isArray(v)) return `[${v.map((x) => this.toDisplay(x)).join(', ')}]`;
    return String(v);
  }

  private unitRef(id: string): UnitRef {
    return { __unit: true, id };
  }

  private requireUnitArg(v: SSValue, pos: Expr['span']): UnitRef {
    if (!isUnitRef(v)) throw new RuntimeError('该参数需要一个单位', pos.start, pos.end);
    this.engine.requireUnit(v.id);
    return v;
  }

  private requireNumber(v: SSValue, pos: Expr['span'], what: string): number {
    if (typeof v !== 'number') throw new RuntimeError(`${what} 需要数字参数`, pos.start, pos.end);
    return v;
  }

  private requireString(v: SSValue, pos: Expr['span'], what: string): string {
    if (typeof v !== 'string') throw new RuntimeError(`${what} 需要字符串参数`, pos.start, pos.end);
    return v;
  }

  // ---------- trace ----------

  private pushFrame(kind: string, detail: string): void {
    this.frames.push({ name: kind, detail, depth: this.frames.length });
  }

  private popFrame(): void {
    this.frames.pop();
  }

  private beginStep(stmt: Stmt, env: Environment): StepEvent {
    const event: StepEvent = {
      index: this.stepCounter++,
      kind: 'step',
      stmt,
      line: stmt.span.start.line,
      col: stmt.span.start.col,
      varsBefore: this.options.captureTrace ? env.snapshot() : {},
      frames: this.frames.map((f) => ({ ...f })),
      unitsBefore: this.options.captureTrace ? this.engine.snapshot() : [],
      changes: [],
    };
    if (this.options.captureTrace) this.trace.push(event);
    this.engine.currentStepIndex = event.index;
    return event;
  }

  private endStep(event: StepEvent, changesBefore: number): void {
    if (!this.options.captureTrace) return;
    event.changes = this.engine.changes.slice(changesBefore).map((c) => ({
      unitId: c.unitId,
      unitName: c.unitName,
      prop: c.prop,
      oldValue: c.oldValue,
      newValue: c.newValue,
      reason: c.reason,
    }));
  }

  // ---------- 内置函数 ----------

  private def(name: string, fn: BuiltinDef['fn']): void {
    const builtin: BuiltinDef = { name, fn };
    this.builtins.set(name, builtin);
  }

  private installBuiltins(): void {
    // 随机
    this.def('rand', () => this.engine.rng.next());
    this.def('rand_int', (a, p) => {
      const min = this.requireNumber(a[0] ?? 0, p, 'rand_int');
      const max = this.requireNumber(a[1] ?? 100, p, 'rand_int');
      return this.engine.rng.randInt(Math.floor(min), Math.floor(max));
    });
    this.def('chance', (a, p) => this.engine.rng.chance(this.requireNumber(a[0] ?? 0, p, 'chance')));

    // 输出
    this.def('log', (a, _p) => {
      const kind: LogKind = (a[1] as LogKind) ?? 'info';
      this.engine.log(kind, this.toDisplay(a[0] ?? ''));
      return null;
    });

    // 数学
    this.def('abs', (a, p) => Math.abs(this.requireNumber(a[0] ?? 0, p, 'abs')));
    this.def('min', (a, p) => Math.min(...a.map((x) => this.requireNumber(x, p, 'min'))));
    this.def('max', (a, p) => Math.max(...a.map((x) => this.requireNumber(x, p, 'max'))));
    this.def('floor', (a, p) => Math.floor(this.requireNumber(a[0] ?? 0, p, 'floor')));
    this.def('ceil', (a, p) => Math.ceil(this.requireNumber(a[0] ?? 0, p, 'ceil')));
    this.def('round', (a, p) => Math.round(this.requireNumber(a[0] ?? 0, p, 'round')));
    this.def('clamp', (a, p) => {
      const v = this.requireNumber(a[0] ?? 0, p, 'clamp');
      const lo = this.requireNumber(a[1] ?? 0, p, 'clamp');
      const hi = this.requireNumber(a[2] ?? 0, p, 'clamp');
      return Math.min(hi, Math.max(lo, v));
    });

    // 数组/字符串
    this.def('len', (a) => {
      const v = a[0];
      if (Array.isArray(v) || typeof v === 'string') return v.length;
      return 0;
    });
    this.def('push', (a, p) => {
      if (!Array.isArray(a[0])) throw new RuntimeError('push 需要数组', p.start, p.end);
      (a[0] as SSValue[]).push(a[1] ?? null);
      return (a[0] as SSValue[]).length;
    });
    this.def('contains', (a, p) => {
      const arr = a[0];
      if (!Array.isArray(arr)) throw new RuntimeError('contains 需要数组', p.start, p.end);
      return arr.some((x) => this.ssEqual(x, a[1] ?? null));
    });
    this.def('join', (a, p) => {
      if (!Array.isArray(a[0])) throw new RuntimeError('join 需要数组', p.start, p.end);
      const sep = typeof a[1] === 'string' ? a[1] : '';
      return (a[0] as SSValue[]).map((x) => this.toDisplay(x)).join(sep);
    });

    // 单位查询
    this.def('get_unit', (a, p) => {
      const id = this.requireString(a[0] ?? '', p, 'get_unit');
      this.engine.requireUnit(id);
      return this.unitRef(id);
    });
    this.def('all_units', () => [...this.engine.units.keys()].map((id) => this.unitRef(id)));
    this.def('allies_of', (a, p) => {
      const u = this.requireUnitArg(a[0] ?? null, p);
      const team = this.engine.requireUnit(u.id).spec.team;
      // 包含死亡单位（亡语等场景需要对全队生效），由调用方按需判断 alive
      return [...this.engine.units.values()].filter((x) => x.spec.team === team).map((x) => this.unitRef(x.spec.id));
    });
    this.def('enemies_of', (a, p) => {
      const u = this.requireUnitArg(a[0] ?? null, p);
      const team = this.engine.requireUnit(u.id).spec.team;
      return [...this.engine.units.values()].filter((x) => x.spec.team !== team && x.alive).map((x) => this.unitRef(x.spec.id));
    });
    this.def('is_alive', (a, p) => {
      const u = this.requireUnitArg(a[0] ?? null, p);
      return this.engine.requireUnit(u.id).alive;
    });
    this.def('stat', (a, p) => {
      const u = this.requireUnitArg(a[0] ?? null, p);
      const name = this.requireString(a[1] ?? '', p, 'stat');
      if (!BattleEngine.isStatName(name)) throw new RuntimeError(`未知属性 "${name}"`, p.start, p.end);
      return this.engine.getStat(u.id, name);
    });
    this.def('element_mult', (a, p) => {
      const atk = this.requireString(a[0] ?? '', p, 'element_mult');
      const def = this.requireString(a[1] ?? '', p, 'element_mult');
      return this.engine.elementMult(atk, def);
    });

    // 生命/法力
    this.def('damage', (a, p) => {
      const attacker = this.requireUnitArg(a[0] ?? null, p);
      const target = this.requireUnitArg(a[1] ?? null, p);
      const amount = this.requireNumber(a[2] ?? 0, p, 'damage');
      const element = this.requireString(a[3] ?? 'phys', p, 'damage');
      return this.engine.applyDamage(attacker.id, target.id, amount, element);
    });
    /**
     * try_damage：脚本驱动的完整命中流程。
     * 参数：攻击者, 目标, 基础伤害, 元素, 暴击率(%), 暴击伤害加成(%), 闪避率(%)
     * 返回数组 [是否命中, 是否暴击, 最终伤害]，闪避时不结算伤害。
     */
    this.def('try_damage', (a, p) => {
      const attacker = this.requireUnitArg(a[0] ?? null, p);
      const target = this.requireUnitArg(a[1] ?? null, p);
      const base = this.requireNumber(a[2] ?? 0, p, 'try_damage');
      const element = this.requireString(a[3] ?? 'phys', p, 'try_damage');
      const critRate = this.requireNumber(a[4] ?? 0, p, 'try_damage');
      const critDmgBonus = this.requireNumber(a[5] ?? 50, p, 'try_damage');
      const dodgeRate = this.requireNumber(a[6] ?? 0, p, 'try_damage');
      if (this.engine.rng.chance(dodgeRate / 100)) {
        this.engine.log('dodge', `${this.engine.nameOf(target.id)} 闪避了 ${this.engine.nameOf(attacker.id)} 的攻击`);
        return [0, 0, 0];
      }
      const isCrit = this.engine.rng.chance(critRate / 100);
      let amount = base;
      if (isCrit) {
        amount = amount * (1 + critDmgBonus / 100);
        this.engine.log('crit', `暴击！伤害提升 ${critDmgBonus}%`);
      }
      const dealt = this.engine.applyDamage(attacker.id, target.id, amount, element);
      return [1, isCrit ? 1 : 0, dealt];
    });
    this.def('heal', (a, p) => {
      const source = this.requireUnitArg(a[0] ?? null, p);
      const target = this.requireUnitArg(a[1] ?? null, p);
      const amount = this.requireNumber(a[2] ?? 0, p, 'heal');
      // source 已死亡时（如亡语）仍允许以其名义治疗
      return this.engine.applyHeal(source.id, target.id, amount);
    });
    this.def('add_mp', (a, p) => {
      const u = this.requireUnitArg(a[0] ?? null, p);
      return this.engine.addMp(u.id, this.requireNumber(a[1] ?? 0, p, 'add_mp'));
    });

    // buff
    this.def('add_buff', (a, p) => {
      const target = this.requireUnitArg(a[0] ?? null, p);
      const defName = this.requireString(a[1] ?? '', p, 'add_buff');
      const source = a[2] ? this.requireUnitArg(a[2], p).id : target.id;
      const def = this.engine.defs.buffs.get(defName);
      if (!def) throw new RuntimeError(`未知 buff 定义 "${defName}"`, p.start, p.end);
      const buff = this.engine.addBuff(target.id, defName, source, (active) => {
        const env = new Environment(`buff ${defName}`, this.globalEnv);
        env.declare('owner', this.unitRef(active.ownerId), p.start);
        env.declare('source', this.unitRef(active.sourceId), p.start);
        this.runBuffBody(def, env);
        this.buffEnvs.set(active.instanceId, env);
      });
      return buff.instanceId;
    });
    this.def('has_buff', (a, p) => {
      const u = this.requireUnitArg(a[0] ?? null, p);
      const name = this.requireString(a[1] ?? '', p, 'has_buff');
      return this.engine.findBuff(u.id, name) !== undefined;
    });
    this.def('buff_stacks', (a, p) => {
      const u = this.requireUnitArg(a[0] ?? null, p);
      const name = this.requireString(a[1] ?? '', p, 'buff_stacks');
      return this.engine.findBuff(u.id, name)?.stacks ?? 0;
    });
    this.def('remove_buff', (a, p) => {
      const u = this.requireUnitArg(a[0] ?? null, p);
      const name = this.requireString(a[1] ?? '', p, 'remove_buff');
      return this.engine.removeBuffByName(u.id, name);
    });

    // 触发器
    this.def('fire_event', (a, p) => {
      const rawKind = this.requireString(a[0] ?? '', p, 'fire_event');
      const kind = (rawKind.startsWith('on_') ? rawKind : `on_${rawKind}`) as BattleEvent['kind'];
      const valid = ['on_hit', 'on_take_hit', 'on_turn_start', 'on_death'];
      if (!valid.includes(kind)) {
        throw new RuntimeError(`fire_event 未知事件 "${rawKind}"，可选：${valid.join(', ')}`, p.start, p.end);
      }
      const event: BattleEvent = { kind, explicit: true };
      if (a[1]) event.attackerId = this.requireUnitArg(a[1], p).id;
      if (a[2]) event.targetId = this.requireUnitArg(a[2], p).id;
      if (typeof a[3] === 'number') event.amount = a[3];
      if (typeof a[4] === 'string') event.element = a[4];
      this.engine.fireEventSync(event);
      return null;
    });

    // buff 体内配置
    this.def('set_duration', (a, p) => {
      this.engine.configureCurrentBuff({ duration: this.requireNumber(a[0] ?? 0, p, 'set_duration') });
      return null;
    });
    this.def('set_stacking', (a, p) => {
      const rule = this.requireString(a[0] ?? '', p, 'set_stacking');
      if (rule !== 'refresh' && rule !== 'stack' && rule !== 'separate') {
        throw new RuntimeError('叠层规则只能是 refresh / stack / separate', p.start, p.end);
      }
      this.engine.configureCurrentBuff({ stacking: rule });
      return null;
    });
    this.def('set_max_stacks', (a, p) => {
      this.engine.configureCurrentBuff({ maxStacks: this.requireNumber(a[0] ?? 1, p, 'set_max_stacks') });
      return null;
    });
    this.def('mod_stat', (a, p) => {
      const stat = this.requireString(a[0] ?? '', p, 'mod_stat');
      if (!BattleEngine.isStatName(stat)) throw new RuntimeError(`未知属性 "${stat}"`, p.start, p.end);
      const value = this.requireNumber(a[1] ?? 0, p, 'mod_stat');
      const mode = a[2] === 'percent' ? 'percent' : 'flat';
      this.engine.addCurrentBuffMod(stat, value, mode);
      return null;
    });
  }
}
