# 足球联赛赛程编排工具

二十支球队双循环（38 轮 × 每轮 10 场）的自动化赛程编排，支持硬约束满足、软约束优化、手动编辑即时校验与数据导出。

## 快速开始

```bash
npm install
npm run demo          # 用内置示例数据生成赛程到 out/
npm test              # 运行测试套件
npm run build         # 类型检查 + 编译到 dist/
```

### 命令行

```bash
# 生成赛程（默认 9 秒预算，必须在 10 秒内返回）
npx tsx src/cli.ts generate data/sample-input.json --out out --time 9000

# 校验已有赛程（手动调整后复查）
npx tsx src/cli.ts validate data/sample-input.json out/schedule.json

# 应用手动编辑并即时校验
npx tsx src/cli.ts edit data/sample-input.json out/schedule.json edit.json --out out
```

`edit.json` 支持三种编辑：

```json
{ "kind": "swapRounds", "roundA": 3, "roundB": 7 }
{ "kind": "flipVenue", "round": 5, "matchIndexOrTeamId": "team_crimson_fc" }
{ "kind": "swapHomes", "round": 2, "matchAIndexOrTeamId": 0, "matchBIndexOrTeamId": 3 }
```

## 输入数据

见 `data/sample-input.json`，包含：

- `teams`：球队、主场球场、同城分组、是否欧战
- `stadiums`：球场被演唱会等活动占用的轮次
- `rounds`：每轮日期、是否周末、该周是否有欧战
- `derbies`：必须安排在周末的德比对阵

## 约束模型

**硬约束（必须满足，权重 1000）**

| 约束 | 含义 |
| --- | --- |
| `stadium_blocked` | 球场被占用的轮次不能安排该队主场 |
| `stadium_double_booking` | 同一球场同一轮只能有一场 |
| `city_home_conflict` | 同城球队同一轮不能都在主场 |
| `three_consecutive_away` | 禁止连续三个客场 |
| `derby_not_weekend` | 德比必须落在周末轮 |

**软约束（尽量优化）**：主客交替、欧战球队连客休息、半程主客均衡。

## 求解架构

```
圆环法（circle method）
  保证双循环赛制：每对球队每半程对阵一次、每队每轮一场、每轮 10 场
        │
        ▼
随机骨架 = 球队圆环排列 × 轮次排列
        │
        ▼
朝向求解（orientation-csp）
  阶段一：球队主客变量 XOR 图，保证同城互补、规避球场占用
  阶段二：混合邻域 min-conflicts + 模拟退火，消三连客、压软违规
        │
        ▼
轮次定向交换（solver）
  把含非周末德比的轮次换入周末日历槽，再回调朝向适配
        │
        ▼
多骨架重启（墙钟 + 固定骨架数双重边界，同 seed 结果可复现）
```

关键设计：

- **迭代驱动而非墙钟驱动**内部随机，保证相同 seed 产出完全相同的赛程。
- 搜索在 `Int8Array` 紧凑缓冲上进行，热循环零对象分配。
- 结构性预检能在毫秒级确定性识别"输入容量不足"类不可行（如球场可用轮少于所需主场数），无需搜索。
- 无法清零硬违规时返回**最优努力赛程** + 冲突诊断，明确指出冲突约束族，而不是直接失败。

## 导出

- `result.json`：完整结果（含违规明细与诊断）
- `schedule.json`：仅赛程，供游戏数据表使用
- `matches.csv`：比赛粒度（UTF-8 BOM，Excel 直接打开）
- `team-matrix.csv`：球队 × 轮次主客矩阵（H/A）

## 目录结构

```
src/
  types.ts            输入/输出/违规类型
  rng.ts              确定性随机数
  model.ts            圆环法与索引化问题模型
  evaluator.ts        紧凑缓冲评估器（硬/软违规统计）
  orientation-csp.ts  朝向 XOR 构造 + min-conflicts
  solver.ts           多重启联合求解（骨架/朝向/轮次）
  diagnose.ts         结构性预检 + 松弛探针
  schedule.ts         赛程对象物化
  editor.ts           手动编辑与即时校验
  export.ts           JSON / CSV 导出
  index.ts            库入口 generateSchedule
  cli.ts              命令行入口
```
