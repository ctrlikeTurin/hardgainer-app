"""Gemini free-tier integration.

Free-tier tactics:
- Structured output (response_schema) so replies are short and always parseable: no retry-on-bad-JSON.
- thinking_level="minimal": Flash models "think" by default, which is slower and burns quota for no gain here.
- Model fallback chain: on 429/5xx the next model (separate free quota) is tried immediately.
- Images arrive pre-shrunk by the browser (~1024px JPEG), keeping image tokens and latency low.
"""

import json
import logging
from functools import lru_cache
from typing import TypeVar

import httpx
from google import genai
from google.genai import errors, types
from pydantic import BaseModel, ValidationError

from .config import settings

log = logging.getLogger(__name__)
T = TypeVar("T", bound=BaseModel)
RETRYABLE_CODES = {429, 500, 502, 503, 504}


class AIUnavailable(RuntimeError):
    pass


class FoodItem(BaseModel):
    name: str
    portion: str
    calories: float
    protein: float
    carbs: float
    fats: float


class FoodEstimate(BaseModel):
    is_food: bool
    description: str
    items: list[FoodItem]
    calories: float
    protein: float
    carbs: float
    fats: float
    confidence: str


class Exercise(BaseModel):
    name: str
    sets: int
    reps: str
    rest_seconds: int
    load_guidance: str
    notes: str


class WorkoutDay(BaseModel):
    day: str
    focus: str
    exercises: list[Exercise]


class WorkoutPlanAI(BaseModel):
    days: list[WorkoutDay]
    coach_notes: str


@lru_cache
def _client() -> genai.Client:
    if not settings.gemini_api_key:
        raise AIUnavailable("GEMINI_API_KEY is not configured")
    return genai.Client(
        api_key=settings.gemini_api_key,
        http_options=types.HttpOptions(
            timeout=settings.ai_timeout_seconds * 1000,
            base_url=settings.ai_gateway_url or None,
        ),
    )


def generate_structured(contents: list, schema: type[T], models: list[str], temperature: float) -> tuple[T, str]:
    config = types.GenerateContentConfig(
        response_mime_type="application/json",
        response_schema=schema,
        temperature=temperature,
        thinking_config=types.ThinkingConfig(thinking_level="minimal"),
    )
    last_error: Exception | None = None
    for model in models:
        try:
            resp = _client().models.generate_content(model=model, contents=contents, config=config)
        except errors.APIError as e:
            model_specific = e.code == 404 or (e.code == 400 and "thinking" in (e.message or "").lower())
            if e.code not in RETRYABLE_CODES and not model_specific:
                raise AIUnavailable(f"Gemini request failed: {e.message}") from e
            log.warning("Gemini %s returned %s; trying next model", model, e.code)
            last_error = e
            continue
        except httpx.TransportError as e:
            log.warning("Gemini %s transport error: %s; trying next model", model, e)
            last_error = e
            continue

        parsed = resp.parsed if isinstance(resp.parsed, schema) else None
        if parsed is None:
            try:
                parsed = schema.model_validate_json(resp.text or "")
            except ValidationError as e:
                log.warning("Gemini %s returned unparseable output; trying next model", model)
                last_error = e
                continue
        return parsed, model
    raise AIUnavailable("The free AI models are busy right now. Please try again in a minute.") from last_error


FOOD_PROMPT = """You are a sports nutritionist estimating macros from a meal photo.
1. Identify every distinct food and drink item.
2. Estimate each portion in grams (or ml) using visual cues: a dinner plate is ~26 cm, a fork ~19 cm, a fist ~1 cup.
3. Include hidden calories you can reasonably infer: cooking oil, butter, sauces, dressings, sugary drinks.
4. Use standard USDA-style nutrition values. Calories and grams of protein, carbs, fats per item.
5. Totals must equal the sum of the items.
6. confidence is "low", "medium" or "high".
If the image contains no food, set is_food=false, items=[] and all numbers to 0."""


def analyze_meal(image: bytes, mime_type: str, hint: str = "") -> tuple[FoodEstimate, str]:
    prompt = FOOD_PROMPT
    if hint.strip():
        prompt += f"\nThe user describes the meal as: {json.dumps(hint.strip())}. Use this to refine items and portions."
    estimate, model = generate_structured(
        [types.Part.from_bytes(data=image, mime_type=mime_type), prompt],
        FoodEstimate,
        settings.vision_models,
        temperature=0.2,
    )
    # Totals are recomputed from items so they're always self-consistent.
    if estimate.items:
        for field in ("calories", "protein", "carbs", "fats"):
            setattr(estimate, field, round(sum(max(getattr(i, field), 0) for i in estimate.items), 1))
    if estimate.confidence not in {"low", "medium", "high"}:
        estimate.confidence = "medium"
    return estimate, model


def progression_prompt(
    *,
    previous_plan: dict,
    environment: str,
    difficulty: int,
    notes: str,
    weekly_change_kg: float,
    week_number: int,
) -> str:
    feel = {1: "very easy", 2: "easy", 3: "about right", 4: "hard", 5: "very hard"}[difficulty]
    equipment = (
        "Commercial gym: barbells, dumbbells, cables and machines. Drive progressive overload mainly through load (kg)."
        if environment == "gym"
        else "Home: bodyweight/calisthenics plus minimal equipment (backpack loaded with books, chair, door frame, "
        "resistance band). Progress via reps, tempo, pauses, range of motion, and harder variations."
    )
    return f"""You are a strength coach programming week {week_number} for a "hardgainer" (lean beginner trying to build muscle).
Environment: {equipment}
Last week the user rated training as {feel} ({difficulty}/5). Bodyweight change: {weekly_change_kg:+.2f} kg/week.
User notes: {json.dumps(notes or "none")}

Last week's plan (JSON):
{json.dumps(previous_plan, separators=(",", ":"))}

Write next week's plan with these rules:
- Keep exactly the same training days, in the same order, with the same focus (Push/Pull/Legs).
- 1-2 (easy): clearly increase volume or intensity: +1 set on the main lifts, more reps, a harder variation, or more load.
- 3 (about right): small progressive overload: +1-2 reps per set or +2.5 kg on main lifts.
- 4 (hard): keep volume the same; small load/rep increases only on exercises the user can clearly handle.
- 5 (very hard): deload: cut 1 set from accessories, keep the main lifts.
- Max 7 exercises per day, 2-6 sets per exercise, compound lifts first.
- load_guidance: one concrete instruction (e.g. "Add 2.5 kg vs last week" or "Use the pause variation").
- coach_notes: 2-3 sentences explaining what changed and why, plus one recovery tip (sleep/protein)."""


def progress_workout(**kwargs) -> tuple[dict, str]:
    plan, model = generate_structured(
        [progression_prompt(**kwargs)], WorkoutPlanAI, settings.text_models, temperature=0.4
    )
    return plan.model_dump(), model
