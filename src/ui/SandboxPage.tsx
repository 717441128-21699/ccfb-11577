import { useState } from 'react';
import { useEditor, useSandbox } from './studio';
import { UnitCard } from './UnitCard';
import { useBattle } from './battleContext';
import type { SandboxResult } from './studio';

const SKILL_CHOICES = [
  'flame_slash', 'power_strike', 'heavy_blow', 'heal_light', 'regeneration',
  'burn_dot', 'poison_dart', 'arcane_shield', 'combo_strike', 'execute',
  'life_drain', 'elusive_strike', 'sweep', 'purifying_strike', 'weaken_curse',
  'chain_lightning', 'mana_burn', 'infinite_loop',
];

export function SandboxPage() {
  const editor = useEditor();
  const sb = useSandbox();
  const { setBattle } = useBattle();
  const [result, setResult] = useState<SandboxResult | null>(null);
  const [caster, setCaster] = useState('hero');
  const [skill, setSkill] = useState(SKILL_CHOICES[0]);
  const [target, setTarget] = useState('enemy');

  function run() {
    const r = sb.run(editor.source);
    setResult(r);
    if (r.ok && r.controller && r.engine) {
      setBattle({ controller: r.controller, engine: r.engine, source: editor.source, at: Date.now() });
    }
  }

  const units = result?.engine?.snapshot() ?? sb.units.map((u) => ({
    id: u.id, name: u.name, team: u.team, hp: u.hp ?? u.maxHp, mp: u.mp ?? u.maxMp,
    maxHp: u.maxHp, maxMp: u.maxMp, alive: true, atk: u.atk, def: u.def, spd: u.spd,
    critRate: u.critRate, critDmg: u.critDmg, dodge: u.dodge, buffs: [],
  }));

  return (
    <div className="page">
      <div className="grid-2">
        <div className="card">
          <h3>战斗配置</h3>
          <div className="field">
            <label>随机种子（相同种子结果完全可复现）</label>
            <input type="number" value={sb.seed} onChange={(e) => sb.setSeed(Number(e.target.value))} />
          </div>

          <h3>施法序列（{sb.casts.length} 步）</h3>
          <table>
            <thead><tr><th>#</th><th>施法者</th><th>技能</th><th>目标</th><th></th></tr></thead>
            <tbody>
              {sb.casts.map((c, i) => (
                <tr key={i}>
                  <td className="mono">{i + 1}</td>
                  <td className="mono">{c.casterId}</td>
                  <td className="mono">{c.skillName}</td>
                  <td className="mono">{c.targetId}</td>
                  <td>
                    <button className="ghost" onClick={() => sb.setCasts(sb.casts.filter((_, j) => j !== i))}>删</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="controls row-gap">
            <select value={caster} onChange={(e) => setCaster(e.target.value)} style={{ width: 110 }}>
              {sb.units.map((u) => <option key={u.id} value={u.id}>{u.id}</option>)}
            </select>
            <select value={skill} onChange={(e) => setSkill(e.target.value)} style={{ width: 160 }}>
              {SKILL_CHOICES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={target} onChange={(e) => setTarget(e.target.value)} style={{ width: 110 }}>
              {sb.units.map((u) => <option key={u.id} value={u.id}>{u.id}</option>)}
            </select>
            <button
              className="ghost"
              onClick={() => sb.setCasts([...sb.casts, { casterId: caster, skillName: skill, targetId: target }])}
            >
              + 加入序列
            </button>
          </div>

          <div className="controls">
            <button onClick={run}>▶ 运行战斗</button>
            <button className="ghost" onClick={() => { sb.setCasts([]); setResult(null); }}>清空序列</button>
            {result && <span className="pill">{result.ok ? `trace ${result.controller?.totalSteps} 步` : '运行失败'}</span>}
          </div>

          {result && !result.ok && (
            <div className="error-box row-gap">{result.error}</div>
          )}
          {result?.ok && (
            <div className="ok-box row-gap">
              战斗结束，共 {result.engine?.logs.length} 条日志、{result.engine?.changes.length} 条属性变更。
              切换到「结算日志」看完整流水，「单步调试」逐语句回放。
            </div>
          )}
        </div>

        <div className="card">
          <h3>单位状态（战斗后）</h3>
          {units.map((u) => <UnitCard key={u.id} unit={u} />)}
        </div>
      </div>
    </div>
  );
}
