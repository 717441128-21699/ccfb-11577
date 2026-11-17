import { useEffect, useState } from 'react';
import { useBattle } from './battleContext';
import { CodeEditor } from './CodeEditor';
import { UnitCard } from './UnitCard';
import type { StepEvent } from '../runtime/trace';

function displayValue(v: unknown): string {
  if (v === null) return 'null';
  if (typeof v === 'object') {
    if (v && '__unit' in v) return `Unit(${(v as unknown as { id: string }).id})`;
    if (Array.isArray(v)) return `[${v.map(displayValue).join(', ')}]`;
  }
  return String(v);
}

export function DebugPage() {
  const { battle } = useBattle();
  const [, force] = useState(0);
  const [breakpoints, setBreakpoints] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (battle) {
      battle.controller.reset();
      battle.controller.step();
      force((n) => n + 1);
    }
  }, [battle]);

  if (!battle) {
    return <div className="page"><div className="card"><h3>单步调试</h3><p className="muted">请先到「战斗沙盘」运行一场战斗。</p></div></div>;
  }

  const dbg = battle.controller;
  const step: StepEvent | null = dbg.current;

  function update() { force((n) => n + 1); }
  function toggleBp(line: number) {
    const next = new Set(breakpoints);
    if (next.has(line)) next.delete(line); else next.add(line);
    setBreakpoints(next);
    dbg.breakpoints.clear();
    next.forEach((l) => dbg.breakpoints.add(l));
  }

  const vars = step?.varsBefore ?? {};
  const varEntries = Object.entries(vars).filter(([k]) => !['caster', 'target', 'self'].includes(k));
  const ctxEntries = Object.entries(vars).filter(([k]) => ['caster', 'target', 'self'].includes(k));

  return (
    <div className="page">
      <div className="controls">
        <h3 style={{ margin: 0 }}>单步调试</h3>
        <button onClick={() => { dbg.stepBack(); update(); }} disabled={dbg.position <= 0}>← 上一步</button>
        <button onClick={() => { dbg.step(); update(); }} disabled={dbg.position >= dbg.totalSteps - 1}>下一步 →</button>
        <button className="ghost" onClick={() => { dbg.runToBreakpoint(); update(); }}>▶ 运行到断点</button>
        <button className="ghost" onClick={() => { dbg.reset(); dbg.step(); update(); }}>重置</button>
        <span className="pill">步骤 {dbg.position + 1} / {dbg.totalSteps}</span>
        <span className="pill">行 {step?.line ?? '-'}:{step?.col ?? '-'}</span>
        <span className="muted" style={{ fontSize: 12 }}>点击左侧行号可切换断点</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.9fr', gap: 16, height: 'calc(100% - 60px)', minHeight: 420 }}>
        <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
          <h3>脚本执行位置</h3>
          <div style={{ flex: 1, minHeight: 300 }}>
            <CodeEditor
              source={battle.source}
              readOnly
              activeLine={step?.line}
              breakpoints={breakpoints}
              onToggleBreakpoint={toggleBp}
            />
          </div>
          <div className="row-gap">
            <h3>调用帧</h3>
            {(step?.frames ?? []).map((f, i) => (
              <span key={i} className="frame-chip">{f.name}: {f.detail}</span>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, overflow: 'auto' }}>
          <div className="card">
            <h3>本语句属性变更（谁的哪个属性）</h3>
            {step && step.changes.length > 0 ? (
              <table>
                <thead><tr><th>单位</th><th>属性</th><th>旧 → 新</th><th>原因</th></tr></thead>
                <tbody>
                  {step.changes.map((c, i) => (
                    <tr key={i}>
                      <td>{c.unitName}</td>
                      <td className="mono">{c.prop}</td>
                      <td className="mono">
                        <span className="change-old">{c.oldValue}</span> → <span className="change-new">{c.newValue}</span>
                      </td>
                      <td className="muted">{c.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="muted" style={{ fontSize: 12.5 }}>该语句没有修改任何单位属性。</p>
            )}
          </div>

          <div className="card">
            <h3>变量（语句执行前快照）</h3>
            {ctxEntries.map(([k, v]) => (
              <div key={k} className="var-row"><span className="vname">{k}</span><span className="vval">{displayValue(v)}</span></div>
            ))}
            {varEntries.length === 0 ? (
              <p className="muted" style={{ fontSize: 12.5 }}>当前作用域暂无局部变量。</p>
            ) : (
              varEntries.map(([k, v]) => (
                <div key={k} className="var-row"><span className="vname">{k}</span><span className="vval">{displayValue(v)}</span></div>
              ))
            )}
          </div>

          <div className="card">
            <h3>单位实时状态</h3>
            {dbg.unitsAtCurrent().map((u) => <UnitCard key={u.id} unit={u} />)}
          </div>
        </div>
      </div>
    </div>
  );
}
