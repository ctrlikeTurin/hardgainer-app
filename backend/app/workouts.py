"""Week-1 templates (instant, zero AI cost) and a rules-based progression used when the AI is unavailable."""

import copy


def _ex(name: str, sets: int, reps: str, rest: int, load: str, notes: str = "") -> dict:
    return {"name": name, "sets": sets, "reps": reps, "rest_seconds": rest, "load_guidance": load, "notes": notes}


_HOME_LOAD = "Stop 1-2 reps before failure. When you hit the top of the range on every set, move to a harder variation."
_GYM_UPPER = "Pick a weight you can lift for the top of the range with 2 reps left. Hit the top on all sets, then add 2.5 kg."
_GYM_LOWER = "Pick a weight you can lift for the top of the range with 2 reps left. Hit the top on all sets, then add 5 kg."

HOME_PPL = {
    "days": [
        {
            "day": "Friday",
            "focus": "Push",
            "exercises": [
                _ex("Push-ups (feet elevated when 15+ is easy)", 4, "8-15", 90, _HOME_LOAD),
                _ex("Pike push-ups", 3, "6-12", 90, _HOME_LOAD, "Hips high, head travels in front of hands."),
                _ex("Chair dips", 3, "8-15", 90, _HOME_LOAD),
                _ex("Diamond push-ups", 3, "AMRAP", 60, _HOME_LOAD),
                _ex("Backpack lateral raises", 3, "12-20", 60, "Load a backpack or water jugs; slow 3s lowering."),
                _ex("Plank", 3, "30-45s", 45, "Add 10s when every set feels solid."),
            ],
        },
        {
            "day": "Saturday",
            "focus": "Pull",
            "exercises": [
                _ex("Pull-ups (or 5x3 slow negatives)", 4, "AMRAP", 120, _HOME_LOAD, "Use a sturdy doorframe bar."),
                _ex("Table inverted rows", 4, "8-12", 90, _HOME_LOAD, "Sturdy table only; walk feet forward to make it harder."),
                _ex("Backpack bent-over rows", 3, "10-15", 75, "Add books to the backpack when 15 reps is easy."),
                _ex("Reverse snow angels", 3, "12-15", 45, "Lying face down, squeeze shoulder blades."),
                _ex("Backpack biceps curls", 3, "10-15", 60, "Slow 3s lowering."),
                _ex("Superman hold", 3, "20-30s", 45, "Add 5-10s per week."),
            ],
        },
        {
            "day": "Sunday",
            "focus": "Legs",
            "exercises": [
                _ex("Bulgarian split squats", 4, "8-12 / leg", 90, "Hold a loaded backpack when 12 reps is easy."),
                _ex("Backpack goblet squats", 4, "10-15", 90, "3s down, 1s pause at the bottom."),
                _ex("Single-leg Romanian deadlifts", 3, "8-12 / leg", 75, _HOME_LOAD),
                _ex("Single-leg glute bridges", 3, "12-20 / leg", 60, _HOME_LOAD),
                _ex("Walking lunges", 3, "10 / leg", 75, _HOME_LOAD),
                _ex("Single-leg calf raises (on a step)", 4, "12-20", 45, "Full stretch at the bottom, 1s squeeze at the top."),
            ],
        },
    ],
    "coach_notes": "Week 1: learn the movements and leave 1-2 reps in the tank. Eat your full calorie target, including "
    "on rest days. That's where hardgainers usually fall short.",
}

