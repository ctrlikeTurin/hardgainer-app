import { useEffect, useRef, useState } from 'react';
import LIBRARY from '../../shared/exercise-library.json';
import { Confetti, Sheet, useLocal, useToast, vibrate } from '../ui.jsx';

const BY_ID = new Map(LIBRARY.map((e) => [e.id, e]));
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const FOCUS_EMOJI = { push: '🫸', pull: '🪝', legs: '🦵', upper: '💪', lower: '🦵', full: '⚡' };

function sourceLabel(source) {
  if (source === 'template') return 'Starter plan';
  if (source === 'rules') return 'Auto-progressed';
  return '✨ AI-coached';
}

const focusEmoji = (focus) => FOCUS_EMOJI[Object.keys(FOCUS_EMOJI).find((k) => focus.toLowerCase().includes(k))] ?? '🏋️';

function Media({ lib, large, onClick }) {
  if (!lib?.images?.length) return null;
  return (
    <div className={`ex-media ${large ? 'large' : ''}`} onClick={onClick} role={onClick ? 'button' : undefined} aria-label={onClick ? `Show how to do ${lib.name}` : undefined}>
      {lib.images.map((src, i) => (
        <img key={src} src={src} alt={i === 0 ? `${lib.name}: start position` : `${lib.name}: end position`} loading="lazy" />
      ))}
    </div>
  );
}

function HowTo({ lib, ex }) {
  return (
    <div className="inner">
      {lib.cue && <div className="cue">💡 <strong>Key cue:</strong> {lib.cue}</div>}
      <ol>
        {lib.steps.map((s, i) => <li key={i}>{s}</li>)}
      </ol>
      <div className="ex-meta">
        {lib.primary.map((m) => <span key={m} className="chip accent">{m}</span>)}
        {lib.secondary.map((m) => <span key={m} className="chip">{m}</span>)}
      </div>
      {ex?.load_guidance && <p className="small muted">📈 {ex.load_guidance}</p>}
    </div>
  );
}

function ExerciseCard({ ex, done, onToggleSet, onShow }) {
  const lib = BY_ID.get(ex.id);
  const complete = done.filter(Boolean).length === ex.sets;
  return (
    <article className={`card ex-card ${complete ? 'complete' : ''}`}>
      <div className="ex-top">
        <Media lib={lib} onClick={lib ? onShow : undefined} />
        <div className="ex-info">
          <h3>{complete && '✅ '}{ex.name}</h3>
          <div className="ex-meta">
            <span className="chip accent num">{ex.sets} × {ex.reps}</span>
            <span className="chip num">⏱ {ex.rest_seconds}s rest</span>
          </div>
          {ex.notes && <p className="small muted" style={{ marginTop: 6 }}>{ex.notes}</p>}
        </div>
      </div>
      <div className="sets" aria-label="Sets">
        {Array.from({ length: ex.sets }, (_, i) => (
          <button key={i} className={`set ${done[i] ? 'done' : ''}`} onClick={() => onToggleSet(i)} aria-pressed={!!done[i]} aria-label={`Set ${i + 1}`}>
            {done[i] ? '✓' : i + 1}
          </button>
        ))}
      </div>
      {lib && (
        <details className="howto">
          <summary>How to do it</summary>
          <HowTo lib={lib} ex={ex} />
        </details>
      )}
    </article>
  );
}

function RestTimer({ seconds, onDone }) {
  const [end, setEnd] = useState(() => Date.now() + seconds * 1000);
  const [now, setNow] = useState(Date.now());
  const left = Math.max(0, Math.ceil((end - now) / 1000));
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (left > 0) return;
    vibrate([200, 100, 200]);
    const t = setTimeout(() => doneRef.current(), 1500);
    return () => clearTimeout(t);
  }, [left]);

  return (
    <div className="timer" role="timer" aria-live="off">
      <span className="small">{left === 0 ? 'Go! 💥' : 'Rest'}</span>
      <strong>{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</strong>
      <button onClick={() => setEnd((e) => e + 30000)}>+30s</button>
      <button onClick={onDone} aria-label="Skip rest">Skip</button>
    </div>
  );
}

