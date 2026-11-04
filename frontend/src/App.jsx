import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { api, localDate } from './api';
import { supabase } from './supabase';
import { Confetti, Sheet, useLocal, useTheme } from './ui.jsx';
import Auth from './components/Auth.jsx';
import TodayView from './components/TodayView.jsx';

// After a deploy, old chunk files are gone; a tab still running the old page gets a failed import.
// Reload once to pick up the new version instead of showing a broken screen.
function retryImport(load) {
  return () =>
    load().then(
      (mod) => {
        sessionStorage.removeItem('chunk-reload');
        return mod;
      },
      (err) => {
        // The flag stops a reload loop if the file is missing for some other reason.
        if (!sessionStorage.getItem('chunk-reload')) {
          sessionStorage.setItem('chunk-reload', '1');
          window.location.reload();
          return new Promise(() => {});
        }
        throw err;
      },
    );
}

// Screens that aren't the first thing you see load on demand to keep the main bundle small.
const loadTrain = retryImport(() => import('./components/TrainView.jsx'));
const loadProgress = retryImport(() => import('./components/ProgressView.jsx'));
const loadCheckIn = retryImport(() => import('./components/CheckIn.jsx'));
const Onboarding = lazy(retryImport(() => import('./components/Onboarding.jsx')));
const Settings = lazy(retryImport(() => import('./components/Settings.jsx')));
const CheckIn = lazy(loadCheckIn);
const TrainView = lazy(loadTrain);
const ProgressView = lazy(loadProgress);

// The last dashboard is kept on the device so the app can show it instantly while fresh data loads.
const cacheKey = (userId) => `dash:${userId}`;
function readCache(userId) {
  try {
    return JSON.parse(localStorage.getItem(cacheKey(userId)));
  } catch {
    return null;
  }
}
function writeCache(userId, dash) {
  try {
    if (dash) localStorage.setItem(cacheKey(userId), JSON.stringify(dash));
    else localStorage.removeItem(cacheKey(userId));
  } catch {
    /* private mode or storage full */
  }
}

const TABS = [
  ['today', '🍽️', 'Today'],
  ['train', '🏋️', 'Train'],
  ['progress', '📈', 'Progress'],
];

