import { RuntimeError } from '../lang/errors';
import type { Pos } from '../lang/position';
import type { SSValue } from './types';

/** 词法作用域链，支持 let 块级作用域。 */
export class Environment {
  private readonly vars = new Map<string, SSValue>();

  constructor(
    public readonly name: string,
    public readonly parent: Environment | null = null,
  ) {}

  declare(name: string, value: SSValue, pos: Pos): void {
    if (this.vars.has(name)) {
      throw new RuntimeError(`变量 "${name}" 在当前作用域重复声明`, pos);
    }
    this.vars.set(name, value);
  }

  has(name: string): boolean {
    return this.vars.has(name) || (this.parent?.has(name) ?? false);
  }

  get(name: string, pos: Pos): SSValue {
    if (this.vars.has(name)) return this.vars.get(name)!;
    if (this.parent) return this.parent.get(name, pos);
    throw new RuntimeError(`未定义的变量 "${name}"`, pos);
  }

  set(name: string, value: SSValue, pos: Pos): void {
    if (this.vars.has(name)) {
      this.vars.set(name, value);
      return;
    }
    if (this.parent) {
      this.parent.set(name, value, pos);
      return;
    }
    throw new RuntimeError(`未定义的变量 "${name}"，请先用 let 声明`, pos);
  }

  /** 调试器用：展开整条作用域链的变量快照（内层覆盖外层同名）。 */
  snapshot(): Record<string, SSValue> {
    const out: Record<string, SSValue> = {};
    const chain: Environment[] = [];
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let env: Environment | null = this;
    while (env) {
      chain.unshift(env);
      env = env.parent;
    }
    for (const e of chain) {
      for (const [k, v] of e.vars) out[k] = v;
    }
    return out;
  }

  scopeChain(): { name: string; vars: Record<string, SSValue> }[] {
    const chain: { name: string; vars: Record<string, SSValue> }[] = [];
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let env: Environment | null = this;
    while (env) {
      chain.push({ name: env.name, vars: Object.fromEntries(env.vars) });
      env = env.parent;
    }
    return chain.reverse();
  }
}
