import { describe, expect, it } from 'vitest';
import { loadPrograms, runBattle } from '../runtime/runner';
import { makeUnit, standardDuo } from './fixtures';

const featureSource = `
skill cond_test {
  let x = 10;
  if (x > 5) {
    x = x * 2;
  } else {
    x = 0;
  }
  damage(caster, target, x, "phys");
}

skill loop_sum {
  let sum = 0;
  let i = 1;
  while (i <= 5) {
    sum = sum + i;
    i = i + 1;
  }
  damage(caster, target, sum, "phys");
}

skill array_test {
  let list = [10, 20, 30];
  let total = 0;
  let j = 0;
  while (j < len(list)) {
    total = total + list[j];
    j = j + 1;
  }
  if (contains(list, 20)) {
    damage(caster, target, total, "phys");
  }
}

skill scope_test {
  let outer = 5;
  if (1 == 1) {
    let inner = outer + 3;
    damage(caster, target, inner, "phys");
  }
}

skill break_test {
  let i = 0;
  let hits = 0;
  while (i < 10) {
    if (i == 3) {
      break;
    }
    hits = hits + 1;
    i = i + 1;
  }
  damage(caster, target, hits * 10, "phys");
}

skill continue_test {
  let i = 0;
  let evens = 0;
  while (i < 6) {
    i = i + 1;
    if (i % 2 == 1) {
      continue;
    }
    evens = evens + 1;
  }
  damage(caster, target, evens * 10, "phys");
}
`;

const programs = loadPrograms([{ name: 'feature', source: featureSource }]);

function cast(skillName: string, seed = 7) {
  return runBattle(standardDuo(), programs, [{ casterId: 'hero', skillName, targetId: 'enemy' }], { seed });
}

describe('语言特性：条件/循环/变量/数组/作用域/控制流', () => {
  it('if-else 条件分支：x=10>5 走 then，伤害 20', () => {
    const r = cast('cond_test');
    expect(r.engine.requireUnit('enemy').hp).toBe(500 - 20);
  });

  it('while 循环累加 1..5 = 15', () => {
    const r = cast('loop_sum');
    expect(r.engine.requireUnit('enemy').hp).toBe(500 - 15);
  });

  it('数组下标、len、contains：10+20+30=60', () => {
    const r = cast('array_test');
    expect(r.engine.requireUnit('enemy').hp).toBe(500 - 60);
  });

  it('块级作用域：inner 能读取外层 outer，5+3=8', () => {
    const r = cast('scope_test');
    expect(r.engine.requireUnit('enemy').hp).toBe(500 - 8);
  });

  it('break 在 i==3 跳出，hits=3 → 30 伤害', () => {
    const r = cast('break_test');
    expect(r.engine.requireUnit('enemy').hp).toBe(500 - 30);
  });

  it('continue 跳过奇数，1..6 中偶数 3 个 → 30 伤害', () => {
    const r = cast('continue_test');
    expect(r.engine.requireUnit('enemy').hp).toBe(500 - 30);
  });

  it('let 重复声明在同作用域报运行错误', () => {
    const src = `skill dup { let a = 1; let a = 2; damage(caster, target, a, "phys"); }`;
    const p = loadPrograms([{ name: 'd', source: src }]);
    expect(() => runBattle(standardDuo(), p, [{ casterId: 'hero', skillName: 'dup', targetId: 'enemy' }])).toThrowError(/重复声明/);
  });

  it('未定义变量报带位置的运行错误', () => {
    const src = `skill undef { damage(caster, target, missing_var, "phys"); }`;
    const p = loadPrograms([{ name: 'u', source: src }]);
    expect(() => runBattle(standardDuo(), p, [{ casterId: 'hero', skillName: 'undef', targetId: 'enemy' }])).toThrowError(/未定义的变量/);
  });

  it('除零报错', () => {
    const src = `skill divzero { let x = 1 / 0; damage(caster, target, x, "phys"); }`;
    const p = loadPrograms([{ name: 'z', source: src }]);
    expect(() => runBattle(standardDuo(), p, [{ casterId: 'hero', skillName: 'divzero', targetId: 'enemy' }])).toThrowError(/除数不能为 0/);
  });
});

describe('确定性：相同种子产生完全一致的结算', () => {
  it('两场同种子战斗的日志与最终血量逐字相同', () => {
    const units = standardDuo();
    const runs = [1, 2].map(() =>
      runBattle(units, programs, [
        { casterId: 'hero', skillName: 'loop_sum', targetId: 'enemy' },
        { casterId: 'hero', skillName: 'array_test', targetId: 'enemy' },
      ], { seed: 123 }),
    );
    expect(runs[0].engine.logs.map((l) => l.message)).toEqual(runs[1].engine.logs.map((l) => l.message));
    expect(runs[0].engine.requireUnit('enemy').hp).toBe(runs[1].engine.requireUnit('enemy').hp);
  });

  it('不同种子在含随机技能时可能产生不同结果', () => {
    const lib = loadPrograms([
      // 复用 elusive_strike（含 try_damage 随机闪避/暴击）
      // 这里用内联随机技能避免依赖库文件路径
      {
        name: 'rnd',
        source: `skill rnd_strike {
          let roll = rand_int(1, 100);
          damage(caster, target, roll, "phys");
        }`,
      },
    ]);
    const hp = (seed: number) =>
      runBattle(standardDuo(), lib, [{ casterId: 'hero', skillName: 'rnd_strike', targetId: 'enemy' }], { seed })
        .engine.requireUnit('enemy').hp;
    const results = new Set([hp(1), hp(2), hp(3), hp(4), hp(5)]);
    expect(results.size).toBeGreaterThan(1);
  });
});

describe('多单位与触发器覆盖', () => {
  it('on_turn_start 在每个存活单位回合开始时触发（先压蓝验证回复）', () => {
    const src = `
      skill ts_counter {
        on "turn_start" {
          add_mp(unit, 5);
        }
      }`;
    const p = loadPrograms([{ name: 't', source: src }]);
    const units = [
      makeUnit({ id: 'a', name: '甲', team: 1, passiveSkills: ['ts_counter'], mp: 50 }),
      makeUnit({ id: 'b', name: '乙', team: 2, passiveSkills: ['ts_counter'], mp: 50 }),
    ];
    const r = runBattle(units, p, [], { seed: 1 });
    r.engine.startTurn();
    expect(r.engine.requireUnit('a').mp).toBe(55);
    expect(r.engine.requireUnit('b').mp).toBe(55);
  });
});