function Loading() {
  return (
    <div className="view" aria-busy="true">
      <div className="skeleton" style={{ height: 200 }} />
      <div className="skeleton" style={{ height: 140 }} />
      <div className="skeleton" style={{ height: 260 }} />
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState(undefined);
  const [dash, setDash] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useLocal('tab', 'today');
  const [checkinOpen, setCheckinOpen] = useState(false);
  const [checkinResult, setCheckinResult] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [recovery, setRecovery] = useState(false);
  const [dark, toggleTheme] = useTheme();
  const userId = session?.user?.id;

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      // The password-reset email link signs the user in with this event; ask for a new password first.
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      setSession(s);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const load = useCallback(async () => {
    setError('');
    try {
      setDash(await api(`/me/dashboard?date=${localDate()}`));
    } catch (e) {
      // Keep showing cached data if we have it; only block the screen when there's nothing to show.
      setDash((d) => {
        if (!d) setError(e.message);
        return d;
      });
    }
  }, []);

  // Keyed on user id so silent token refreshes don't refetch.
  useEffect(() => {
    if (!userId) return setDash(null);
    const cached = readCache(userId);
    // Yesterday's meals would be misleading, so only reuse a cache from today.
    if (cached?.profile && cached.today?.date === localDate()) setDash(cached);
    load();
  }, [userId, load]);

  useEffect(() => {
    if (userId && dash) writeCache(userId, dash);
  }, [userId, dash]);

  // Fetch the other tabs' code while the browser is idle, so switching tabs is instant.
  useEffect(() => {
    if (!dash?.profile) return;
    const idle = window.requestIdleCallback ?? ((fn) => setTimeout(fn, 1500));
    idle(() => {
      loadTrain();
      loadProgress();
      if (dash.checkin.due) loadCheckIn();
    });
  }, [Boolean(dash?.profile)]); // eslint-disable-line react-hooks/exhaustive-deps

  // Coming back to the app on a new day should show the new day.
  useEffect(() => {
    if (!dash?.today) return;
    const onVisible = () => document.visibilityState === 'visible' && dash.today.date !== localDate() && load();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [dash?.today, load]);

  const goTo = (t) => {
    setTab(t);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const signOut = () => {
    writeCache(userId, null);
    setSettingsOpen(false);
    supabase.auth.signOut();
  };

  if (session === undefined) return <div className="app"><Loading /></div>;
  if (!session || recovery) return <Auth recovery={recovery} onRecovered={() => setRecovery(false)} />;

  const header = (
    <header className="topbar">
      <div className="brand">
        <span className="logo" aria-hidden="true">💪</span>Hardgainer
      </div>
      {dash?.streak > 0 && <span className="chip fire" title="Days in a row with food logged">🔥 {dash.streak}</span>}
      <button className="icon" onClick={toggleTheme} aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}>
        {dark ? '☀️' : '🌙'}
      </button>
      {dash?.profile ? (
        <button className="icon" onClick={() => setSettingsOpen(true)} aria-label="Settings" title="Settings">⚙️</button>
      ) : (
        <button className="icon" onClick={signOut} aria-label="Sign out" title="Sign out">⎋</button>
      )}
    </header>
  );

  if (error) {
    return (
      <div className="app">
        {header}
        <div className="card center stack" style={{ marginTop: '10vh' }}>
          <p className="error">{error}</p>
          <button onClick={load}>Try again</button>
        </div>
      </div>
    );
  }
  if (!dash) return <div className="app">{header}<Loading /></div>;

  if (!dash.profile) {
    return (
      <div className="app">
        {header}
        <Suspense fallback={<Loading />}>
          <Onboarding onDone={setDash} />
        </Suspense>
      </div>
    );
  }

  const setToday = (today) => setDash((d) => ({ ...d, today }));
  const current = TABS.some(([k]) => k === tab) ? tab : 'today';

  return (
    <div className="app">
      {header}

      {checkinResult && (
        <section className="card tint" style={{ marginBottom: '1rem' }}>
          <div className="spread">
            <h2>Week {dash.workout.week_number} is ready</h2>
            <button className="link" onClick={() => setCheckinResult(null)} aria-label="Dismiss">✕</button>
          </div>
          <p>{checkinResult.reason}</p>
          <p>
            Daily calories <span className="num">{checkinResult.calories_before}</span> →{' '}
            <strong className="num">{checkinResult.calories_after}</strong>
          </p>
          {checkinResult.goal_reached && <p className="success"><strong>You hit your target weight! 🎉</strong></p>}
          {checkinResult.goal_reached && <Confetti />}
        </section>
      )}

      {dash.checkin.due && !checkinResult && (
        <button className="card tint big" style={{ textAlign: 'left', marginBottom: '1rem', color: 'var(--text)' }} onClick={() => setCheckinOpen(true)}>
          <div className="spread">
            <div>
              <strong>⚖️ Weekly check-in is open</strong>
              <div className="small muted">Weigh in so we can tune your calories and build next week's workouts.</div>
            </div>
            <span className="chip accent">Start →</span>
          </div>
        </button>
      )}

      <Suspense fallback={<Loading />}>
        {current === 'today' && <TodayView dash={dash} onTodayChange={setToday} />}
        {current === 'train' && <TrainView workout={dash.workout} />}
        {current === 'progress' && <ProgressView dash={dash} />}

        {settingsOpen && (
          <Sheet onClose={() => setSettingsOpen(false)} label="Settings">
            <Settings profile={dash.profile} onSaved={setDash} onClose={() => setSettingsOpen(false)} onSignOut={signOut} />
          </Sheet>
        )}

        {checkinOpen && (
          <Sheet onClose={() => setCheckinOpen(false)} label="Weekly check-in">
            <CheckIn
              currentWeight={dash.profile.weight_kg}
              onDone={({ result, dashboard }) => {
                setDash(dashboard);
                setCheckinResult(result);
                setCheckinOpen(false);
                goTo('train');
              }}
            />
          </Sheet>
        )}
      </Suspense>

      <nav className="tabs" aria-label="Sections">
        {TABS.map(([key, icon, label]) => (
          <button key={key} className={current === key ? 'active' : ''} onClick={() => goTo(key)} aria-current={current === key ? 'page' : undefined}>
            <span aria-hidden="true">{icon}</span>
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}
