import { formatDate } from '../api';

const DAY = 86400000;
const toMs = (iso) => new Date(`${iso}T00:00:00`).getTime();
const short = (ms) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const DECISION = { increase: ['⬆️', 'Calories up'], decrease: ['⬇️', 'Calories down'], hold: ['➡️', 'On track'] };
const FEEL = ['Very easy', 'Easy', 'About right', 'Hard', 'Very hard'];

// Actual weigh-ins against the planned line from start weight to target.
function WeightChart({ history, start, target, targetDate }) {
  const W = 340;
  const H = 180;
  const pad = { l: 34, r: 12, t: 12, b: 24 };
  const t0 = toMs(history[0].date);
  const t1 = Math.max(toMs(targetDate), t0 + 7 * DAY);
  const weights = [...history.map((h) => h.weight_kg), start, target];
  const lo = Math.floor(Math.min(...weights) - 1);
  const hi = Math.ceil(Math.max(...weights) + 1);
  const x = (ms) => pad.l + ((ms - t0) / (t1 - t0)) * (W - pad.l - pad.r);
  const y = (kg) => pad.t + (1 - (kg - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const line = history.map((h, i) => `${i ? 'L' : 'M'}${x(toMs(h.date)).toFixed(1)},${y(h.weight_kg).toFixed(1)}`).join(' ');
  const area = `${line} L${x(toMs(history.at(-1).date)).toFixed(1)},${H - pad.b} L${x(t0).toFixed(1)},${H - pad.b} Z`;
  const ticks = [lo, (lo + hi) / 2, hi];

  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Weight chart: ${history.at(-1).weight_kg} kg now, target ${target} kg`}>
      <defs>
        <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--line)" />
          <text x={pad.l - 6} y={y(t) + 4} textAnchor="end">{Math.round(t)}</text>
        </g>
      ))}
      <line x1={x(t0)} y1={y(start)} x2={x(t1)} y2={y(target)} stroke="var(--muted)" strokeDasharray="4 4" strokeWidth="1.5" />
      <circle cx={x(t1)} cy={y(target)} r="5" fill="var(--card)" stroke="var(--muted)" strokeWidth="2" />
      {history.length > 1 && <path d={area} fill="url(#areaGrad)" />}
      <path d={line} fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      {history.map((h) => (
        <circle key={h.date} cx={x(toMs(h.date))} cy={y(h.weight_kg)} r="4" fill="var(--accent)" stroke="var(--card)" strokeWidth="2">
          <title>{`${formatDate(h.date)}: ${h.weight_kg} kg`}</title>
        </circle>
      ))}
      <text x={x(t0)} y={H - 6}>{short(t0)}</text>
      <text x={x(t1)} y={H - 6} textAnchor="end">🎯 {short(t1)}</text>
    </svg>
  );
}

export default function ProgressView({ dash }) {
  const { profile, goal, weight_history: history = [], checkins = [], checkin } = dash;
  const { start_weight_kg: start, weight_kg: now, target_weight_kg: target } = profile;
  const gained = Math.round((now - start) * 10) / 10;
  const pct = Math.min(100, Math.max(0, ((now - start) / (target - start)) * 100));
  const weeksLeft = Math.max(0, Math.ceil((toMs(goal.target_date) - Date.now()) / (7 * DAY)));
  const chartHistory = history.length ? history : [{ date: dash.today.date, weight_kg: now }];

  const milestones = [
    { icon: '📅', label: 'This week', kg: goal.week_goal.weight_kg, date: goal.week_goal.date },
    { icon: '🗓️', label: 'This month', kg: goal.month_goal.weight_kg, date: goal.month_goal.date },
    { icon: '🎯', label: 'Target', kg: target, date: goal.target_date },
  ];

  return (
    <div className="view">
      <section className="card">
        <div className="spread">
          <h2 style={{ margin: 0 }}>Your progress</h2>
          <span className="chip accent">{pct.toFixed(0)}% there</span>
        </div>
        <div className="stats" style={{ margin: '0.9rem 0' }}>
          <div className="stat">
            <span className="tiny muted">Now</span>
            <strong>{now} kg</strong>
          </div>
          <div className="stat">
            <span className="tiny muted">Gained</span>
            <strong className={gained > 0 ? 'success' : ''}>{gained > 0 ? '+' : ''}{gained} kg</strong>
          </div>
          <div className="stat">
            <span className="tiny muted">Weeks to go</span>
            <strong>~{weeksLeft}</strong>
          </div>
        </div>
        <WeightChart history={chartHistory} start={start} target={target} targetDate={goal.target_date} />
        <p className="tiny muted" style={{ marginTop: 4 }}>
          <span style={{ color: 'var(--accent)' }}>●</span> Your weigh-ins &nbsp; <span>┅</span> Planned pace (~{goal.weekly_rate_kg} kg/week)
        </p>
      </section>

      <section className="card">
        <h2>Milestones</h2>
        <ol className="milestones">
          {milestones.map((m) => {
            const done = now >= m.kg;
            return (
              <li key={m.label} className={done ? 'done' : ''}>
                <span className="flag" aria-hidden="true">{done ? '✅' : m.icon}</span>
                <div style={{ flex: 1 }}>
                  <div className="small muted">{m.label}</div>
                  <strong className="num">{m.kg} kg</strong>
                </div>
                <span className="small muted">{formatDate(m.date)}</span>
              </li>
            );
          })}
        </ol>
        <p className="small muted" style={{ marginTop: '0.8rem' }}>Next check-in: <strong>{formatDate(checkin.next_date)}</strong></p>
      </section>

      <section className="card">
        <h2>Your daily plan</h2>
        <div className="stats">
          <div className="stat">
            <span className="tiny muted">Maintenance</span>
            <strong>{goal.tdee.toLocaleString()}</strong>
          </div>
          <div className="stat">
            <span className="tiny muted">Surplus</span>
            <strong className="success">+{goal.surplus}</strong>
          </div>
          <div className="stat">
            <span className="tiny muted">Eat daily</span>
            <strong>{goal.calories.toLocaleString()}</strong>
          </div>
        </div>
        <div className="row" style={{ marginTop: '0.7rem' }}>
          <span className="chip"><i style={{ color: 'var(--protein)' }}>●</i> Protein {goal.protein_g} g</span>
          <span className="chip"><i style={{ color: 'var(--carbs)' }}>●</i> Carbs {goal.carbs_g} g</span>
          <span className="chip"><i style={{ color: 'var(--fats)' }}>●</i> Fats {goal.fat_g} g</span>
        </div>
        {goal.reason !== 'Initial plan' && <p className="small muted" style={{ marginTop: '0.7rem' }}>Last adjustment: {goal.reason}</p>}
      </section>

      <section className="card">
        <h2>Check-in history</h2>
        {checkins.length === 0 ? (
          <p className="small muted">Your first weekly check-in opens on {formatDate(checkin.next_date)}. Weigh yourself that morning after the bathroom, before eating.</p>
        ) : (
          <ul className="history">
            {checkins.map((c) => {
              const [icon, label] = DECISION[c.decision] ?? DECISION.hold;
              return (
                <li key={c.checkin_date}>
                  <span>{formatDate(c.checkin_date)}</span>
                  <span className="num"><strong>{c.weight_kg} kg</strong></span>
                  <span className="muted" title={`Workouts felt: ${FEEL[c.difficulty - 1]}`}>{icon} {label}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
