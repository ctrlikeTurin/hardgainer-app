// Week-1 templates (instant, no AI) and rules-based progression used when Gemini is unavailable.
import LIBRARY from '../shared/exercise-library.json';

export interface Exercise {
  id: string;
  name: string;
  sets: number;
  reps: string;
  rest_seconds: number;
  load_guidance: string;
  notes: string;
}
export interface Day {
  day: string;
  focus: string;
  exercises: Exercise[];
}
export interface Plan {
  days: Day[];
  coach_notes: string;
}

export const LIBRARY_BY_ID = new Map(LIBRARY.map((e) => [e.id, e]));
export const libraryFor = (env: string) => LIBRARY.filter((e) => e.envs.includes(env));

const ex = (id: string, sets: number, reps: string, rest: number, load: string, notes = ''): Exercise => {
  const lib = LIBRARY_BY_ID.get(id);
  if (!lib) throw new Error(`Unknown exercise ${id}`);
  return { id, name: lib.name, sets, reps, rest_seconds: rest, load_guidance: load, notes };
};

const HOME = 'Stop 1-2 reps before failure. Hit the top of the range on every set, then move to a harder variation.';
const UPPER = 'Use a weight you can lift for the top of the range with 2 reps left. Hit it on all sets, then add 2.5 kg.';
const LOWER = 'Use a weight you can lift for the top of the range with 2 reps left. Hit it on all sets, then add 5 kg.';

const HOME_PPL = (): Plan => ({
  days: [
    {
      day: 'Friday',
      focus: 'Push',
      exercises: [
        ex('push_up', 4, '8-15', 90, HOME, 'Too hard? Use incline push-ups on a table.'),
        ex('decline_push_up', 3, '6-12', 90, HOME),
        ex('chair_dip', 3, '8-15', 90, HOME),
        ex('close_push_up', 3, 'AMRAP', 60, HOME),
        ex('band_lateral_raise', 3, '12-20', 60, 'Use a band, water jugs or a loaded backpack; 3s lowering.'),
        ex('plank', 3, '30-45s', 45, 'Add 10s when every set feels solid.'),
      ],
    },
    {
      day: 'Saturday',
      focus: 'Pull',
      exercises: [
        ex('pull_up', 4, 'AMRAP', 120, HOME, "Can't do one yet? 5x3 slow negatives (jump up, lower for 5s)."),
        ex('inverted_row', 4, '8-12', 90, HOME, 'Only use a sturdy table.'),
        ex('backpack_row', 3, '10-15', 75, 'Add books to the backpack when 15 reps is easy.'),
        ex('reverse_fly', 3, '12-15', 45, 'Water bottles or a light backpack are enough.'),
        ex('hammer_curl', 3, '10-15', 60, 'Backpack or water jugs; slow 3s lowering.'),
        ex('superman', 3, '20-30s', 45, 'Add 5-10s each week.'),
      ],
    },
    {
      day: 'Sunday',
      focus: 'Legs',
      exercises: [
        ex('split_squat', 4, '8-12 / leg', 90, 'Hold a loaded backpack when 12 reps is easy.'),
        ex('goblet_squat', 4, '10-15', 90, '3s down, 1s pause at the bottom.'),
        ex('romanian_deadlift', 3, '10-12', 75, 'Hold a heavy backpack in both hands.'),
        ex('glute_bridge', 3, '12-20 / leg', 60, HOME),
        ex('walking_lunge', 3, '10 / leg', 75, HOME),
        ex('calf_raise_step', 4, '12-20', 45, 'Hold a wall for balance, not for help.'),
      ],
    },
  ],
  coach_notes:
    "Week 1: learn the movements and leave 1-2 reps in the tank. Eat your full calorie target on rest days too. That's where hardgainers usually fall short.",
});

