import { useState } from 'react';
import { supabase } from '../supabase';

const PERKS = [
  ['📸', 'Snap a meal and AI counts the calories'],
  ['🎯', 'A calorie surplus built for your body'],
  ['🏋️', 'Workouts with demos that adapt every week'],
];

function PasswordInput({ value, onChange, autoComplete, placeholder = 'At least 8 characters' }) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <input
        type={show ? 'text' : 'password'}
        placeholder={placeholder}
        minLength={8}
        value={value}
        onChange={onChange}
        required
        autoComplete={autoComplete}
        style={{ paddingRight: '4rem' }}
      />
      <button type="button" className="link small" style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)' }} onClick={() => setShow(!show)}>
        {show ? 'Hide' : 'Show'}
      </button>
    </div>
  );
}

// recovery: the user arrived from a password-reset email and must choose a new password.
export default function Auth({ recovery = false, onRecovered }) {
  const [mode, setMode] = useState(recovery ? 'reset' : 'signin'); // signin | signup | forgot | reset
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [unconfirmed, setUnconfirmed] = useState(false);

  const switchMode = (m) => {
    setMode(m);
    setMessage(null);
    setUnconfirmed(false);
  };

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    setUnconfirmed(false);
    const redirect = { emailRedirectTo: window.location.origin };
    let result;
    if (mode === 'signup') result = await supabase.auth.signUp({ email, password, options: redirect });
    else if (mode === 'signin') result = await supabase.auth.signInWithPassword({ email, password });
    else if (mode === 'forgot') result = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
    else result = await supabase.auth.updateUser({ password });
    setBusy(false);

    const { error } = result;
    if (error) {
      if (/email not confirmed/i.test(error.message)) {
        setUnconfirmed(true);
        setMessage({ type: 'error', text: 'Please verify your email first. Check your inbox and spam folder.' });
      } else if (/rate limit/i.test(error.message)) {
        setMessage({ type: 'error', text: 'Too many emails sent. Wait a few minutes and try again.' });
      } else {
        setMessage({ type: 'error', text: error.message });
      }
      return;
    }
    if (mode === 'signup') {
      // Supabase returns a user with no identities when the email is already registered.
      if (result.data?.user && result.data.user.identities?.length === 0) {
        setMessage({ type: 'error', text: 'That email already has an account. Sign in, or reset your password.' });
      } else {
        setMessage({ type: 'success', text: '📬 Check your inbox (and spam folder) and click the verification link, then sign in.' });
      }
    } else if (mode === 'forgot') {
      setMessage({ type: 'success', text: '📬 If that email has an account, a reset link is on its way.' });
    } else if (mode === 'reset') {
      onRecovered?.();
    }
  }

  async function resend() {
    setBusy(true);
    const { error } = await supabase.auth.resend({ type: 'signup', email, options: { emailRedirectTo: window.location.origin } });
    setBusy(false);
    setMessage(error ? { type: 'error', text: error.message } : { type: 'success', text: '📬 Verification email sent again.' });
  }

  const title = { signin: 'Hardgainer', signup: 'Hardgainer', forgot: 'Reset your password', reset: 'Choose a new password' }[mode];
  const cta = { signin: 'Sign in', signup: 'Create my account', forgot: 'Send reset link', reset: 'Save new password' }[mode];

  return (
    <div className="hero">
      <div className="card">
        <div className="logo" style={{ width: 48, height: 48, fontSize: '1.5rem', borderRadius: 14, marginBottom: '1rem' }} aria-hidden="true">💪</div>
        <h1>{title}</h1>
        {(mode === 'signin' || mode === 'signup') && (
          <>
            <p className="muted">Eat enough. Lift smart. Actually gain.</p>
            <ul className="perks">
              {PERKS.map(([icon, text]) => (
                <li key={text}><span aria-hidden="true">{icon}</span>{text}</li>
              ))}
            </ul>
            <div className="seg" style={{ marginBottom: '0.9rem' }}>
              <button type="button" className={mode === 'signin' ? 'active' : ''} onClick={() => switchMode('signin')}>Sign in</button>
              <button type="button" className={mode === 'signup' ? 'active' : ''} onClick={() => switchMode('signup')}>Create account</button>
            </div>
          </>
        )}
        {mode === 'forgot' && <p className="muted small">Enter your email and we'll send you a link to set a new password.</p>}

        <form onSubmit={submit} className="stack">
          {mode !== 'reset' && (
            <label>
              Email
              <input type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
            </label>
          )}
          {mode !== 'forgot' && (
            <label>
              {mode === 'reset' ? 'New password' : 'Password'}
              <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} />
            </label>
          )}
          <button className="big" disabled={busy}>{busy ? 'Please wait…' : cta}</button>
        </form>

        {message && <p className={`small ${message.type}`} style={{ marginTop: '0.8rem' }}>{message.text}</p>}
        {unconfirmed && <button className="link small" onClick={resend} disabled={busy}>Resend verification email</button>}

        <div className="spread" style={{ marginTop: '0.8rem', flexWrap: 'wrap' }}>
          {mode === 'signin' && <button className="link small" onClick={() => switchMode('forgot')}>Forgot password?</button>}
          {mode === 'forgot' && <button className="link small" onClick={() => switchMode('signin')}>← Back to sign in</button>}
          {mode !== 'reset' && <a className="tiny muted" href="/privacy" target="_blank" rel="noopener">Privacy & terms</a>}
        </div>
        {mode === 'signup' && (
          <p className="tiny muted" style={{ marginTop: '0.6rem' }}>
            By creating an account you agree to the <a href="/privacy" target="_blank" rel="noopener" style={{ color: 'inherit' }}>privacy policy and terms</a>.
            Hardgainer gives general fitness guidance, not medical advice.
          </p>
        )}
      </div>
    </div>
  );
}