export default function TrainView({ workout }) {
  const { plan, week_number: week, source } = workout;
  const todayName = WEEKDAYS[new Date().getDay()];
  const todayIdx = plan.days.findIndex((d) => d.day === todayName);
  const [dayIdx, setDayIdx] = useState(todayIdx >= 0 ? todayIdx : 0);
  const [progress, setProgress] = useLocal(`sets:w${week}`, {});
  const [rest, setRest] = useState(null);
  const [showing, setShowing] = useState(null);
  const [celebrate, setCelebrate] = useState(false);
  const toast = useToast();

  const day = plan.days[dayIdx] ?? plan.days[0];
  const doneFor = (d, i) => progress[`${d}:${i}`] ?? [];
  const totalSets = day.exercises.reduce((s, e) => s + e.sets, 0);
  const doneSets = day.exercises.reduce((s, e, i) => s + doneFor(dayIdx, i).filter(Boolean).length, 0);
  const dayComplete = (d) => plan.days[d].exercises.every((e, i) => doneFor(d, i).filter(Boolean).length === e.sets);

  function toggle(exIdx, setIdx) {
    const key = `${dayIdx}:${exIdx}`;
    const sets = [...doneFor(dayIdx, exIdx)];
    sets[setIdx] = !sets[setIdx];
    const next = { ...progress, [key]: sets };
    setProgress(next);
    if (!sets[setIdx]) return;
    vibrate();
    const ex = day.exercises[exIdx];
    const finishedDay = day.exercises.every((e, i) => ((i === exIdx ? sets : next[`${dayIdx}:${i}`]) ?? []).filter(Boolean).length === e.sets);
    if (finishedDay) {
      setRest(null);
      setCelebrate(true);
      setTimeout(() => setCelebrate(false), 2500);
      toast(`${day.focus} day done! Now eat to grow. 🍽️`);
    } else {
      setRest({ seconds: ex.rest_seconds, key: Date.now() });
    }
  }

  const showLib = showing && BY_ID.get(showing.id);

  return (
    <div className="view">
      <section className="card tint">
        <div className="spread">
          <div>
            <h2 style={{ margin: 0 }}>Week {week} training</h2>
            <span className="small muted">{plan.days.length} sessions · {workout.environment === 'gym' ? 'Gym' : 'Home'}</span>
          </div>
          <span className="chip accent">{sourceLabel(source)}</span>
        </div>
        {plan.coach_notes && <p className="small" style={{ marginTop: '0.7rem' }}>🧠 {plan.coach_notes}</p>}
      </section>

      <div className="pills" role="tablist" aria-label="Training days">
        {plan.days.map((d, i) => (
          <button key={d.day + i} role="tab" aria-selected={i === dayIdx} className={`pill ${i === dayIdx ? 'active' : ''}`} onClick={() => setDayIdx(i)}>
            {dayComplete(i) ? '✅' : focusEmoji(d.focus)} {d.day}{i === todayIdx ? ' · today' : ''}
          </button>
        ))}
      </div>

      <section className="card">
        <div className="spread">
          <h3 style={{ margin: 0 }}>{focusEmoji(day.focus)} {day.focus}</h3>
          <span className="small muted num">{doneSets}/{totalSets} sets</span>
        </div>
        <div className="bar day-progress"><div style={{ width: `${totalSets ? (doneSets / totalSets) * 100 : 0}%` }} /></div>
        <p className="tiny muted" style={{ marginTop: 6 }}>Tap a number after each set. A rest timer starts automatically.</p>
      </section>

      {day.exercises.map((ex, i) => (
        <ExerciseCard key={`${dayIdx}-${ex.id ?? ex.name}-${i}`} ex={ex} done={doneFor(dayIdx, i)} onToggleSet={(s) => toggle(i, s)} onShow={() => setShowing(ex)} />
      ))}

      {doneSets > 0 && (
        <button className="link" onClick={() => setProgress(Object.fromEntries(Object.entries(progress).filter(([k]) => !k.startsWith(`${dayIdx}:`))))}>
          Reset this day's sets
        </button>
      )}

      {rest && <RestTimer key={rest.key} seconds={rest.seconds} onDone={() => setRest(null)} />}
      {celebrate && <Confetti />}

      {showLib && (
        <Sheet onClose={() => setShowing(null)} label={showLib.name}>
          <div className="spread">
            <h2 style={{ margin: 0 }}>{showLib.name}</h2>
            <button className="icon" onClick={() => setShowing(null)} aria-label="Close">✕</button>
          </div>
          <p className="small muted" style={{ marginBottom: '0.8rem' }}>{showing.sets} sets × {showing.reps} · {showing.rest_seconds}s rest · {showLib.level}</p>
          <Media lib={showLib} large />
          <HowTo lib={showLib} ex={showing} />
        </Sheet>
      )}
    </div>
  );
}