const GYM_PPL = (): Plan => ({
  days: [
    {
      day: 'Monday',
      focus: 'Push',
      exercises: [
        ex('bench_press', 4, '6-8', 150, UPPER),
        ex('overhead_press', 3, '6-10', 120, UPPER),
        ex('incline_db_press', 3, '8-12', 90, UPPER),
        ex('machine_fly', 3, '10-15', 60, 'Add one plate/pin when 15 reps is easy.'),
        ex('lateral_raise', 3, '12-15', 60, 'Add 1-2 kg when 15 reps is easy.'),
        ex('triceps_pushdown', 3, '10-15', 60, 'Add one pin when 15 reps is easy.'),
      ],
    },
    {
      day: 'Wednesday',
      focus: 'Pull',
      exercises: [
        ex('barbell_row', 4, '6-8', 150, UPPER),
        ex('lat_pulldown', 4, '8-12', 90, UPPER),
        ex('cable_row', 3, '10-12', 90, 'Add one pin when 12 reps is easy.'),
        ex('face_pull', 3, '12-15', 60, 'Light and strict.'),
        ex('barbell_curl', 3, '8-12', 75, UPPER),
        ex('hammer_curl', 2, '10-12', 60, 'Add 1-2 kg when 12 reps is easy.'),
      ],
    },
    {
      day: 'Friday',
      focus: 'Legs',
      exercises: [
        ex('back_squat', 4, '5-8', 180, LOWER),
        ex('romanian_deadlift', 3, '6-10', 150, LOWER),
        ex('leg_press', 3, '10-12', 120, LOWER),
        ex('leg_curl', 3, '10-15', 60, 'Add one pin when 15 reps is easy.'),
        ex('db_lunge', 2, '10 / leg', 90, UPPER),
        ex('standing_calf_raise', 4, '10-15', 60, 'Full stretch, 1s pause at the top.'),
      ],
    },
  ],
  coach_notes:
    "Week 1: find working weights that leave 2 reps in reserve. Log every weight; progressive overload only works if you beat last week's numbers.",
});

export const templateFor = (env: string): Plan => (env === 'gym' ? GYM_PPL() : HOME_PPL());

const NOTES: Record<number, string> = {
  1: 'Training felt very easy, so the main lifts get an extra set this week.',
  2: 'Training felt easy, so the main lifts get an extra set this week.',
  3: 'Good effort level. Aim to add a rep or a little weight to every exercise.',
  4: 'Training felt hard. Keep the same volume and focus on sleep (8h) and hitting your protein.',
  5: 'Training felt very hard, so this is a deload week with fewer accessory sets. Recover and come back stronger.',
};

export function rulesProgression(previous: Plan, difficulty: number): Plan {
  const plan = structuredClone(previous);
  for (const day of plan.days) {
    day.exercises.forEach((e, i) => {
      if (difficulty <= 2 && i < 2) {
        e.sets = Math.min(e.sets + 1, 5);
        e.load_guidance = "Added a set. Keep the same load and beat last week's reps.";
      } else if (difficulty === 3) {
        e.load_guidance = 'Beat last week: +1 rep per set, or +2.5 kg if you hit the top of the range.';
      } else if (difficulty === 5 && i >= 2) {
        e.sets = Math.max(e.sets - 1, 2);
        e.load_guidance = 'Deload: one fewer set, same load, focus on form.';
      }
    });
  }
  plan.coach_notes = NOTES[difficulty];
  return plan;
}

export function sanitizeAiPlan(plan: Plan, previous: Plan, env: string): Plan {
  const days = (p: Plan) => (p.days ?? []).map((d) => d.day).join('|');
  if (days(plan) !== days(previous)) throw new Error('AI changed the training days');
  const allowed = new Set(libraryFor(env).map((e) => e.id));
  for (const day of plan.days) {
    day.exercises = (day.exercises ?? [])
      .filter((e) => allowed.has(e.id))
      .slice(0, 7)
      .map((e) => ({
        ...e,
        name: LIBRARY_BY_ID.get(e.id)!.name,
        sets: Math.min(Math.max(Math.round(Number(e.sets)) || 3, 1), 6),
        rest_seconds: Math.min(Math.max(Math.round(Number(e.rest_seconds)) || 90, 30), 300),
        notes: e.notes ?? '',
        load_guidance: e.load_guidance ?? '',
      }));
    if (day.exercises.length < 3) throw new Error('AI returned too few valid exercises');
  }
  return plan;
}
