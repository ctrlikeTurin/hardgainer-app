import { useState } from 'react';
import { api, localDate } from '../api';

const FEEL = [
  ['😴', 'Very easy'],
  ['🙂', 'Easy'],
  ['💪', 'About right'],
  ['😮‍💨', 'Hard'],
  ['🥵', 'Very hard'],
];

export default function CheckIn({ currentWeight, onDone }) {
  const [weight, setWeight] = useState(String(currentWeight));
  const [difficulty, setDifficulty] = useState(3);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const change = Math.round((Number(weight) - currentWeight) * 10) / 10;
  const nudge = (d) => setWeight(String(Math.round((Number(weight || currentWeight) + d) * 10) / 10));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      onDone(await api('/checkins', { method: 'POST', body: { weight_kg: Number(weight), difficulty, notes, date: localDate() } }));
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit}>
      <h2 style={{ margin: 0 }}>⚖️ Weekly check-in</h2>
      <p className="small muted">Weigh yourself this morning, after the bathroom and before eating.</p>

      <div className="row" style={{ alignItems: 'center', flexWrap: 'nowrap' }}>
        <button type="button" className="icon" onClick={() => nudge(-0.1)} aria-label="Decrease 0.1 kg">−</button>
        <label style={{ textAlign: 'center' }}>
          <span className="sr-only" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Weight in kg</span>
          <input
            type="number" inputMode="decimal" step="0.1" min="30" max="250" value={weight} onChange={(e) => setWeight(e.target.value)} required
            style={{ textAlign: 'center', fontSize: '1.8rem', fontFamily: 'var(--display)', fontWeight: 700 }}
          />
        </label>
        <button type="button" className="icon" onClick={() => nudge(0.1)} aria-label="Increase 0.1 kg">+</button>
      </div>
      <p className="small" style={{ textAlign: 'center' }}>
        {change === 0 ? <span className="muted">Same as last time ({currentWeight} kg)</span> : (
          <span className={change > 0 ? 'success' : 'warn'}>
            {change > 0 ? '▲' : '▼'} {Math.abs(change)} kg since last check-in
          </span>
        )}
      </p>

      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="small" style={{ fontWeight: 500, marginBottom: 6 }}>How did this week's workouts feel?</legend>
        <div className="row" style={{ gap: '0.4rem' }}>
          {FEEL.map(([icon, label], i) => (
            <label key={label} className={`option ${difficulty === i + 1 ? 'active' : ''}`} style={{ flexDirection: 'column', gap: 2, padding: '0.55rem 0.3rem', textAlign: 'center', fontSize: '0.75rem' }}>
              <input type="radio" name="difficulty" checked={difficulty === i + 1} onChange={() => setDifficulty(i + 1)} />
              <span style={{ fontSize: '1.4rem' }} aria-hidden="true">{icon}</span>
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <textarea placeholder="Anything else? Missed sessions, sore joints, poor sleep…" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
      {error && <p className="error small">{error}</p>}
      <button className="big" disabled={busy}>{busy ? '🧠 Building next week…' : 'Submit check-in'}</button>
    </form>
  );
}
