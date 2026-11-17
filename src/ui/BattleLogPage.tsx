import { useMemo, useState } from 'react';
import { useBattle } from './battleContext';
import type { LogKind } from '../runtime/types';

const KIND_LABELS: Record<LogKind, string> = {
  info: '信息', cast: '施法', damage: '伤害', heal: '治疗', dodge: '闪避',
  crit: '暴击', buff_add: '获得', buff_refresh: '刷新', buff_stack: '叠层',
  buff_remove: '消失', trigger: '触发', death: '死亡', error: '错误',
};

export function BattleLogPage() {
  const { battle } = useBattle();
  const [filter, setFilter] = useState<LogKind | 'all'>('all');
  const [tab, setTab] = useState<'logs' | 'changes'>('logs');

  const logs = useMemo(() => {
    if (!battle) return [];
    return battle.engine.logs.filter((l) => filter === 'all' || l.kind === filter);
  }, [battle, filter]);

  if (!battle) {
    return <div className="page"><div className="card"><h3>结算日志</h3><p className="muted">请先到「战斗沙盘」运行一场战斗。</p></div></div>;
  }

  const kinds = Object.keys(KIND_LABELS) as LogKind[];

  return (
    <div className="page">
      <div className="card">
        <div className="controls">
          <h3 style={{ margin: 0 }}>结算日志</h3>
          <div className="tabs">
            <button className={`tab ${tab === 'logs' ? 'active' : ''}`} onClick={() => setTab('logs')}>战斗流水</button>
            <button className={`tab ${tab === 'changes' ? 'active' : ''}`} onClick={() => setTab('changes')}>属性变更</button>
          </div>
        </div>

        {tab === 'logs' && (
          <>
            <div className="controls">
              <button className={`tab ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>全部</button>
              {kinds.map((k) => (
                <button key={k} className={`tab ${filter === k ? 'active' : ''}`} onClick={() => setFilter(k)}>
                  {KIND_LABELS[k]}
                </button>
              ))}
              <span className="pill">{logs.length} 条 · 最大连锁深度 {Math.max(0, ...battle.engine.logs.map((l) => l.depth))}</span>
            </div>
            <div>
              {logs.map((l) => (
                <div key={l.index} className={`log-line kind-${l.kind}`}>
                  <span className="turn mono">T{l.turn}</span>
                  <span className="depth mono">{l.depth > 0 ? `d${l.depth}` : ''}</span>
                  <span className="pill" style={{ minWidth: 56, textAlign: 'center' }}>{KIND_LABELS[l.kind]}</span>
                  <span>{l.message}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {tab === 'changes' && (
          <table>
            <thead>
              <tr><th>步骤</th><th>单位</th><th>属性</th><th>旧值</th><th>新值</th><th>原因</th></tr>
            </thead>
            <tbody>
              {battle.engine.changes.map((c) => (
                <tr key={c.index}>
                  <td className="mono">{c.stepIndex}</td>
                  <td>{c.unitName}</td>
                  <td className="mono">{c.prop}</td>
                  <td className="mono change-old">{c.oldValue}</td>
                  <td className="mono change-new">{c.newValue}</td>
                  <td className="muted">{c.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
