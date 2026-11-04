// Port of backend/app/fitness_math.py. Dates are ISO "YYYY-MM-DD" strings, computed in UTC.

export type Sex = 'male' | 'female';
export type Activity = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';

export const ACTIVITY_MULTIPLIERS: Record<Activity, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};
const INITIAL_SURPLUS: Record<Activity, number> = {
  sedentary: 300,
  light: 350,
  moderate: 400,
  active: 450,
  very_active: 500,
};
const KCAL_PER_KG = 7700;
const MIN_RATE = 0.25;
const MAX_RATE = 0.5;
const PROTEIN_G_PER_KG = 2.0;
const FAT_SHARE = 0.25;
const FAT_MIN_G_PER_KG = 0.8;
const STALL_KG_PER_WEEK = 0.1;
const TOO_FAST_KG_PER_WEEK = 0.6;
const SURPLUS_FLOOR = 250;
export const SURPLUS_CEILING = 1200;

const DAY_MS = 86_400_000;
const parse = (iso: string) => new Date(`${iso}T00:00:00Z`);
const fmt = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (iso: string, n: number) => fmt(new Date(parse(iso).getTime() + n * DAY_MS));
export const diffDays = (a: string, b: string) => Math.round((parse(a).getTime() - parse(b).getTime()) / DAY_MS);
const endOfMonth = (iso: string) => {
  const d = parse(iso);
  return fmt(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
};
const round1 = (x: number) => Math.round(x * 10) / 10;
const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi);

export function bmr(sex: Sex, weightKg: number, heightCm: number, age: number) {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return sex === 'male' ? base + 5 : base - 161;
}

export function macrosFor(calories: number, weightKg: number) {
  const protein = weightKg * PROTEIN_G_PER_KG;
  const fat = Math.max((calories * FAT_SHARE) / 9, weightKg * FAT_MIN_G_PER_KG);
  const carbs = Math.max((calories - protein * 4 - fat * 9) / 4, 0);
  return { protein_g: Math.round(protein), carbs_g: Math.round(carbs), fat_g: Math.round(fat) };
}

export const weeklyGainRate = (surplus: number) =>
  Math.round(clamp((surplus * 7) / KCAL_PER_KG, MIN_RATE, MAX_RATE) * 1000) / 1000;

export function timeline(currentKg: number, targetKg: number, rate: number, today: string) {
  const daily = rate / 7;
  const projected = (on: string) => round1(Math.min(currentKg + daily * diffDays(on, today), targetKg));

  const weekday = (parse(today).getUTCDay() + 6) % 7; // Monday = 0
  const weekEnd = addDays(today, 6 - weekday || 7);

  let monthEnd = endOfMonth(today);
  if (diffDays(monthEnd, today) < 7) monthEnd = endOfMonth(addDays(monthEnd, 1));

  const gap = Math.max(targetKg - currentKg, 0);
  return {
    weekly_rate_kg: rate,
    week_goal_kg: projected(weekEnd),
    week_goal_date: weekEnd,
    month_goal_kg: projected(monthEnd),
    month_goal_date: monthEnd,
    target_date: gap ? addDays(today, Math.ceil(gap / daily)) : today,
  };
}

export interface Profile {
  sex: Sex;
  age: number;
  height_cm: number;
  weight_kg: number;
  target_weight_kg: number;
  activity_level: Activity;
}

export function buildPlan(p: Profile, today: string, surplus?: number) {
  const b = bmr(p.sex, p.weight_kg, p.height_cm, p.age);
  const tdee = b * ACTIVITY_MULTIPLIERS[p.activity_level];
  const s = surplus ?? INITIAL_SURPLUS[p.activity_level];
  const calories = Math.round(tdee + s);
  return {
    bmr: Math.round(b),
    tdee: Math.round(tdee),
    surplus: s,
    calories,
    ...macrosFor(calories, p.weight_kg),
    ...timeline(p.weight_kg, p.target_weight_kg, weeklyGainRate(s), today),
  };
}

export function adjustSurplus(current: number, changeKg: number, days: number) {
  const weekly = (changeKg * 7) / Math.max(days, 1);
  const w = (weekly >= 0 ? '+' : '') + weekly.toFixed(2);
  let surplus = current;
  let decision: 'increase' | 'decrease' | 'hold' = 'hold';
  let reason = `On track (${w} kg/week): surplus unchanged.`;
  if (weekly < STALL_KG_PER_WEEK) {
    surplus = current + 150;
    decision = 'increase';
    reason = `Weight stalled (${w} kg/week): +150 kcal.`;
  } else if (weekly > TOO_FAST_KG_PER_WEEK) {
    surplus = current - 100;
    decision = 'decrease';
    reason = `Gaining fast (${w} kg/week): -100 kcal to limit fat gain.`;
  }
  return {
    surplus: clamp(surplus, SURPLUS_FLOOR, SURPLUS_CEILING),
    decision,
    weekly_change_kg: Math.round(weekly * 100) / 100,
    reason,
  };
}