GYM_PPL = {
    "days": [
        {
            "day": "Monday",
            "focus": "Push",
            "exercises": [
                _ex("Barbell bench press", 4, "6-8", 150, _GYM_UPPER),
                _ex("Standing overhead press", 3, "6-10", 120, _GYM_UPPER),
                _ex("Incline dumbbell press", 3, "8-12", 90, _GYM_UPPER),
                _ex("Machine or cable chest fly", 3, "10-15", 60, "Add one plate/pin when 15 reps is easy."),
                _ex("Dumbbell lateral raises", 3, "12-15", 60, "Add 1-2 kg when 15 reps is easy."),
                _ex("Cable triceps pushdown", 3, "10-15", 60, "Add one pin when 15 reps is easy."),
            ],
        },
        {
            "day": "Wednesday",
            "focus": "Pull",
            "exercises": [
                _ex("Barbell row", 4, "6-8", 150, _GYM_UPPER),
                _ex("Lat pulldown (or weighted pull-ups)", 4, "8-12", 90, _GYM_UPPER),
                _ex("Seated cable row", 3, "10-12", 90, "Add one pin when 12 reps is easy."),
                _ex("Face pulls", 3, "12-15", 60, "Elbows high, pull to the forehead."),
                _ex("Barbell curl", 3, "8-12", 75, _GYM_UPPER),
                _ex("Hammer curl", 2, "10-12", 60, "Add 1-2 kg when 12 reps is easy."),
            ],
        },
        {
            "day": "Friday",
            "focus": "Legs",
            "exercises": [
                _ex("Back squat", 4, "5-8", 180, _GYM_LOWER),
                _ex("Romanian deadlift", 3, "6-10", 150, _GYM_LOWER),
                _ex("Leg press", 3, "10-12", 120, _GYM_LOWER),
                _ex("Lying leg curl", 3, "10-15", 60, "Add one pin when 15 reps is easy."),
                _ex("Walking lunges (dumbbells)", 2, "10 / leg", 90, _GYM_UPPER),
                _ex("Standing calf raise", 4, "10-15", 60, "Full stretch, 1s pause at the top."),
            ],
        },
    ],
    "coach_notes": "Week 1: find working weights that leave 2 reps in reserve. Log every weight, because progressive "
    "overload only works if you beat last week's numbers.",
}


def template_for(environment: str) -> dict:
    return copy.deepcopy(GYM_PPL if environment == "gym" else HOME_PPL)


def rules_progression(previous: dict, difficulty: int) -> dict:
    plan = copy.deepcopy(previous)
    for day in plan["days"]:
        for i, ex in enumerate(day["exercises"]):
            if difficulty <= 2 and i < 2:
                ex["sets"] = min(ex["sets"] + 1, 5)
                ex["load_guidance"] = "Added a set. Keep the same load and beat last week's reps."
            elif difficulty == 3:
                ex["load_guidance"] = "Beat last week: +1 rep per set, or +2.5 kg if you hit the top of the range."
            elif difficulty == 5 and i >= 2:
                ex["sets"] = max(ex["sets"] - 1, 2)
                ex["load_guidance"] = "Deload: one fewer set, same load, focus on form."
    plan["coach_notes"] = {
        1: "Training felt very easy, so the main lifts get an extra set this week.",
        2: "Training felt easy, so the main lifts get an extra set this week.",
        3: "Good effort level. Aim to add a rep or a little weight to every exercise.",
        4: "Training felt hard. Keep the same volume and focus on sleep (8h) and hitting your protein.",
        5: "Training felt very hard, so this is a deload week with fewer accessory sets. Recover and come back stronger.",
    }[difficulty]
    return plan


def sanitize_ai_plan(plan: dict, previous: dict) -> dict:
    """Reject AI output that drifts from the user's schedule; clamp numbers to safe ranges."""
    if [d["day"] for d in plan.get("days", [])] != [d["day"] for d in previous["days"]]:
        raise ValueError("AI changed the training days")
    for day in plan["days"]:
        if not day["exercises"]:
            raise ValueError("AI returned an empty day")
        day["exercises"] = day["exercises"][:7]
        for ex in day["exercises"]:
            ex["sets"] = min(max(int(ex["sets"]), 1), 6)
            ex["rest_seconds"] = min(max(int(ex["rest_seconds"]), 30), 300)
    return plan
