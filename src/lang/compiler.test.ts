import { describe, expect, it } from 'vitest';
import { parseSource, formatError } from './compiler';
import { Lexer } from './lexer';
import { TokenType } from './tokens';

describe('词法分析器', () => {
  it('识别数字、字符串、关键字与运算符', () => {
    const tokens = new Lexer('let x = 1.5 + 2; // 注释\nif (x >= 3) { "ok" }').tokenize();
    const types = tokens.map((t) => t.type);
    expect(types).toContain(TokenType.Let);
    expect(types).toContain(TokenType.Number);
    expect(types).toContain(TokenType.GtEq);
    expect(types).toContain(TokenType.String);
    expect(types.at(-1)).toBe(TokenType.EOF);
  });

  it('记录 token 的行列位置', () => {
    const tokens = new Lexer('let x = 1;\nlet y = 2;').tokenize();
    const secondLet = tokens.find((t) => t.type === TokenType.Let && t.pos.line === 2);
    expect(secondLet?.pos).toEqual({ line: 2, col: 1, index: 11 });
  });

  it('非法字符带行列报错', () => {
    expect(() => new Lexer('let x = @;').tokenize()).toThrowError(/无法识别/);
  });

  it('未闭合字符串报错', () => {
    expect(() => new Lexer('let s = "abc;').tokenize()).toThrowError(/结束引号/);
  });
});

describe('语法分析器', () => {
  it('解析完整 skill 与 buff 声明及触发器', () => {
    const result = parseSource(`
      skill s {
        let x = 1;
        on "hit" { damage(caster, target, x, "fire"); }
      }
      buff b {
        set_stacking("stack");
        mod_stat("atk", 10, "flat");
      }
    `);
    expect(result.ok).toBe(true);
    expect(result.program?.decls).toHaveLength(2);
    const skill = result.program?.decls[0];
    expect(skill?.kind).toBe('SkillDecl');
    if (skill?.kind === 'SkillDecl') expect(skill.triggers[0].event).toBe('on_hit');
  });

  it('解析 else if 链与 while 循环', () => {
    const result = parseSource(`
      skill s {
        if (x == 1) { x = 2; } else if (x == 2) { x = 3; } else { x = 4; }
        while (x > 0) { x = x - 1; }
      }
    `);
    expect(result.ok).toBe(true);
  });

  it('解析数组与下标', () => {
    const result = parseSource('skill s { let a = [1, 2, 3]; let b = a[0]; }');
    expect(result.ok).toBe(true);
  });

  it('缺少分号时报错并指向行列', () => {
    const result = parseSource('skill s {\n  let x = 1\n  let y = 2;\n}');
    expect(result.ok).toBe(false);
    // 解析器读到下一条语句的 let 时才能确定上一条未结束，定位在第 3 行
    expect(result.errors[0].line).toBe(3);
    expect(result.errors[0].col).toBe(3);
    expect(result.errors[0].full).toContain('语法错误');
    expect(result.errors[0].full).toContain(';');
  });

  it('未知触发器事件报错', () => {
    const result = parseSource('skill s { on "explode" { x = 1; } }');
    expect(result.ok).toBe(false);
    expect(result.errors[0].message).toContain('未知触发器事件');
  });

  it('赋值给非法目标报错', () => {
    const result = parseSource('skill s { 1 = 2; }');
    expect(result.ok).toBe(false);
  });

  it('顶层非法声明报错', () => {
    const result = parseSource('let x = 1;');
    expect(result.ok).toBe(false);
    expect(result.errors[0].message).toContain('skill 或 buff');
  });
});

describe('错误格式化', () => {
  it('输出带行号与光标的片段', () => {
    const result = parseSource('skill s {\n  let x = ;\n}');
    expect(result.ok).toBe(false);
    const formatted = formatError(new Error('x'), '');
    expect(formatted.phase).toBe('runtime');
    expect(result.errors[0].snippet).toContain('|');
    expect(result.errors[0].snippet).toContain('^');
  });
});
