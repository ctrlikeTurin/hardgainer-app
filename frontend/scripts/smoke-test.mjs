// End-to-end API check against a local `vite dev` (uses SUPABASE_JWT_SECRET from .dev.vars).
// Usage: node scripts/smoke-test.mjs [baseUrl] [mealPhoto.jpg]
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';

const BASE = process.argv[2] ?? 'http://localhost:5173';
const SECRET = 'local-test-secret-only';
const today = new Date().toISOString().slice(0, 10);

const token = await new SignJWT({ role: 'authenticated', email: 'smoke@test.local' })
  .setProtectedHeader({ alg: 'HS256' })
  .setSubject(`smoke-${Date.now()}`)
  .setAudience('authenticated')
  .setExpirationTime('10m')
  .sign(new TextEncoder().encode(SECRET));

async function call(method, path, body, raw) {
  const headers = { authorization: `Bearer ${token}` };
  if (body && !raw) headers['content-type'] = 'application/json';
  const res = await fetch(`${BASE}/api${path}`, { method, headers, body: raw ?? (body && JSON.stringify(body)) });
  return { status: res.status, body: await res.json() };
}

function check(name, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} ${extra}`);
  if (!cond) process.exitCode = 1;
}

let r = await fetch(`${BASE}/api/me/dashboard?date=${today}`);
check('rejects missing token', r.status === 401);

r = await call('GET', `/me/dashboard?date=${today}`);
check('new user has no profile', r.status === 200 && r.body.profile === null);

r = await call('POST', '/me/onboarding', { age: 22, sex: 'male', height_cm: 178, weight_kg: 70, target_weight_kg: 60, activity_level: 'moderate', environment: 'gym', date: today });
check('rejects target below current', r.status === 422, r.body.detail);

r = await call('POST', '/me/onboarding', { age: 22, sex: 'male', height_cm: 178, weight_kg: 60, target_weight_kg: 70, activity_level: 'moderate', environment: 'home', date: today });
const g = r.body.goal;
check('onboarding builds plan', r.status === 200 && g.surplus === 400 && Math.abs(g.calories - (g.tdee + 400)) <= 1, JSON.stringify({ tdee: g?.tdee, cal: g?.calories, P: g?.protein_g, target: g?.target_date }));
check('home PPL Fri/Sat/Sun', r.body.workout?.plan.days.map((d) => d.day).join() === 'Friday,Saturday,Sunday');

const imagePath = process.argv[3];
const imageBytes = imagePath ? readFileSync(imagePath) : new Uint8Array([0xff, 0xd8, 0xff]);
const form = new FormData();
form.append('image', new Blob([imageBytes], { type: 'image/jpeg' }), 'meal.jpg');
form.append('log_date', today);
const t0 = Date.now();
r = await call('POST', '/food/scan', null, form);
if (imagePath) {
  check('real meal photo analyzed', r.status === 200 && r.body.today.consumed.calories > 0,
    `${r.status} ${Date.now() - t0}ms ${r.body.detail ?? JSON.stringify(r.body.log)} remaining=${r.body.today?.remaining.calories}`);
} else {
  check('food scan reaches AI layer', [200, 503, 422].includes(r.status), `${r.status} ${r.body.detail ?? ''}`);
}

r = await call('POST', '/food/quick', { log_date: today, description: 'Protein shake', calories: 300, protein: 30, carbs: 20, fats: 8 });
check('quick add logs a meal', r.status === 200 && r.body.log.calories === 300, `${r.status} ${r.body.detail ?? ''}`);
const quickId = r.body.log?.id;
r = await call('PATCH', `/food/logs/${quickId}`, { factor: 2 });
check('portion scaling doubles macros', r.status === 200 && r.body.log.calories === 600 && r.body.log.protein === 60);
r = await call('POST', `/food/logs/${quickId}/repeat`, { log_date: today });
check('repeat copies a meal', r.status === 200 && r.body.log.id !== quickId && r.body.log.calories === 600);
r = await call('POST', '/food/describe', { log_date: today, text: '2 boiled eggs and a slice of toast' });
check('describe reaches AI layer', [200, 503].includes(r.status), `${r.status} ${r.body.detail ?? JSON.stringify(r.body.log?.calories)}`);
r = await call('GET', `/me/dashboard?date=${today}`);
check('dashboard has streak, history and exercise ids', r.status === 200 && r.body.streak === 1 && r.body.weight_history.length === 1
  && r.body.workout.plan.days.every((d) => d.exercises.every((e) => e.id)), `streak=${r.body.streak}`);

r = await call('POST', '/checkins', { weight_kg: 60, difficulty: 2, notes: '', date: today });
const res = r.body.result;
check('stalled check-in adds 150 kcal', r.status === 200 && res.decision === 'increase' && res.calories_after - res.calories_before >= 140, JSON.stringify(res));
check('week 2 workout created', r.body.dashboard?.workout.week_number === 2, `source=${res?.workout_source}`);

r = await call('PATCH', '/me/profile', { target_weight_kg: 72, activity_level: 'light', environment: 'gym', date: today });
check('profile update switches to gym plan', r.status === 200 && r.body.profile.target_weight_kg === 72 && r.body.workout.environment === 'gym'
  && r.body.goal.reason === 'Profile updated', `${r.status} ${r.body.detail ?? ''}`);
r = await call('PATCH', '/me/profile', { target_weight_kg: 50, activity_level: 'light', environment: 'gym', date: today });
check('profile update rejects target below weight', r.status === 422);

r = await call('DELETE', '/food/logs/999999');
check('delete unknown log 404', r.status === 404);

r = await call('DELETE', '/me');
check('delete account', r.status === 200 && r.body.deleted === true);
r = await call('GET', `/me/dashboard?date=${today}`);
check('deleted user starts fresh', r.status === 200 && r.body.profile === null);
