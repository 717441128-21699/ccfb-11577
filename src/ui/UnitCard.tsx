import type { UnitSnapshot } from '../runtime/types';

export function UnitCard({ unit }: { unit: UnitSnapshot }) {
  const hpPct = Math.max(0, Math.min(100, (unit.hp / Math.max(1, unit.maxHp)) * 100));
  const mpPct = Math.max(0, Math.min(100, (unit.mp / Math.max(1, unit.maxMp)) * 100));
  return (
    <div className={`unit-card ${unit.alive ? '' : 'dead'}`}>
      <div className="unit-name">
        <span>{unit.name} <span className="muted mono" style={{ fontSize: 11 }}>#{unit.id}</span></span>
        <span className="pill">{unit.alive ? `队伍 ${unit.team}` : '阵亡'}</span>
      </div>
      <div className="bar"><span style={{ width: `${hpPct}%` }} /></div>
      <div className="muted mono" style={{ fontSize: 11.5 }}>HP {unit.hp}/{unit.maxHp}</div>
      <div className="bar mp"><span style={{ width: `${mpPct}%` }} /></div>
      <div className="muted mono" style={{ fontSize: 11.5 }}>MP {unit.mp}/{unit.maxMp}</div>
      <div className="stat-grid">
        <span>攻击 <b>{unit.atk}</b></span>
        <span>防御 <b>{unit.def}</b></span>
        <span>速度 <b>{unit.spd}</b></span>
        <span>闪避 <b>{unit.dodge}%</b></span>
        <span>暴击 <b>{unit.critRate}%</b></span>
        <span>暴伤 <b>{unit.critDmg}%</b></span>
      </div>
      {unit.buffs.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {unit.buffs.map((b, i) => (
            <span key={i} className="badge">
              {b.name}
              {b.stacks > 1 && <span className="stacks"> ×{b.stacks}</span>}
              <span className="muted"> {b.duration < 0 ? '永久' : `${b.duration}回合`}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
