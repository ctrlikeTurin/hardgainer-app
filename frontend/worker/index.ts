import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { addDays, adjustSurplus, buildPlan, diffDays, type Activity, type Sex } from './math';
import { AIUnavailable, analyzeMeal, analyzeText, progressWorkout, type FoodEstimate } from './ai';
import { rulesProgression, sanitizeAiPlan, templateFor, type Plan } from './workouts';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  GEMINI_API_KEY?: string;
  SUPABASE_URL?: string;
  SUPABASE_JWT_SECRET?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  AI_GATEWAY_URL?: string;
  VISION_MODELS: string;
  TEXT_MODELS: string;
  CHECKIN_MIN_DAYS: string;
  FOOD_SCANS_PER_MINUTE: string;
  FOOD_AI_PER_DAY: string;
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const ACTIVITIES = new Set(['sedentary', 'light', 'moderate', 'active', 'very_active']);

// ---------- auth ----------

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

async function authenticate(req: Request, env: Env): Promise<{ id: string; email: string | null }> {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) throw new HttpError(401, 'Invalid or expired session');
  let claims: JWTPayload;
  try {
    if (env.SUPABASE_JWT_SECRET) {
      claims = (await jwtVerify(token, new TextEncoder().encode(env.SUPABASE_JWT_SECRET), { audience: 'authenticated', algorithms: ['HS256'] })).payload;
    } else {
      if (!env.SUPABASE_URL) throw new HttpError(500, 'Auth is not configured');
      jwks ??= createRemoteJWKSet(new URL(`${env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/.well-known/jwks.json`));
      claims = (await jwtVerify(token, jwks, { audience: 'authenticated' })).payload;
    }
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(401, 'Invalid or expired session');
  }
  // Supabase only issues sessions after email confirmation when "Confirm email" is on.
  if (claims.role !== 'authenticated' || !claims.sub) throw new HttpError(401, 'Invalid or expired session');
  return { id: claims.sub, email: (claims.email as string) ?? null };
}

// ---------- validation ----------

function checkDate(d: unknown): string {
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new HttpError(422, 'Invalid date');
  const today = new Date().toISOString().slice(0, 10);
  if (Math.abs(diffDays(d, today)) > 1) throw new HttpError(422, 'Date is out of range');
  return d;
}

function numIn(v: unknown, lo: number, hi: number, name: string): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < lo || n > hi) throw new HttpError(422, `${name} must be between ${lo} and ${hi}`);
  return n;
}

// ---------- data access ----------

type Row = Record<string, any>;

async function getOrCreateUser(env: Env, id: string, email: string | null): Promise<Row> {
  const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
  if (user) return user;
  await env.DB.prepare('INSERT INTO users (id, email) VALUES (?, ?) ON CONFLICT(id) DO NOTHING').bind(id, email).run();
  return (await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first())!;
}

const latestStmt = (env: Env, table: 'goals' | 'workouts' | 'checkins', userId: string) =>
  env.DB.prepare(`SELECT * FROM ${table} WHERE user_id = ? ORDER BY id DESC LIMIT 1`).bind(userId);
const latest = (env: Env, table: 'goals' | 'workouts' | 'checkins', userId: string) => latestStmt(env, table, userId).first<Row>();
const dayLogsStmt = (env: Env, userId: string, day: string) =>
  env.DB.prepare('SELECT * FROM food_logs WHERE user_id = ? AND log_date = ? ORDER BY id').bind(userId, day);

