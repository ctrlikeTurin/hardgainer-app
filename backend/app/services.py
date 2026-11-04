import logging
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import ai, fitness_math, workouts
from .config import settings
from .db import CheckIn, FoodLog, Goal, User, Workout

log = logging.getLogger(__name__)
MACRO_FIELDS = ("calories", "protein", "carbs", "fats")


def latest(db: Session, model, user_id: str):
    return db.scalars(select(model).where(model.user_id == user_id).order_by(model.id.desc()).limit(1)).first()


def create_goal(db: Session, user: User, today: date, surplus: int | None, reason: str) -> Goal:
    plan = fitness_math.build_plan(
        sex=user.sex,
        age=user.age,
        height_cm=user.height_cm,
        weight_kg=user.weight_kg,
        target_weight_kg=user.target_weight_kg,
        activity=user.activity_level,
        today=today,
        surplus=surplus,
    )
    t = plan.timeline
    goal = Goal(
        user_id=user.id,
        created_on=today,
        bmr=plan.bmr,
        tdee=plan.tdee,
        surplus=plan.surplus,
        calories=plan.calories,
        protein_g=plan.macros.protein_g,
        carbs_g=plan.macros.carbs_g,
        fat_g=plan.macros.fat_g,
        weekly_rate_kg=t.weekly_rate_kg,
        week_goal_kg=t.week_goal_kg,
        week_goal_date=t.week_goal_date,
        month_goal_kg=t.month_goal_kg,
        month_goal_date=t.month_goal_date,
        target_date=t.target_date,
        reason=reason,
    )
    db.add(goal)
    return goal


def onboard(db: Session, user: User, data) -> None:
    user.age = data.age
    user.sex = data.sex
    user.height_cm = data.height_cm
    user.start_weight_kg = data.weight_kg
    user.weight_kg = data.weight_kg
    user.target_weight_kg = data.target_weight_kg
    user.activity_level = data.activity_level
    user.environment = data.environment
    user.onboarded_on = data.date
    create_goal(db, user, data.date, None, "Initial plan")
    db.add(
        Workout(
            user_id=user.id,
            week_number=1,
            environment=data.environment,
            plan=workouts.template_for(data.environment),
            source="template",
        )
    )
    db.commit()


def day_summary(db: Session, user: User, goal: Goal, day: date) -> dict:
    logs = db.scalars(
        select(FoodLog).where(FoodLog.user_id == user.id, FoodLog.log_date == day).order_by(FoodLog.id)
    ).all()
    consumed = {f: round(sum(getattr(l, f) for l in logs), 1) for f in MACRO_FIELDS}
    targets = {"calories": goal.calories, "protein": goal.protein_g, "carbs": goal.carbs_g, "fats": goal.fat_g}
    return {
        "date": day.isoformat(),
        "targets": targets,
        "consumed": consumed,
        "remaining": {f: round(targets[f] - consumed[f], 1) for f in MACRO_FIELDS},
        "logs": [food_log_out(l) for l in logs],
    }


def food_log_out(l: FoodLog) -> dict:
    return {
        "id": l.id,
        "description": l.description,
        "items": l.items,
        "calories": l.calories,
        "protein": l.protein,
        "carbs": l.carbs,
        "fats": l.fats,
        "confidence": l.confidence,
    }


def goal_out(g: Goal) -> dict:
    return {
        "bmr": g.bmr,
        "tdee": g.tdee,
        "surplus": g.surplus,
        "calories": g.calories,
        "protein_g": g.protein_g,
        "carbs_g": g.carbs_g,
        "fat_g": g.fat_g,
        "weekly_rate_kg": g.weekly_rate_kg,
        "week_goal": {"weight_kg": g.week_goal_kg, "date": g.week_goal_date.isoformat()},
        "month_goal": {"weight_kg": g.month_goal_kg, "date": g.month_goal_date.isoformat()},
        "target_date": g.target_date.isoformat(),
        "reason": g.reason,
    }


