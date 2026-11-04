import { useState } from 'react';
import { api, localDate } from '../api';
import { supabase } from '../supabase';
import { useToast } from '../ui.jsx';

const ACTIVITY = [
  ['sedentary', 'Sedentary: desk job, little exercise'],
  ['light', 'Light: exercise 1-3 days a week'],
  ['moderate', 'Moderate: exercise 3-5 days a week'],
  ['active', 'Active: hard exercise 6-7 days a week'],
  ['very_active', 'Very active: physical job plus training'],
];

export default function Settings({ profile, onSaved, onClose, onSignOut }) {
  const [form, setForm] = useState({
    target_weight_kg: String(profile.target_weight_kg),
    activity_level: profile.activity_level,
    environment: profile.environment,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState('');
  const toast = useToast();
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const dash = await api('/me/profile', { method: 'PATCH', body: { ...form, target_weight_kg: Number(form.target_weight_kg), date: localDate() } });
      onSaved(dash);
      toast('Plan updated');
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteAccount() {
    setBusy(true);
    setError('');
    try {
      const res = await api('/me', { method: 'DELETE' });
      toast(res.login_deleted ? 'Your account and data were deleted' : 'Your data was deleted');
      onSignOut();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="spread">
        <h2 style={{ margin: 0 }}>⚙️ Settings</h2>
        <button className="icon" onClick={onClose} aria-label="Close">✕</button>
      </div>
      {profile.email && <p className="small muted">Signed in as <strong>{profile.email}</strong></p>}

      <form className="stack" onSubmit={save}>
        <label>
          Target weight (kg)
          <input type="number" inputMode="decimal" step="0.1" min="30" max="250" value={form.target_weight_kg} onChange={set('target_weight_kg')} required />
        </label>
        <label>
          Activity level
          <select value={form.activity_level} onChange={set('activity_level')}>
            {ACTIVITY.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <div>
          <div className="small" style={{ fontWeight: 500, marginBottom: 6 }}>Where you train</div>
          <div className="options two">
            {[['home', '🏠', 'Home'], ['gym', '🏋️', 'Gym']].map(([v, icon, label]) => (
              <label key={v} className={`option ${form.environment === v ? 'active' : ''}`}>
                <input type="radio" name="env" value={v} checked={form.environment === v} onChange={set('environment')} />
                <span className="emoji">{icon}</span>{label}
              </label>
            ))}
          </div>
          {form.environment !== profile.environment && <p className="tiny muted" style={{ marginTop: 6 }}>This week's workouts will switch to the {form.environment} starter plan.</p>}
        </div>
        {error && <p className="error small">{error}</p>}
        <button disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
      </form>

      <hr style={{ border: 0, borderTop: '1px solid var(--line)', width: '100%' }} />
      <button className="ghost" onClick={onSignOut}>Sign out</button>
      <a className="small muted" href="/privacy" target="_blank" rel="noopener">Privacy & terms</a>

      <details>
        <summary className="small error" style={{ cursor: 'pointer' }}>Delete my account</summary>
        <div className="stack" style={{ marginTop: '0.6rem' }}>
          <p className="small">This permanently deletes your profile, meals, workouts and check-ins. It can't be undone.</p>
          <label>
            Type DELETE to confirm
            <input value={confirmDelete} onChange={(e) => setConfirmDelete(e.target.value)} autoComplete="off" />
          </label>
          <button style={{ background: 'var(--error)', color: '#fff' }} disabled={busy || confirmDelete !== 'DELETE'} onClick={deleteAccount}>
            Delete everything
          </button>
        </div>
      </details>
    </div>
  );
}