function insertGoal(env: Env, userId: string, today: string, p: ReturnType<typeof buildPlan>, reason: string) {
  return env.DB.prepare(
    `INSERT INTO goals (user_id, created_on, bmr, tdee, surplus, calories, protein_g, carbs_g, fat_g, weekly_rate_kg,
      week_goal_kg, week_goal_date, month_goal_kg, month_goal_date, target_date, reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(userId, today, p.bmr, p.tdee, p.surplus, p.calories, p.protein_g, p.carbs_g, p.fat_g, p.weekly_rate_kg,
    p.week_goal_kg, p.week_goal_date, p.month_goal_kg, p.month_goal_date, p.target_date, reason);
}

const insertWorkout = (env: Env, userId: string, week: number, envName: string, plan: Plan, source: string) =>
  env.DB.prepare('INSERT INTO workouts (user_id, week_number, environment, plan, source) VALUES (?, ?, ?, ?, ?)')
    .bind(userId, week, envName, JSON.stringify(plan), source);

const profileOf = (u: Row) => ({
  sex: u.sex as Sex, age: u.age, height_cm: u.height_cm, weight_kg: u.weight_kg,
  target_weight_kg: u.target_weight_kg, activity_level: u.activity_level as Activity,
});

const foodLogOut = (l: Row) => ({
  id: l.id, description: l.description, items: JSON.parse(l.items), calories: l.calories,
  protein: l.protein, carbs: l.carbs, fats: l.fats, confidence: l.confidence, created_at: l.created_at,
});

function loggingStreak(dates: { log_date: string }[], today: string): number {
  const days = new Set(dates.map((r) => r.log_date));
  // Today not logged yet doesn't break the streak; it just hasn't grown.
  let cursor = days.has(today) ? today : addDays(today, -1);
  let streak = 0;
  while (days.has(cursor)) {
    streak++;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

async function daySummary(env: Env, userId: string, goal: Row, day: string) {
  const { results } = await dayLogsStmt(env, userId, day).all<Row>();
  return summarize(goal, day, results);
}

function summarize(goal: Row, day: string, results: Row[]) {
  const fields = ['calories', 'protein', 'carbs', 'fats'] as const;
  const targets = { calories: goal.calories, protein: goal.protein_g, carbs: goal.carbs_g, fats: goal.fat_g };
  const consumed = Object.fromEntries(fields.map((f) => [f, Math.round(results.reduce((s, l) => s + l[f], 0) * 10) / 10])) as Record<(typeof fields)[number], number>;
  const remaining = Object.fromEntries(fields.map((f) => [f, Math.round((targets[f] - consumed[f]) * 10) / 10]));
  return { date: day, targets, consumed, remaining, logs: results.map(foodLogOut) };
}

const goalOut = (g: Row) => ({
  bmr: g.bmr, tdee: g.tdee, surplus: g.surplus, calories: g.calories, protein_g: g.protein_g, carbs_g: g.carbs_g,
  fat_g: g.fat_g, weekly_rate_kg: g.weekly_rate_kg,
  week_goal: { weight_kg: g.week_goal_kg, date: g.week_goal_date },
  month_goal: { weight_kg: g.month_goal_kg, date: g.month_goal_date },
  target_date: g.target_date, reason: g.reason,
});

async function lastCheckinDate(env: Env, user: Row): Promise<string> {
  const last = await latest(env, 'checkins', user.id);
  return last ? last.checkin_date : user.onboarded_on;
}

async function dashboard(env: Env, user: Row, day: string) {
  if (!user.onboarded_on) return { profile: null };
  // One batch = one round trip to D1 instead of one per query.
  const [goalR, workoutR, checkins, recent, streakDays, todayLogs] = await env.DB.batch<Row>([
    latestStmt(env, 'goals', user.id),
    latestStmt(env, 'workouts', user.id),
    env.DB.prepare('SELECT checkin_date, weight_kg, difficulty, decision, surplus_before, surplus_after FROM checkins WHERE user_id = ? ORDER BY id')
      .bind(user.id),
    env.DB.prepare(
      `SELECT * FROM food_logs WHERE id IN (
         SELECT MAX(id) FROM food_logs WHERE user_id = ? AND log_date < ? GROUP BY lower(description)
       ) ORDER BY id DESC LIMIT 6`,
    ).bind(user.id, day),
    env.DB.prepare('SELECT DISTINCT log_date FROM food_logs WHERE user_id = ? AND log_date <= ? ORDER BY log_date DESC LIMIT 120')
      .bind(user.id, day),
    dayLogsStmt(env, user.id, day),
  ]);
  const goal = goalR.results[0];
  const workout = workoutR.results[0];
  const lastDate = checkins.results.at(-1)?.checkin_date ?? user.onboarded_on;
  const streak = loggingStreak(streakDays.results as { log_date: string }[], day);
  let plan: Plan = JSON.parse(workout!.plan);
  if (workout!.source === 'template' && plan.days.some((d) => d.exercises.some((e) => !e.id))) {
    plan = templateFor(workout!.environment);
    await env.DB.prepare('UPDATE workouts SET plan = ? WHERE id = ?').bind(JSON.stringify(plan), workout!.id).run();
  }
  const next = addDays(lastDate, 7);
  const history = [
    { date: user.onboarded_on, weight_kg: user.start_weight_kg },
    ...checkins.results.map((c) => ({ date: c.checkin_date, weight_kg: c.weight_kg })),
  ];
  return {
    profile: {
      email: user.email, age: user.age, sex: user.sex, height_cm: user.height_cm, start_weight_kg: user.start_weight_kg,
      weight_kg: user.weight_kg, target_weight_kg: user.target_weight_kg, activity_level: user.activity_level,
      environment: user.environment,
    },
    goal: goalOut(goal!),
    today: summarize(goal!, day, todayLogs.results),
    workout: { week_number: workout!.week_number, source: workout!.source, environment: workout!.environment, plan },
    checkin: { due: diffDays(day, next) >= 0, next_date: next },
    weight_history: history,
    checkins: checkins.results.slice(-8).reverse(),
    recent_meals: recent.results.map(foodLogOut),
    streak,
  };
}

// ---------- handlers ----------

async function onboarding(env: Env, user: Row, body: any) {
  const date = checkDate(body?.date);
  const age = Math.round(numIn(body?.age, 14, 90, 'Age'));
  const height = numIn(body?.height_cm, 120, 230, 'Height');
  const weight = numIn(body?.weight_kg, 30, 250, 'Weight');
  const target = numIn(body?.target_weight_kg, 30, 250, 'Target weight');
  if (target <= weight) throw new HttpError(422, 'Target weight must be higher than current weight');
  if (body?.sex !== 'male' && body?.sex !== 'female') throw new HttpError(422, 'Invalid sex');
  if (!ACTIVITIES.has(body?.activity_level)) throw new HttpError(422, 'Invalid activity level');
  if (body?.environment !== 'home' && body?.environment !== 'gym') throw new HttpError(422, 'Invalid environment');

  const profile = { sex: body.sex, age, height_cm: height, weight_kg: weight, target_weight_kg: target, activity_level: body.activity_level };
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE users SET age=?, sex=?, height_cm=?, start_weight_kg=?, weight_kg=?, target_weight_kg=?,
        activity_level=?, environment=?, onboarded_on=? WHERE id=?`,
    ).bind(age, body.sex, height, weight, weight, target, body.activity_level, body.environment, date, user.id),
    insertGoal(env, user.id, date, buildPlan(profile, date), 'Initial plan'),
    insertWorkout(env, user.id, 1, body.environment, templateFor(body.environment), 'template'),
  ]);
  const fresh = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(user.id).first<Row>();
  return dashboard(env, fresh!, date);
}