def last_checkin_date(db: Session, user: User) -> date:
    last = latest(db, CheckIn, user.id)
    return last.checkin_date if last else user.onboarded_on


def dashboard(db: Session, user: User, day: date) -> dict:
    if user.onboarded_on is None:
        return {"profile": None}
    goal = latest(db, Goal, user.id)
    workout = latest(db, Workout, user.id)
    next_checkin = last_checkin_date(db, user) + timedelta(days=7)
    return {
        "profile": {
            "email": user.email,
            "age": user.age,
            "sex": user.sex,
            "height_cm": user.height_cm,
            "start_weight_kg": user.start_weight_kg,
            "weight_kg": user.weight_kg,
            "target_weight_kg": user.target_weight_kg,
            "activity_level": user.activity_level,
            "environment": user.environment,
        },
        "goal": goal_out(goal),
        "today": day_summary(db, user, goal, day),
        "workout": {"week_number": workout.week_number, "source": workout.source, "plan": workout.plan},
        "checkin": {"due": day >= next_checkin, "next_date": next_checkin.isoformat()},
    }


def save_food_log(db: Session, user: User, day: date, estimate: ai.FoodEstimate, model: str) -> FoodLog:
    entry = FoodLog(
        user_id=user.id,
        log_date=day,
        description=estimate.description[:500],
        items=[i.model_dump() for i in estimate.items],
        calories=estimate.calories,
        protein=estimate.protein,
        carbs=estimate.carbs,
        fats=estimate.fats,
        confidence=estimate.confidence,
        model=model,
    )
    db.add(entry)
    db.commit()
    return entry


def next_workout(previous: Workout, difficulty: int, notes: str, weekly_change_kg: float) -> tuple[dict, str]:
    try:
        plan, model = ai.progress_workout(
            previous_plan=previous.plan,
            environment=previous.environment,
            difficulty=difficulty,
            notes=notes,
            weekly_change_kg=weekly_change_kg,
            week_number=previous.week_number + 1,
        )
        return workouts.sanitize_ai_plan(plan, previous.plan), model
    except (ai.AIUnavailable, ValueError, KeyError, TypeError) as e:
        log.warning("Falling back to rules-based progression: %s", e)
        return workouts.rules_progression(previous.plan, difficulty), "rules"


class CheckInTooEarly(Exception):
    def __init__(self, next_date: date):
        self.next_date = next_date


def process_checkin(db: Session, user: User, data) -> dict:
    prev_date = last_checkin_date(db, user)
    days = (data.date - prev_date).days
    if days < settings.checkin_min_days:
        raise CheckInTooEarly(prev_date + timedelta(days=settings.checkin_min_days))

    prev_weight = user.weight_kg
    goal = latest(db, Goal, user.id)
    adj = fitness_math.adjust_surplus(goal.surplus, data.weight_kg - prev_weight, days)

    user.weight_kg = data.weight_kg
    new_goal = create_goal(db, user, data.date, adj.surplus, adj.reason)

    prev_workout = latest(db, Workout, user.id)
    plan, source = next_workout(prev_workout, data.difficulty, data.notes, adj.weekly_change_kg)
    db.add(
        Workout(
            user_id=user.id,
            week_number=prev_workout.week_number + 1,
            environment=prev_workout.environment,
            plan=plan,
            source=source,
        )
    )
    db.add(
        CheckIn(
            user_id=user.id,
            checkin_date=data.date,
            weight_kg=data.weight_kg,
            previous_weight_kg=prev_weight,
            days_elapsed=days,
            difficulty=data.difficulty,
            notes=data.notes,
            surplus_before=goal.surplus,
            surplus_after=adj.surplus,
            decision=adj.decision,
        )
    )
    db.commit()
    return {
        "decision": adj.decision,
        "reason": adj.reason,
        "weekly_change_kg": adj.weekly_change_kg,
        "calories_before": goal.calories,
        "calories_after": new_goal.calories,
        "goal_reached": data.weight_kg >= user.target_weight_kg,
        "workout_source": source,
    }
