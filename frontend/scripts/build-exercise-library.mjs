// Builds shared/exercise-library.json and copies demo photos into public/exercises/.
// Source: https://github.com/yuhonas/free-exercise-db (Unlicense / public domain).
// Usage: node scripts/build-exercise-library.mjs path/to/free-exercise-db/dist/exercises.json
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataset = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const byId = Object.fromEntries(dataset.map((e) => [e.id, e]));
const IMG_BASE = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises';

// [id, datasetId, display name, environments, form cue]
const LIBRARY = [
  // Push
  ['push_up', 'Pushups', 'Push-up', 'home,gym', 'Body in one straight line, elbows at ~45°, chest to a fist above the floor.'],
  ['decline_push_up', 'Decline_Push-Up', 'Decline push-up (feet on a chair)', 'home', 'Feet up shifts work to upper chest and shoulders. Keep hips from sagging.'],
  ['incline_push_up', 'Incline_Push-Up', 'Incline push-up (hands on a table)', 'home', 'The easier push-up. Use it until you can do 3x12 regular push-ups.'],
  ['close_push_up', 'Pushups_Close_and_Wide_Hand_Positions', 'Close-grip push-up', 'home', 'Hands under shoulders, elbows brush your ribs: triceps focus.'],
  ['chair_dip', 'Bench_Dips', 'Chair dips', 'home', 'Shoulders down and back; lower until upper arms are parallel to the floor.'],
  ['band_lateral_raise', 'Lateral_Raise_-_With_Bands', 'Lateral raise (band or backpack)', 'home', 'Lead with the elbows, stop at shoulder height, lower for 3 seconds.'],
  ['bench_press', 'Barbell_Bench_Press_-_Medium_Grip', 'Barbell bench press', 'gym', 'Shoulder blades pinched, feet planted, touch mid-chest, press up and slightly back.'],
  ['overhead_press', 'Standing_Military_Press', 'Standing overhead press', 'gym', 'Squeeze glutes and abs, press straight up, head moves "through the window" at the top.'],
  ['incline_db_press', 'Incline_Dumbbell_Press', 'Incline dumbbell press', 'gym', 'Bench at 30°. Lower dumbbells to upper chest with elbows slightly tucked.'],
  ['machine_fly', 'Butterfly', 'Machine chest fly', 'gym', 'Slight bend in elbows, squeeze chest at the middle, slow return.'],
  ['db_fly', 'Dumbbell_Flyes', 'Dumbbell fly', 'gym', 'Wide arc, deep stretch without pain, hug a tree on the way up.'],
  ['lateral_raise', 'Side_Lateral_Raise', 'Dumbbell lateral raise', 'gym', 'Light weight, strict form. Raise to shoulder height, pinkies slightly up.'],
  ['triceps_pushdown', 'Triceps_Pushdown', 'Cable triceps pushdown', 'gym', 'Elbows pinned to your sides; only the forearms move.'],
  ['close_grip_bench', 'Close-Grip_Barbell_Bench_Press', 'Close-grip bench press', 'gym', 'Hands shoulder-width, elbows tucked, touch lower chest.'],
  ['dips', 'Dips_-_Triceps_Version', 'Parallel bar dips', 'home,gym', 'Stay upright for triceps; lower until shoulders are level with elbows.'],
  // Pull
  ['pull_up', 'Pullups', 'Pull-up', 'home,gym', 'Start from a dead hang, pull elbows down to your ribs, chin over the bar.'],
  ['chin_up', 'Chin-Up', 'Chin-up', 'home,gym', 'Palms facing you: more biceps, usually easier than pull-ups.'],
  ['assisted_pull_up', 'Band_Assisted_Pull-Up', 'Band-assisted pull-up', 'home,gym', 'Use the lightest band that lets you do 6+ clean reps.'],
  ['inverted_row', 'Inverted_Row', 'Inverted row (under a sturdy table)', 'home', 'Body rigid like a plank, pull chest to the edge, walk feet forward to make it harder.'],
  ['backpack_row', 'Bent_Over_Two-Dumbbell_Row', 'Bent-over row (backpack or dumbbells)', 'home,gym', 'Hinge to 45°, flat back, pull toward your hips, pause at the top.'],
  ['reverse_fly', 'Reverse_Flyes', 'Reverse fly', 'home,gym', 'Hinged over, arms slightly bent, squeeze shoulder blades together.'],
  ['hammer_curl', 'Hammer_Curls', 'Hammer curl', 'home,gym', 'Palms face each other, elbows still, lower slowly.'],
  ['superman', 'Superman', 'Superman hold', 'home', 'Lift arms and legs together, squeeze glutes, hold without straining your neck.'],
  ['barbell_row', 'Bent_Over_Barbell_Row', 'Barbell row', 'gym', 'Hinge to ~45°, bar to lower ribs, no jerking with the hips.'],
  ['lat_pulldown', 'Wide-Grip_Lat_Pulldown', 'Lat pulldown', 'gym', 'Chest up, pull the bar to upper chest, control it back up.'],
  ['cable_row', 'Seated_Cable_Rows', 'Seated cable row', 'gym', 'Sit tall, pull handle to your belly button, squeeze shoulder blades.'],
  ['face_pull', 'Face_Pull', 'Face pull', 'gym', 'Rope at face height, pull to your forehead with elbows high and wide.'],
  ['barbell_curl', 'Barbell_Curl', 'Barbell curl', 'gym', 'Elbows by your sides, no swinging, full range of motion.'],
  ['deadlift', 'Barbell_Deadlift', 'Deadlift', 'gym', 'Bar over mid-foot, flat back, push the floor away, lock hips and knees together.'],
  // Legs
  ['split_squat', 'Split_Squats', 'Bulgarian split squat', 'home,gym', 'Rear foot on a chair, front knee tracks over toes, drop the back knee straight down.'],
  ['goblet_squat', 'Goblet_Squat', 'Goblet squat (backpack or dumbbell)', 'home,gym', 'Hold the weight at your chest, sit between your heels, chest up.'],
  ['bodyweight_squat', 'Bodyweight_Squat', 'Bodyweight squat', 'home', 'Hips back and down, knees out, full depth with heels flat.'],
  ['glute_bridge', 'Single_Leg_Glute_Bridge', 'Single-leg glute bridge', 'home', 'Drive through the heel, squeeze the glute at the top for 1 second.'],
  ['walking_lunge', 'Bodyweight_Walking_Lunge', 'Walking lunge', 'home', 'Long steps, back knee kisses the floor, push through the front heel.'],
  ['romanian_deadlift', 'Romanian_Deadlift', 'Romanian deadlift', 'home,gym', 'Soft knees, push hips back until you feel a hamstring stretch, flat back.'],
  ['calf_raise_step', 'Calf_Raise_On_A_Dumbbell', 'Single-leg calf raise (on a step)', 'home', 'Full stretch at the bottom, 1-second squeeze at the top.'],
  ['back_squat', 'Barbell_Squat', 'Barbell back squat', 'gym', 'Brace hard, break at hips and knees together, hit at least parallel.'],
  ['leg_press', 'Leg_Press', 'Leg press', 'gym', 'Feet shoulder-width, lower until knees reach ~90°, never lock out hard.'],
  ['leg_curl', 'Lying_Leg_Curls', 'Lying leg curl', 'gym', 'Hips pressed into the pad, curl fully, lower slowly.'],
  ['db_lunge', 'Dumbbell_Lunges', 'Dumbbell lunge', 'gym', 'Upright torso, both knees to ~90°, push back through the front heel.'],
  ['standing_calf_raise', 'Standing_Calf_Raises', 'Standing calf raise', 'gym', 'Full stretch, pause at the top, no bouncing.'],
  ['hip_thrust', 'Barbell_Hip_Thrust', 'Barbell hip thrust', 'gym', 'Upper back on the bench, chin tucked, lock out by squeezing glutes.'],
  // Core
  ['plank', 'Plank', 'Plank', 'home,gym', 'Elbows under shoulders, squeeze glutes and abs, breathe normally.'],
  ['hanging_leg_raise', 'Hanging_Leg_Raise', 'Hanging leg raise', 'home,gym', 'No swinging. Curl your pelvis up, not just your legs.'],
  ['cable_crunch', 'Cable_Crunch', 'Cable crunch', 'gym', 'Hips still, curl your ribs toward your pelvis.'],
];

async function download(url, attempts = 5) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`${url}: ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      if (i >= attempts) throw e;
      await new Promise((r) => setTimeout(r, 1000 * i));
    }
  }
}

const out = [];
for (const [id, src, name, envs, cue] of LIBRARY) {
  const e = byId[src];
  if (!e) throw new Error(`Missing dataset exercise ${src}`);
  const dir = join(root, 'public', 'exercises', id);
  mkdirSync(dir, { recursive: true });
  const images = [];
  for (const [i, img] of e.images.slice(0, 2).entries()) {
    const file = join(dir, `${i}.jpg`);
    if (!existsSync(file)) {
      writeFileSync(file, await download(`${IMG_BASE}/${img}`));
    }
    images.push(`/exercises/${id}/${i}.jpg`);
  }
  out.push({
    id,
    name,
    envs: envs.split(','),
    primary: e.primaryMuscles,
    secondary: e.secondaryMuscles,
    level: e.level,
    cue,
    steps: e.instructions,
    images,
  });
}

mkdirSync(join(root, 'shared'), { recursive: true });
writeFileSync(join(root, 'shared', 'exercise-library.json'), JSON.stringify(out, null, 1));
console.log(`Wrote ${out.length} exercises`);