// All users share one free Gemini quota, so each user gets a per-minute and a per-day allowance.
async function checkAiRate(env: Env, userId: string) {
  const counts = await env.DB.prepare(
    `SELECT COUNT(*) AS day, SUM(created_at > datetime('now', '-60 seconds')) AS minute FROM food_logs
     WHERE user_id = ? AND model NOT IN ('repeat', 'manual') AND created_at > datetime('now', '-1 day')`,
  ).bind(userId).first<{ day: number; minute: number | null }>();
  if ((counts?.minute ?? 0) >= Number(env.FOOD_SCANS_PER_MINUTE)) throw new HttpError(429, 'Too many meals logged at once. Wait a minute and try again.');
  if ((counts?.day ?? 0) >= Number(env.FOOD_AI_PER_DAY || 40)) {
    throw new HttpError(429, "You've used today's AI estimates. Use Manual entry or \"Eat it again\" until tomorrow.");
  }
}

async function runAi<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof AIUnavailable) throw new HttpError(503, e.message);
    throw e;
  }
}

async function saveLog(env: Env, userId: string, date: string, est: FoodEstimate, model: string) {
  // Batches run in order in one round trip, so the day's logs already include the new row.
  const [inserted, goal, logs] = await env.DB.batch<Row>([
    env.DB.prepare(
      `INSERT INTO food_logs (user_id, log_date, description, items, calories, protein, carbs, fats, confidence, model)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    ).bind(userId, date, String(est.description ?? '').slice(0, 500), JSON.stringify(est.items), est.calories,
      Number(est.protein) || 0, Number(est.carbs) || 0, Number(est.fats) || 0, est.confidence, model),
    latestStmt(env, 'goals', userId),
    dayLogsStmt(env, userId, date),
  ]);
  return { log: foodLogOut(inserted.results[0]), today: summarize(goal.results[0], date, logs.results) };
}

async function scanFood(env: Env, user: Row, req: Request) {
  const form = await req.formData();
  const date = checkDate(form.get('log_date'));
  const hint = String(form.get('hint') ?? '').slice(0, 200);
  const image = form.get('image');
  if (!(image instanceof File)) throw new HttpError(422, 'Missing image');
  if (!IMAGE_TYPES.has(image.type)) throw new HttpError(415, 'Upload a JPEG, PNG, WebP or HEIC photo');
  if (image.size > MAX_IMAGE_BYTES) throw new HttpError(413, 'Image is too large (max 5 MB)');
  await checkAiRate(env, user.id);

  const { estimate, model } = await runAi(async () => analyzeMeal(env, await image.arrayBuffer(), image.type, hint));
  if (!estimate.is_food || !(estimate.calories > 0)) throw new HttpError(422, 'No food detected in that photo. Try another angle.');
  return saveLog(env, user.id, date, estimate, model);
}

async function describeFood(env: Env, user: Row, body: any) {
  const date = checkDate(body?.log_date);
  const text = String(body?.text ?? '').trim().slice(0, 300);
  if (text.length < 3) throw new HttpError(422, 'Describe what you ate');
  await checkAiRate(env, user.id);

  const { estimate, model } = await runAi(() => analyzeText(env, text));
  if (!estimate.is_food || !(estimate.calories > 0)) throw new HttpError(422, "That doesn't look like a meal. Try e.g. \"2 eggs and toast\".");
  if (!estimate.description) estimate.description = text;
  return saveLog(env, user.id, date, estimate, model);
}

async function repeatFood(env: Env, user: Row, id: number, body: any) {
  const date = checkDate(body?.log_date);
  const src = await env.DB.prepare('SELECT * FROM food_logs WHERE id = ? AND user_id = ?').bind(id, user.id).first<Row>();
  if (!src) throw new HttpError(404, 'Log not found');
  const est = {
    is_food: true, description: src.description, items: JSON.parse(src.items), calories: src.calories,
    protein: src.protein, carbs: src.carbs, fats: src.fats, confidence: src.confidence,
  };
  return saveLog(env, user.id, date, est, 'repeat');
}

async function quickAdd(env: Env, user: Row, body: any) {
  const date = checkDate(body?.log_date);
  const description = String(body?.description ?? '').trim().slice(0, 200);
  if (!description) throw new HttpError(422, 'Missing description');
  const calories = numIn(body?.calories, 1, 3000, 'Calories');
  const protein = numIn(body?.protein ?? 0, 0, 300, 'Protein');
  const carbs = numIn(body?.carbs ?? 0, 0, 500, 'Carbs');
  const fats = numIn(body?.fats ?? 0, 0, 300, 'Fats');
  const est = {
    is_food: true, description, confidence: 'high', calories, protein, carbs, fats,
    items: [{ name: description, portion: '1 serving', calories, protein, carbs, fats }],
  };
  return saveLog(env, user.id, date, est, 'manual');
}

async function scaleFood(env: Env, user: Row, id: number, body: any) {
  const factor = numIn(body?.factor, 0.25, 4, 'Portion factor');
  const src = await env.DB.prepare('SELECT * FROM food_logs WHERE id = ? AND user_id = ?').bind(id, user.id).first<Row>();
  if (!src) throw new HttpError(404, 'Log not found');
  const r1 = (x: number) => Math.round(x * factor * 10) / 10;
  const items = JSON.parse(src.items).map((i: Row) => ({
    ...i, calories: r1(i.calories), protein: r1(i.protein), carbs: r1(i.carbs), fats: r1(i.fats),
  }));
  const log = await env.DB.prepare(
    'UPDATE food_logs SET items = ?, calories = ?, protein = ?, carbs = ?, fats = ? WHERE id = ? RETURNING *',
  ).bind(JSON.stringify(items), r1(src.calories), r1(src.protein), r1(src.carbs), r1(src.fats), id).first<Row>();
  const goal = await latest(env, 'goals', user.id);
  return { log: foodLogOut(log!), today: await daySummary(env, user.id, goal!, src.log_date) };
}

async function deleteFood(env: Env, user: Row, id: number) {
  const log = await env.DB.prepare('DELETE FROM food_logs WHERE id = ? AND user_id = ? RETURNING log_date').bind(id, user.id).first<Row>();
  if (!log) throw new HttpError(404, 'Log not found');
  const goal = await latest(env, 'goals', user.id);
  return { today: await daySummary(env, user.id, goal!, log.log_date) };
}

async function updateProfile(env: Env, user: Row, body: any) {
  const date = checkDate(body?.date);
  const target = numIn(body?.target_weight_kg, 30, 250, 'Target weight');
  if (target <= user.weight_kg) throw new HttpError(422, 'Target weight must be higher than current weight');
  if (!ACTIVITIES.has(body?.activity_level)) throw new HttpError(422, 'Invalid activity level');
  if (body?.environment !== 'home' && body?.environment !== 'gym') throw new HttpError(422, 'Invalid environment');

  const [goal, workout] = await Promise.all([latest(env, 'goals', user.id), latest(env, 'workouts', user.id)]);
  const profile = { ...profileOf(user), target_weight_kg: target, activity_level: body.activity_level as Activity };
  // Keep the surplus that weekly check-ins have tuned; only maintenance calories and milestones change.
  const stmts = [
    env.DB.prepare('UPDATE users SET target_weight_kg = ?, activity_level = ?, environment = ? WHERE id = ?')
      .bind(target, body.activity_level, body.environment, user.id),
    insertGoal(env, user.id, date, buildPlan(profile, date, goal!.surplus), 'Profile updated'),
  ];
  if (body.environment !== workout!.environment) {
    stmts.push(insertWorkout(env, user.id, workout!.week_number, body.environment, templateFor(body.environment), 'template'));
  }
  await env.DB.batch(stmts);
  const fresh = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(user.id).first<Row>();
  return dashboard(env, fresh!, date);
}

async function deleteAccount(env: Env, user: Row) {
  await env.DB.batch(
    ['food_logs', 'checkins', 'workouts', 'goals'].map((t) => env.DB.prepare(`DELETE FROM ${t} WHERE user_id = ?`).bind(user.id))
      .concat(env.DB.prepare('DELETE FROM users WHERE id = ?').bind(user.id)),
  );
  // Removing the login itself needs the service role key; without it only the app data is deleted.
  let loginDeleted = false;
  if (env.SUPABASE_SERVICE_ROLE_KEY && env.SUPABASE_URL) {
    const res = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/admin/users/${user.id}`, {
      method: 'DELETE',
      headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
    });
    loginDeleted = res.ok;
    if (!res.ok) console.error('Supabase user delete failed', res.status, await res.text());
  }
  return { deleted: true, login_deleted: loginDeleted };
}

async function checkin(env: Env, user: Row, body: any) {
  const date = checkDate(body?.date);
  const weight = numIn(body?.weight_kg, 30, 250, 'Weight');
  const difficulty = Math.round(numIn(body?.difficulty, 1, 5, 'Difficulty'));
  const notes = String(body?.notes ?? '').slice(0, 500);

  const prevDate = await lastCheckinDate(env, user);
  const days = diffDays(date, prevDate);
  const minDays = Number(env.CHECKIN_MIN_DAYS);
  if (days < minDays) throw new HttpError(409, `Your next check-in opens on ${addDays(prevDate, minDays)}`);

  const [goal, prevWorkout] = await Promise.all([latest(env, 'goals', user.id), latest(env, 'workouts', user.id)]);
  const adj = adjustSurplus(goal!.surplus, weight - user.weight_kg, days);
  const newPlan = buildPlan({ ...profileOf(user), weight_kg: weight }, date, adj.surplus);

  const previous: Plan = JSON.parse(prevWorkout!.plan);
  let plan: Plan;
  let source: string;
  try {
    const ai = await progressWorkout(env, {
      previous, environment: prevWorkout!.environment, difficulty, notes,
      weeklyChange: adj.weekly_change_kg, week: prevWorkout!.week_number + 1,
    });
    plan = sanitizeAiPlan(ai.plan, previous, prevWorkout!.environment);
    source = ai.model;
  } catch (e) {
    console.warn('Falling back to rules-based progression', e);
    plan = rulesProgression(previous, difficulty);
    source = 'rules';
  }

  await env.DB.batch([
    env.DB.prepare('UPDATE users SET weight_kg = ? WHERE id = ?').bind(weight, user.id),
    insertGoal(env, user.id, date, newPlan, adj.reason),
    insertWorkout(env, user.id, prevWorkout!.week_number + 1, prevWorkout!.environment, plan, source),
    env.DB.prepare(
      `INSERT INTO checkins (user_id, checkin_date, weight_kg, previous_weight_kg, days_elapsed, difficulty, notes,
        surplus_before, surplus_after, decision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(user.id, date, weight, user.weight_kg, days, difficulty, notes, goal!.surplus, adj.surplus, adj.decision),
  ]);

  const fresh = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(user.id).first<Row>();
  return {
    result: {
      decision: adj.decision, reason: adj.reason, weekly_change_kg: adj.weekly_change_kg,
      calories_before: goal!.calories, calories_after: newPlan.calories,
      goal_reached: weight >= user.target_weight_kg, workout_source: source,
    },
    dashboard: await dashboard(env, fresh!, date),
  };
}

async function route(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api/, '');
  if (path === '/health') {
    // ?db=1 times one D1 round trip from wherever the Worker is running.
    if (url.searchParams.get('db') !== '1') return json({ ok: true });
    const t = Date.now();
    await env.DB.prepare('SELECT 1').first();
    return json({ ok: true, db_ms: Date.now() - t, colo: (req as any).cf?.colo ?? null });
  }

  const auth = await authenticate(req, env);
  const user = await getOrCreateUser(env, auth.id, auth.email);
  const needOnboarded = () => {
    if (!user.onboarded_on) throw new HttpError(409, 'Complete onboarding first');
  };

  if (req.method === 'GET' && path === '/me/dashboard') return json(await dashboard(env, user, checkDate(url.searchParams.get('date'))));
  if (req.method === 'POST' && path === '/me/onboarding') return json(await onboarding(env, user, await req.json().catch(() => null)));
  if (req.method === 'PATCH' && path === '/me/profile') {
    needOnboarded();
    return json(await updateProfile(env, user, await req.json().catch(() => null)));
  }
  if (req.method === 'DELETE' && path === '/me') return json(await deleteAccount(env, user));
  if (req.method === 'POST' && path === '/food/scan') {
    needOnboarded();
    return json(await scanFood(env, user, req));
  }
  if (req.method === 'POST' && path === '/food/quick') {
    needOnboarded();
    return json(await quickAdd(env, user, await req.json().catch(() => null)));
  }
  if (req.method === 'POST' && path === '/food/describe') {
    needOnboarded();
    return json(await describeFood(env, user, await req.json().catch(() => null)));
  }
  const logRoute = path.match(/^\/food\/logs\/(\d+)(\/repeat)?$/);
  if (logRoute) {
    needOnboarded();
    const id = Number(logRoute[1]);
    if (req.method === 'POST' && logRoute[2]) return json(await repeatFood(env, user, id, await req.json().catch(() => null)));
    if (req.method === 'PATCH' && !logRoute[2]) return json(await scaleFood(env, user, id, await req.json().catch(() => null)));
    if (req.method === 'DELETE' && !logRoute[2]) return json(await deleteFood(env, user, id));
  }
  if (req.method === 'POST' && path === '/checkins') {
    needOnboarded();
    return json(await checkin(env, user, await req.json().catch(() => null)));
  }
  throw new HttpError(404, 'Not found');
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    const started = Date.now();
    let res: Response;
    try {
      res = await route(req, env);
    } catch (e) {
      if (e instanceof HttpError) res = json({ detail: e.message }, e.status);
      else {
        console.error(e);
        res = json({ detail: 'Something went wrong' }, 500);
      }
    }
    res.headers.set('server-timing', `app;dur=${Date.now() - started}`);
    res.headers.set('cache-control', 'no-store');
    res.headers.set('x-content-type-options', 'nosniff');
    return res;
  },
} satisfies ExportedHandler<Env>;
