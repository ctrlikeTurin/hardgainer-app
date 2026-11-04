import { useState } from 'react';
import { api, localDate } from '../api';

const ACTIVITY = [
  ['sedentary', '🪑', 'Sedentary', 'Desk job, little exercise'],
  ['light', '🚶', 'Light', 'Exercise 1-3 days a week'],
  ['moderate', '🏃', 'Moderate', 'Exercise 3-5 days a week'],
  ['active', '🔥', 'Active', 'Hard exercise 6-7 days a week'],
  ['very_active', '⚒️', 'Very active', 'Physical job plus training'],
];

const STEPS = ['About you', 'Your goal', 'Your lifestyle'];

export default function Onboarding({ onDone }) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    age: '', sex: 'male', height_cm: '', weight_kg: '', target_weight_kg: '', activity_level: 'moderate', environment: 'home',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const weight = Number(form.weight_kg);
  const target = Number(form.target_weight_kg);
  const bmi = weight && form.height_cm ? weight / (Number(form.height_cm) / 100) ** 2 : null;

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (step === 1 && target <= weight) return setError('Your target should be higher than your current weight.');
    if (step < STEPS.length - 1) return setStep(step + 1);
    setBusy(true);
    try {
      const body = {
        ...form,
        age: Number(form.age),
        height_cm: Number(form.height_cm),
        weight_kg: weight,
        target_weight_kg: target,
        date: localDate(),
      };
      onDone(await api('/me/onboarding', { method: 'POST', body }));
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const choice = (name, value, children) => (
    <label key={value} className={`option ${form[name] === value ? 'active' : ''}`}>
      <input type="radio" name={name} value={value} checked={form[name] === value} onChange={set(name)} />
      {children}
    </label>
  );

  return (
    <form className="card stack view" onSubmit={submit} style={{ maxWidth: 560, margin: '0 auto' }}>
      <div className="steps-bar" aria-hidden="true">
        {STEPS.map((s, i) => <div key={s} className={i <= step ? 'on' : ''} />)}
      </div>
      <div className="tiny muted">Step {step + 1} of {STEPS.length}</div>
      <h2>{["Let's build your plan 💪", 'Where do you want to be? 🎯', 'How do you live and train? 🏋️'][step]}</h2>

      {step === 0 && (
        <>
          <div className="row">
            <label>Age<input type="number" inputMode="numeric" min="14" max="90" value={form.age} onChange={set('age')} required autoFocus /></label>
            <label>Height (cm)<input type="number" inputMode="decimal" min="120" max="230" step="0.5" value={form.height_cm} onChange={set('height_cm')} required /></label>
          </div>
          <div>
            <div className="small" style={{ fontWeight: 500, marginBottom: 6 }}>Sex <span className="muted">(only used for the metabolism formula)</span></div>
            <div className="options two">
              {choice('sex', 'male', <><span className="emoji">♂️</span>Male</>)}
              {choice('sex', 'female', <><span className="emoji">♀️</span>Female</>)}
            </div>
          </div>
        </>
      )}

      {step === 1 && (
        <>
          <div className="row">
            <label>Current weight (kg)<input type="number" inputMode="decimal" min="30" max="250" step="0.1" value={form.weight_kg} onChange={set('weight_kg')} required autoFocus /></label>
            <label>Target weight (kg)<input type="number" inputMode="decimal" min="30" max="250" step="0.1" value={form.target_weight_kg} onChange={set('target_weight_kg')} required /></label>
          </div>
          {weight > 0 && (
            <div className="row">
              {[3, 5, 8, 10].map((kg) => (
                <button type="button" key={kg} className="pill" onClick={() => setForm({ ...form, target_weight_kg: String(Math.round((weight + kg) * 10) / 10) })}>
                  +{kg} kg
                </button>
              ))}
            </div>
          )}
          {bmi && <p className="small muted">Your BMI is {bmi.toFixed(1)}{bmi < 18.5 ? ". That's underweight, so gaining is a great goal." : '.'}</p>}
          {target > weight && (
            <p className="small">
              At a healthy 0.25-0.5 kg a week, gaining {(target - weight).toFixed(1)} kg takes about{' '}
              <strong>{Math.ceil((target - weight) / 0.5)}-{Math.ceil((target - weight) / 0.25)} weeks</strong>.
            </p>
          )}
        </>
      )}

      {step === 2 && (
        <>
          <div className="options">
            {ACTIVITY.map(([v, icon, label, desc]) =>
              choice('activity_level', v, <><span className="emoji" aria-hidden="true">{icon}</span><span><strong>{label}</strong><small>{desc}</small></span></>),
            )}
          </div>
          <div>
            <div className="small" style={{ fontWeight: 500, marginBottom: 6 }}>Where will you train?</div>
            <div className="options two">
              {choice('environment', 'home', <><span className="emoji">🏠</span><strong>Home</strong><small>Bodyweight, a backpack, a chair</small></>)}
              {choice('environment', 'gym', <><span className="emoji">🏋️</span><strong>Gym</strong><small>Barbells, dumbbells, machines</small></>)}
            </div>
          </div>
        </>
      )}

      {step === STEPS.length - 1 && (
        <p className="tiny muted">
          General guidance, not medical advice. Check with a doctor first if you have a health condition or injury.{' '}
          <a href="/privacy" target="_blank" rel="noopener" style={{ color: 'inherit' }}>Privacy & terms</a>
        </p>
      )}
      {error && <p className="error small">{error}</p>}
      <div className="row">
        {step > 0 && <button type="button" className="ghost" onClick={() => setStep(step - 1)} disabled={busy}>← Back</button>}
        <button style={{ flex: 1 }} disabled={busy}>
          {busy ? 'Calculating your plan…' : step < STEPS.length - 1 ? 'Continue →' : 'Create my plan 🚀'}
        </button>
      </div>
    </form>
  );
}
