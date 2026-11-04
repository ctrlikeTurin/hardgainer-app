import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { compressImage } from '../compressImage';
import { useLocal, useToast, vibrate } from '../ui.jsx';

const MACROS = [
  ['protein', 'Protein', 'var(--protein)'],
  ['carbs', 'Carbs', 'var(--carbs)'],
  ['fats', 'Fats', 'var(--fats)'],
];

// Calorie-dense, cheap foods: the hardest part of a bulk is eating enough.
const TIPS = [
  ['🥜', 'Peanut butter on toast', '2 tbsp adds ~190 kcal and barely fills you up.'],
  ['🥛', 'Drink some calories', 'A glass of whole milk is ~150 kcal. Liquids are easier than food when you\'re full.'],
  ['🍚', 'Bigger rice portions', 'An extra cup of cooked rice is ~200 kcal of easy carbs.'],
  ['🥑', 'Add healthy fats', 'Olive oil on meals adds ~120 kcal per tablespoon with no extra volume.'],
  ['🍌', 'Banana smoothie', 'Milk, banana, oats and peanut butter blend into 600+ kcal in two minutes.'],
  ['🥚', 'Eggs any time', 'Three eggs give ~210 kcal and 18 g protein for very little money.'],
  ['⏰', "Don't skip meals", 'Set reminders. Hardgainers usually fall short by forgetting, not by choice.'],
];

function Ring({ eaten, target }) {
  const r = 62;
  const c = 2 * Math.PI * r;
  const pct = target > 0 ? Math.min(1, eaten / target) : 0;
  const left = Math.round(target - eaten);
  return (
    <div className="ring" role="img" aria-label={`${Math.round(eaten)} of ${target} kcal eaten`}>
      <svg viewBox="0 0 148 148">
        <defs>
          <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--accent)" />
            <stop offset="100%" stopColor="var(--accent-2)" />
          </linearGradient>
        </defs>
        <circle className="track" cx="74" cy="74" r={r} />
        <circle className="fill" cx="74" cy="74" r={r} strokeDasharray={c} strokeDashoffset={c * (1 - pct)} />
      </svg>
      <div className="label">
        <strong>{Math.abs(left).toLocaleString()}</strong>
        <span className="tiny muted">{left >= 0 ? 'kcal to go' : 'kcal over 💪'}</span>
      </div>
    </div>
  );
}

function MacroDots({ log }) {
  return (
    <div className="dots">
      {MACROS.map(([k, label, color]) => (
        <span key={k} title={label}>
          <i style={{ background: color }} />
          {Math.round(log[k])}g
        </span>
      ))}
    </div>
  );
}

function PhotoLogger({ date, onLogged, busy, setBusy }) {
  const [hint, setHint] = useState('');
  const [preview, setPreview] = useState(null);
  const [over, setOver] = useState(false);
  const inputRef = useRef(null);
  const toast = useToast();

  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview]);

  async function send(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) return toast('That file isn\'t an image', 'error');
    setPreview(URL.createObjectURL(file));
    setBusy(hint ? `📸 ${hint}` : '📸 Your meal photo');
    try {
      const image = await compressImage(file);
      const form = new FormData();
      form.append('image', image, image === file ? file.name : 'meal.jpg');
      form.append('log_date', date);
      form.append('hint', hint);
      onLogged(await api('/food/scan', { method: 'POST', form }));
      setHint('');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
      setPreview(null);
    }
  }

  return (
    <div className="stack">
      {preview ? (
        <div className="scan">
          <div className="scanning" style={{ borderRadius: 12 }}>
            <img src={preview} alt="Your meal" />
          </div>
          <div>
            <strong>Reading your plate…</strong>
            <p className="small muted">Identifying foods and estimating portions. Usually takes a few seconds.</p>
          </div>
        </div>
      ) : (
        <div
          className={`dropzone ${over ? 'over' : ''}`}
          role="button"
          tabIndex={0}
          onClick={() => !busy && inputRef.current.click()}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            send(e.dataTransfer.files?.[0]);
          }}
        >
          <div className="emoji" aria-hidden="true">📸</div>
          <strong>Snap or upload your meal</strong>
          <div className="small muted">AI estimates the calories and macros</div>
        </div>
      )}
      <input
        type="text"
        placeholder="Optional hint, e.g. 2 eggs, 1 cup rice"
        maxLength={200}
        value={hint}
        onChange={(e) => setHint(e.target.value)}
        disabled={busy}
      />
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          send(f);
        }}
      />
    </div>
  );
}

