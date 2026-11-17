# SkillScript Studio

面向回合制 RPG 的技能脚本语言（DSL）+ 树遍历解释器 + 战斗引擎 + 五页网页调试台。
策划可以直接用 SkillScript 写技能，语言负责词法/语法检查与行列级报错，引擎负责
buff 叠层、触发器连锁、防死循环，调试台支持单步回放每一次属性变更。

## 快速开始

```bash
npm install
npm test          # 49 个测试，含 20 个技能的手算期望值逐条对账
npm run dev       # 打开 http://localhost:5173 使用网页调试台
npm run build     # 类型检查 + 生产构建
```

## 目录结构

```
src/
├─ lang/                  语言层（与战斗引擎完全解耦，可独立使用）
│  ├─ tokens.ts           Token 类型与关键字表
│  ├─ lexer.ts            词法分析器（每个 token 带行/列/index）
│  ├─ ast.ts              AST 定义
│  ├─ parser.ts           递归下降语法分析器（优先级、语句、声明、触发器）
│  ├─ errors.ts           Lex/Parse/Runtime/TriggerDepth 错误，全部携带 Pos
│  ├─ position.ts         行列位置与源码片段渲染（^ 光标）
│  └─ compiler.ts         词法+语法一体入口，错误格式化为 行:列 + 片段
├─ runtime/               运行时
│  ├─ rng.ts              mulberry32 种子随机，保证战斗可复现
│  ├─ types.ts            单位/buff/事件/日志/快照类型
│  ├─ environment.ts      词法作用域链 + 调试快照
│  ├─ battle.ts           战斗引擎：有效属性、buff 同名规则、伤害治疗、
│  │                      触发器深度保护、变更追踪
│  ├─ interpreter.ts      树遍历解释器：表达式/语句/内置函数/事件分发/trace
│  ├─ trace.ts            单步事件结构
│  ├─ debugger.ts         调试控制器：单步/回退/断点/变更过滤
│  └─ runner.ts           多脚本加载 + 战斗门面
├─ skills/
│  ├─ library.ss          20 个技能脚本（含 5 个 buff 定义、多个被动触发器）
│  └─ edge_cases.ss       死循环与触发器连锁超深的异常演示
├─ test/                  vitest 测试（语言特性 + 20 技能手算对账 + 异常保护）
└─ ui/                    React 五页调试台
   ├─ SkillEditorPage     技能编写（片段插入、实时校验、内置库浏览）
   ├─ SyntaxCheckPage     语法检查（token 流、行列错误、声明结构）
   ├─ SandboxPage         战斗沙盘（单位、施法序列、种子、结果）
   ├─ BattleLogPage       结算日志（类型过滤、连锁深度、属性变更流水）
   └─ DebugPage           单步调试（断点、当前行、变量、每步改了谁的哪个属性）
```

## SkillScript 语言一览

### 顶层声明

```
skill 名称 { 语句...  on "事件" { 语句... } }
buff  名称 { 配置语句  on "事件" { 语句... } }
```

触发器事件：`"hit"`（命中时）、`"take_hit"`（受击时）、`"turn_start"`（回合开始）、`"death"`（单位死亡）。

### 语法要素

- 变量：`let x = 表达式;`（块级作用域，同作用域重复声明报错）
- 赋值：`x = 新值;`，支持成员 `a.b` 与下标 `a[0]`
- 条件：`if (cond) { ... } else if (...) { ... } else { ... }`
- 循环：`while (cond) { ... }`，配 `break;` / `continue;`
- 运算：`+ - * / %`、比较 `== != < > <= >=`、逻辑 `and or not`（短路）
- 数组：`[1, 2, 3]`、字符串、布尔、数字
- 注释：`//`、`#` 行注释与 `/* */` 块注释

### 常用内置函数

| 函数 | 说明 |
| --- | --- |
| `stat(u, "atk")` | 取单位**有效**属性（含 buff 修正） |
| `damage(att, target, amount, element)` | 结算最终伤害并触发受击/死亡事件 |
| `try_damage(...)` | 脚本驱动的命中流程：闪避→暴击→伤害，返回 `[命中, 暴击, 伤害]` |
| `heal / add_mp` | 治疗 / 法力增减（均受上限钳制） |
| `element_mult(atkEl, defEl)` | 元素克制倍率查表 |
| `add_buff / has_buff / buff_stacks / remove_buff` | buff 生命周期 |
| `set_stacking / set_max_stacks / set_duration / mod_stat` | buff 声明体内配置 |
| `fire_event("hit", att, target, amount, element)` | 显式触发事件 |
| `all_units / allies_of / enemies_of / is_alive / get_unit` | 单位查询 |
| `rand / rand_int / chance` | 种子随机 |
| `len / push / contains / join / min / max / clamp / floor / round ...` | 工具函数 |

暴击、闪避、元素克制全部由脚本表达，引擎不内置任何战斗公式。

## 关键设计

### Buff 同名效果的三种规则（`set_stacking`）

- `refresh`：已存在则只刷新持续时间，层数不变（如护盾）
- `stack`：层数 +1，受 `set_max_stacks` 上限约束，属性修正按层数缩放（如怒意、中毒）
- `separate`：总是创建独立实例

属性修正 `mod_stat(stat, value, "flat"|"percent")`：
flat 按层累加；percent 采用**加性模型**（+30% 与 -30% 互相抵消，避免负数累乘出错）。

### 触发器连锁与防死循环

- 每个事件同步分发到：单位被动技能 → buff 实例触发器 → 当前技能的 on 块
- `fireEventSync` 维护连锁深度，超过 `maxTriggerDepth`（默认 32）抛
  `TriggerDepthError`，错误携带完整连锁链
- `while` 循环有 `maxLoopIterations`（默认 10000）迭代上限

### 单步调试

一次战斗产生全量 trace（每条语句一个 StepEvent：行号、执行前变量快照、
调用帧、单位快照、该语句引起的属性变更）。调试器在 trace 上做
单步/回退/运行到断点，因此回放与真实结算顺序严格一致，
并能精确回答“这一步改了谁的哪个属性，从多少变成多少”。

## 测试与手算对账

`src/test/skills.test.ts` 对 20 个技能逐个给出手算期望值，例如：

- `flame_slash`：`(100 - 40×0.5) × 火克草2 = 160`
- `combo_strike`：`3 × (100×0.45 - 40×0.2) = 111`
- `chain_lightning`：主伤 `(90-12)=78` + on_hit 追加 `100×0.4=40`
- `weaken_curse`：攻击 `-30%` → `100×(1-0.3)=70`

随机相关技能固定种子并在注释中给出探针实测值，保证可复现。
