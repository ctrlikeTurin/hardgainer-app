"""Deterministic nutrition math. No AI calls here: it's instant and costs nothing."""

import calendar
import math
from dataclasses import asdict, dataclass
from datetime import date, timedelta
from typing import Literal

Sex = Literal["male", "female"]
Activity = Literal["sedentary", "light", "moderate", "active", "very_active"]

ACTIVITY_MULTIPLIERS: dict[str, float] = {
    "sedentary": 1.2,
    "light": 1.375,
    "moderate": 1.55,
    "active": 1.725,
    "very_active": 1.9,
}
# Hardgainers with higher activity burn more, so they start nearer the top of the 300-500 range.
INITIAL_SURPLUS: dict[str, int] = {
    "sedentary": 300,
    "light": 350,
    "moderate": 400,
    "active": 450,
    "very_active": 500,
}
KCAL_PER_KG = 7700
MIN_WEEKLY_RATE, MAX_WEEKLY_RATE = 0.25, 0.5
PROTEIN_G_PER_KG = 2.0  # midpoint of 1.8-2.2
FAT_CALORIE_SHARE = 0.25
FAT_MIN_G_PER_KG = 0.8

STALL_THRESHOLD_KG_PER_WEEK = 0.1
TOO_FAST_KG_PER_WEEK = 0.6
STALL_INCREASE = 150
TOO_FAST_DECREASE = 100
SURPLUS_FLOOR, SURPLUS_CEILING = 250, 1200


@dataclass(frozen=True)
class Macros:
    protein_g: int
    carbs_g: int
    fat_g: int


@dataclass(frozen=True)
class Timeline:
    weekly_rate_kg: float
    week_goal_kg: float
    week_goal_date: date
    month_goal_kg: float
    month_goal_date: date
    target_date: date


@dataclass(frozen=True)
class Plan:
    bmr: int
    tdee: int
    surplus: int
    calories: int
    macros: Macros
    timeline: Timeline

    def as_dict(self) -> dict:
        return asdict(self)


@dataclass(frozen=True)
class SurplusAdjustment:
    surplus: int
    decision: Literal["increase", "decrease", "hold"]
    weekly_change_kg: float
    reason: str


def bmr_mifflin_st_jeor(sex: Sex, weight_kg: float, height_cm: float, age: int) -> float:
    base = 10 * weight_kg + 6.25 * height_cm - 5 * age
    return base + 5 if sex == "male" else base - 161


def tdee(bmr: float, activity: Activity) -> float:
    return bmr * ACTIVITY_MULTIPLIERS[activity]


def macros_for(calories: float, weight_kg: float) -> Macros:
    protein = weight_kg * PROTEIN_G_PER_KG
    fat = max(calories * FAT_CALORIE_SHARE / 9, weight_kg * FAT_MIN_G_PER_KG)
    carbs = max((calories - protein * 4 - fat * 9) / 4, 0)
    return Macros(round(protein), round(carbs), round(fat))


def weekly_gain_rate(surplus: int) -> float:
    rate = surplus * 7 / KCAL_PER_KG
    return round(min(max(rate, MIN_WEEKLY_RATE), MAX_WEEKLY_RATE), 3)


def _end_of_month(d: date) -> date:
    return d.replace(day=calendar.monthrange(d.year, d.month)[1])


def timeline(current_kg: float, target_kg: float, weekly_rate_kg: float, today: date) -> Timeline:
    daily = weekly_rate_kg / 7

    def projected(on: date) -> float:
        return round(min(current_kg + daily * (on - today).days, target_kg), 1)

    days_to_sunday = 6 - today.weekday()
    week_end = today + timedelta(days=days_to_sunday or 7)

    month_end = _end_of_month(today)
    if (month_end - today).days < 7:
        month_end = _end_of_month(month_end + timedelta(days=1))

    gap = max(target_kg - current_kg, 0)
    target_date = today + timedelta(days=math.ceil(gap / daily)) if gap else today

    return Timeline(
        weekly_rate_kg=weekly_rate_kg,
        week_goal_kg=projected(week_end),
        week_goal_date=week_end,
        month_goal_kg=projected(month_end),
        month_goal_date=month_end,
        target_date=target_date,
    )


def build_plan(
    *,
    sex: Sex,
    age: int,
    height_cm: float,
    weight_kg: float,
    target_weight_kg: float,
    activity: Activity,
    today: date,
    surplus: int | None = None,
) -> Plan:
    bmr = bmr_mifflin_st_jeor(sex, weight_kg, height_cm, age)
    maintenance = tdee(bmr, activity)
    surplus = INITIAL_SURPLUS[activity] if surplus is None else surplus
    calories = round(maintenance + surplus)
    return Plan(
        bmr=round(bmr),
        tdee=round(maintenance),
        surplus=surplus,
        calories=calories,
        macros=macros_for(calories, weight_kg),
        timeline=timeline(weight_kg, target_weight_kg, weekly_gain_rate(surplus), today),
    )


def adjust_surplus(current_surplus: int, weight_change_kg: float, days_elapsed: int) -> SurplusAdjustment:
    weekly = weight_change_kg * 7 / max(days_elapsed, 1)
    if weekly < STALL_THRESHOLD_KG_PER_WEEK:
        new, decision = current_surplus + STALL_INCREASE, "increase"
        reason = f"Weight stalled ({weekly:+.2f} kg/week): +{STALL_INCREASE} kcal."
    elif weekly > TOO_FAST_KG_PER_WEEK:
        new, decision = current_surplus - TOO_FAST_DECREASE, "decrease"
        reason = f"Gaining fast ({weekly:+.2f} kg/week): -{TOO_FAST_DECREASE} kcal to limit fat gain."
    else:
        new, decision = current_surplus, "hold"
        reason = f"On track ({weekly:+.2f} kg/week): surplus unchanged."
    new = min(max(new, SURPLUS_FLOOR), SURPLUS_CEILING)
    return SurplusAdjustment(new, decision, round(weekly, 2), reason)