function DescribeLogger({ date, onLogged, busy, setBusy }) {
  const [text, setText] = useState('');
  const toast = useToast();
  async function submit(e) {
    e.preventDefault();
    setBusy(`✍️ ${text}`);
    try {
      onLogged(await api('/food/describe', { method: 'POST', body: { text, log_date: date } }));
      setText('');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="stack" onSubmit={submit}>
      <textarea
        placeholder={'What did you eat? e.g. "2 chapatis, a bowl of beans and a glass of milk"'}
        maxLength={300}
        value={text}
        onChange={(e) => setText(e.target.value)}
        required
        minLength={3}
      />
      <button disabled={busy || text.trim().length < 3}>{busy ? 'Estimating…' : '✨ Estimate with AI'}</button>
    </form>
  );
}

function QuickAdd({ date, onLogged, busy, setBusy }) {
  const empty = { description: '', calories: '', protein: '', carbs: '', fats: '' };
  const [form, setForm] = useState(empty);
  const toast = useToast();
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  async function submit(e) {
    e.preventDefault();
    setBusy(`⚡ ${form.description}`);
    try {
      const body = { log_date: date, description: form.description };
      for (const k of ['calories', 'protein', 'carbs', 'fats']) body[k] = Number(form[k] || 0);
      onLogged(await api('/food/quick', { method: 'POST', body }));
      setForm(empty);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="stack" onSubmit={submit}>
      <div className="row">
        <label style={{ flex: 2 }}>Food<input value={form.description} onChange={set('description')} placeholder="Protein shake" maxLength={200} required /></label>
        <label>kcal<input type="number" inputMode="numeric" min="1" max="3000" value={form.calories} onChange={set('calories')} required /></label>
      </div>
      <div className="row">
        {MACROS.map(([k, label]) => (
          <label key={k}>
            {label} (g)
            <input type="number" inputMode="decimal" min="0" max="500" step="0.1" value={form[k]} onChange={set(k)} />
          </label>
        ))}
      </div>
      <button disabled={busy}>{busy ? 'Saving…' : 'Add'}</button>
    </form>
  );
}

function LogItem({ log, onChange }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function run(path, opts, message) {
    setBusy(true);
    try {
      const res = await api(path, opts);
      onChange(res.today);
      if (message) toast(message);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="log" style={busy ? { opacity: 0.55 } : undefined}>
      <div className="body">
        <button className="link" style={{ padding: 0, textAlign: 'left', width: '100%', color: 'var(--text)' }} onClick={() => setOpen(!open)} aria-expanded={open}>
          <strong>{log.description || 'Meal'}</strong>
        </button>
        <MacroDots log={log} />
        {open && (
          <div className="small muted" style={{ marginTop: 6 }}>
            <ul style={{ margin: '0 0 6px', paddingLeft: '1.1rem' }}>
              {log.items.map((i, idx) => (
                <li key={idx}>{i.name} ({i.portion}): {Math.round(i.calories)} kcal</li>
              ))}
            </ul>
            <span>Portion: </span>
            {[0.5, 1.5, 2].map((f) => (
              <button key={f} className="link" disabled={busy} onClick={() => run(`/food/logs/${log.id}`, { method: 'PATCH', body: { factor: f } }, 'Portion updated')}>
                {f === 0.5 ? '½×' : `${f}×`}
              </button>
            ))}
          </div>
        )}
      </div>
      <span className="kcal">{Math.round(log.calories)}</span>
      <button className="link" disabled={busy} onClick={() => run(`/food/logs/${log.id}`, { method: 'DELETE' }, 'Meal removed')} aria-label={`Delete ${log.description}`}>
        ✕
      </button>
    </li>
  );
}

export default function TodayView({ dash, onTodayChange }) {
  const { today, recent_meals: recent = [] } = dash;
  const [mode, setMode] = useLocal('logMode', 'photo');
  // Label of the meal being analyzed; shown in the list right away so the wait feels shorter.
  const [pending, setPending] = useState(null);
  const busy = Boolean(pending);
  const setBusy = (label) => setPending(label ? (typeof label === 'string' ? label : 'Saving…') : null);
  const [last, setLast] = useState(null);
  const toast = useToast();
  const [tipIndex] = useState(() => new Date().getDate() % TIPS.length);

  function onLogged(res) {
    onTodayChange(res.today);
    setLast(res.log);
    vibrate();
    toast(`Logged ${Math.round(res.log.calories)} kcal`);
  }

  async function repeat(meal) {
    setBusy(`↻ ${meal.description}`);
    try {
      onLogged(await api(`/food/logs/${meal.id}/repeat`, { method: 'POST', body: { log_date: today.date } }));
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const eaten = today.consumed.calories;
  const target = today.targets.calories;
  const pctDay = (new Date().getHours() - 7) / 15; // rough share of the eating day (7am-10pm) that has passed
  const behind = eaten < target * Math.min(1, pctDay) - 300;
  const [emoji, tipTitle, tipBody] = TIPS[tipIndex];
  const LoggerFor = { photo: PhotoLogger, describe: DescribeLogger, quick: QuickAdd }[mode] ?? PhotoLogger;

  return (
    <div className="view">
      <section className="card">
        <div className="spread" style={{ marginBottom: '0.8rem' }}>
          <h2 style={{ margin: 0 }}>Today's fuel</h2>
          <span className="small muted num">{Math.round(eaten).toLocaleString()} / {target.toLocaleString()} kcal</span>
        </div>
        <div className="fuel">
          <Ring eaten={eaten} target={target} />
          <div className="macros">
            {MACROS.map(([k, label, color]) => {
              const pct = Math.min(100, (today.consumed[k] / today.targets[k]) * 100);
              return (
                <div key={k} className="macro">
                  <div className="spread">
                    <span><strong>{label}</strong></span>
                    <span className="muted num">{Math.round(today.consumed[k])} / {today.targets[k]} g</span>
                  </div>
                  <div className="bar"><div style={{ width: `${pct}%`, background: color }} /></div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="card stack">
        <h2 style={{ margin: 0 }}>Log a meal</h2>
        <div className="seg" role="tablist">
          {[
            ['photo', '📷 Photo'],
            ['describe', '✍️ Describe'],
            ['quick', '⚡ Manual'],
          ].map(([k, label]) => (
            <button key={k} role="tab" aria-selected={mode === k} className={mode === k ? 'active' : ''} onClick={() => setMode(k)}>
              {label}
            </button>
          ))}
        </div>
        <LoggerFor date={today.date} onLogged={onLogged} busy={busy} setBusy={setBusy} />

        {last && (
          <div className="scan">
            <div style={{ flex: 1 }}>
              <div className="spread">
                <strong>{last.description}</strong>
                <button className="link" onClick={() => setLast(null)} aria-label="Dismiss">✕</button>
              </div>
              <p className="small"><strong className="num">{Math.round(last.calories)} kcal</strong></p>
              <MacroDots log={last} />
              {last.confidence === 'low' && <p className="small warn">Low confidence. Add a hint and try again for a better estimate.</p>}
            </div>
          </div>
        )}

        {recent.length > 0 && (
          <div>
            <div className="small muted" style={{ marginBottom: 6 }}>Eat it again (one tap)</div>
            <div className="pills">
              {recent.map((m) => (
                <button key={m.id} className="pill" disabled={busy} onClick={() => repeat(m)} title={`${Math.round(m.calories)} kcal`}>
                  ↻ {m.description.length > 28 ? `${m.description.slice(0, 28)}…` : m.description} · {Math.round(m.calories)}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="card">
        <div className="spread" style={{ marginBottom: '0.6rem' }}>
          <h2 style={{ margin: 0 }}>Meals today</h2>
          <span className="chip">{today.logs.length}</span>
        </div>
        {pending && (
          <ul className="logs" style={{ marginBottom: today.logs.length ? '0.5rem' : 0 }}>
            <li className="log pending" aria-busy="true">
              <div className="body">
                <strong>{pending}</strong>
                <span className="tiny muted">Estimating calories and macros…</span>
              </div>
              <span className="spinner" aria-hidden="true" />
            </li>
          </ul>
        )}
        {today.logs.length === 0 ? (
          !pending && 
          <p className="muted small">Nothing logged yet. Breakfast counts! Log it above.</p>
        ) : (
          <ul className="logs">
            {[...today.logs].reverse().map((l) => (
              <LogItem key={l.id} log={l} onChange={onTodayChange} />
            ))}
          </ul>
        )}
      </section>

      <section className={`card tip ${behind ? 'tint' : ''}`}>
        <span className="emoji" aria-hidden="true">{emoji}</span>
        <div>
          {behind && <div className="small warn"><strong>You're behind today. Here's an easy fix:</strong></div>}
          <strong>{tipTitle}</strong>
          <p className="small muted">{tipBody}</p>
        </div>
      </section>
    </div>
  );
}
