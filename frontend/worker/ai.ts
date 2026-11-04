// Gemini free tier via REST (no SDK, keeps the Worker small).
// Structured JSON output + minimal thinking for speed; on 429/5xx falls through to the next model.

import type { Env } from './index';
import { libraryFor, type Plan } from './workouts';

export class AIUnavailable extends Error {}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const num = { type: 'NUMBER' };
const str = { type: 'STRING' };
const obj = (properties: Record<string, unknown>) => ({ type: 'OBJECT', properties, required: Object.keys(properties) });

const FOOD_SCHEMA = obj({
  is_food: { type: 'BOOLEAN' },
  description: str,
  items: { type: 'ARRAY', items: obj({ name: str, portion: str, calories: num, protein: num, carbs: num, fats: num }) },
  calories: num,
  protein: num,
  carbs: num,
  fats: num,
  confidence: { type: 'STRING', enum: ['low', 'medium', 'high'] },
});

// Exercises are restricted to the library so every one has photos and instructions in the app.
const planSchema = (env: string) =>
  obj({
    days: {
      type: 'ARRAY',
      items: obj({
        day: str,
        focus: str,
        exercises: {
          type: 'ARRAY',
          items: obj({
            id: { type: 'STRING', enum: libraryFor(env).map((e) => e.id) },
            sets: { type: 'INTEGER' },
            reps: str,
            rest_seconds: { type: 'INTEGER' },
            load_guidance: str,
            notes: str,
          }),
        },
      }),
    },
    coach_notes: str,
  });

async function generateJson<T>(env: Env, parts: unknown[], schema: unknown, models: string, temperature: number) {
  if (!env.GEMINI_API_KEY) throw new AIUnavailable('GEMINI_API_KEY is not configured');
  const base = (env.AI_GATEWAY_URL || 'https://generativelanguage.googleapis.com').replace(/\/$/, '');
  const body = JSON.stringify({
    contents: [{ role: 'user', parts }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: schema,
      temperature,
      thinkingConfig: { thinkingLevel: 'minimal' },
    },
  });

  for (const model of models.split(',').map((m) => m.trim()).filter(Boolean)) {
    let res: Response;
    try {
      res = await fetch(`${base}/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
        body,
        signal: AbortSignal.timeout(25_000),
      });
    } catch (e) {
      console.warn(`Gemini ${model} network error, trying next`, e);
      continue;
    }
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      // A 400/404 about thinking settings or a retired model is model-specific, so the next model may still work.
      const modelSpecific = (res.status === 400 && /thinking/i.test(detail)) || res.status === 404;
      if (RETRYABLE.has(res.status) || modelSpecific) {
        console.warn(`Gemini ${model} returned ${res.status}, trying next: ${detail}`);
        continue;
      }
      // Log the raw reply for debugging; users get a readable message instead of Google's JSON.
      console.error(`Gemini ${model} failed (${res.status}): ${detail}`);
      throw new AIUnavailable(
        res.status === 400 && /image/i.test(detail)
          ? "The AI couldn't read that photo. Try a clearer JPEG or PNG, or describe the meal instead."
          : 'The AI is unavailable right now. Try again in a minute, or add the meal manually.',
      );
    }
    try {
      const data: any = await res.json();
      const text: string = data.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? '').join('') ?? '';
      return { value: JSON.parse(text) as T, model };
    } catch {
      console.warn(`Gemini ${model} returned unparseable output, trying next`);
    }
  }
  throw new AIUnavailable('The free AI models are busy right now. Please try again in a minute.');
}

const FOOD_PROMPT = `You are a sports nutritionist estimating macros from a meal photo.
1. Identify every distinct food and drink item.
2. Estimate each portion in grams (or ml) using visual cues: a dinner plate is ~26 cm, a fork ~19 cm, a fist ~1 cup.
3. Include hidden calories you can reasonably infer: cooking oil, butter, sauces, dressings, sugary drinks.
4. Use standard USDA-style nutrition values. Calories and grams of protein, carbs, fats per item.
5. Totals must equal the sum of the items.
If the image contains no food, set is_food=false, items=[] and all numbers to 0.`;

export interface FoodItem { name: string; portion: string; calories: number; protein: number; carbs: number; fats: number }
export interface FoodEstimate {
  is_food: boolean; description: string; items: FoodItem[];
  calories: number; protein: number; carbs: number; fats: number; confidence: string;
}

function toBase64(buf: ArrayBuffer) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const TEXT_FOOD_PROMPT = `You are a sports nutritionist. Estimate the macros of the meal the user describes.
Split it into items, assume typical home portions when amounts are missing, include likely cooking oil or sauces.
Use standard USDA-style values. Totals must equal the sum of the items. confidence reflects how specific the description is.
If the text is not food, set is_food=false, items=[] and all numbers to 0.
Meal: `;

export async function analyzeMeal(env: Env, image: ArrayBuffer, mimeType: string, hint: string) {
  let prompt = FOOD_PROMPT;
  if (hint.trim()) prompt += `\nThe user describes the meal as: ${JSON.stringify(hint.trim())}. Use this to refine items and portions.`;
  const { value, model } = await generateJson<FoodEstimate>(
    env,
    [{ inline_data: { mime_type: mimeType, data: toBase64(image) } }, { text: prompt }],
    FOOD_SCHEMA,
    env.VISION_MODELS,
    0.2,
  );
  return { estimate: normalize(value), model };
}

// Text-only logging uses the lighter text models: faster and kinder to the free quota than vision.
export async function analyzeText(env: Env, text: string) {
  const { value, model } = await generateJson<FoodEstimate>(
    env,
    [{ text: TEXT_FOOD_PROMPT + JSON.stringify(text) }],
    FOOD_SCHEMA,
    env.TEXT_MODELS,
    0.2,
  );
  return { estimate: normalize(value), model };
}

function normalize(est: FoodEstimate): FoodEstimate {
  est.items = Array.isArray(est.items) ? est.items : [];
  if (est.items.length) {
    for (const f of ['calories', 'protein', 'carbs', 'fats'] as const) {
      est[f] = Math.round(est.items.reduce((s, i) => s + Math.max(Number(i[f]) || 0, 0), 0) * 10) / 10;
    }
  }
  if (!['low', 'medium', 'high'].includes(est.confidence)) est.confidence = 'medium';
  return est;
}

export function progressionPrompt(a: {
  previous: Plan; environment: string; difficulty: number; notes: string; weeklyChange: number; week: number;
}) {
  const feel = ['very easy', 'easy', 'about right', 'hard', 'very hard'][a.difficulty - 1];
  const equipment =
    a.environment === 'gym'
      ? 'Commercial gym: barbells, dumbbells, cables and machines. Drive progressive overload mainly through load (kg).'
      : 'Home: bodyweight/calisthenics plus minimal equipment (backpack loaded with books, chair, door frame, resistance band). Progress via reps, tempo, pauses, range of motion, and harder variations.';
  const change = (a.weeklyChange >= 0 ? '+' : '') + a.weeklyChange.toFixed(2);
  return `You are a strength coach programming week ${a.week} for a "hardgainer" (lean beginner trying to build muscle).
Environment: ${equipment}
Last week the user rated training as ${feel} (${a.difficulty}/5). Bodyweight change: ${change} kg/week.
User notes: ${JSON.stringify(a.notes || 'none')}

Last week's plan (JSON):
${JSON.stringify(a.previous)}

Allowed exercises (use only these ids):
${libraryFor(a.environment).map((e) => `${e.id}: ${e.name} [${e.primary.join(', ')}]`).join('\n')}

Write next week's plan with these rules:
- Keep exactly the same training days, in the same order, with the same focus (Push/Pull/Legs).
- Keep most exercises; swap at most one per day, and only for a harder or easier variation that fits the feedback.
- 1-2 (easy): clearly increase volume or intensity: +1 set on the main lifts, more reps, a harder variation, or more load.
- 3 (about right): small progressive overload: +1-2 reps per set or +2.5 kg on main lifts.
- 4 (hard): keep volume the same; small load/rep increases only on exercises the user can clearly handle.
- 5 (very hard): deload: cut 1 set from accessories, keep the main lifts.
- Max 7 exercises per day, 2-6 sets per exercise, compound lifts first.
- load_guidance: one concrete instruction (e.g. "Add 2.5 kg vs last week" or "Use the pause variation").
- coach_notes: 2-3 sentences explaining what changed and why, plus one recovery tip (sleep/protein).`;
}

export async function progressWorkout(env: Env, args: Parameters<typeof progressionPrompt>[0]) {
  const { value, model } = await generateJson<Plan>(env, [{ text: progressionPrompt(args) }], planSchema(args.environment), env.TEXT_MODELS, 0.4);
  return { plan: value, model };
}
