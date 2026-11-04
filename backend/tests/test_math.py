from datetime import date

from app import fitness_math as fm


def test_mifflin_st_jeor_male_and_female():
    assert fm.bmr_mifflin_st_jeor("male", 60, 178, 22) == 10 * 60 + 6.25 * 178 - 5 * 22 + 5
    assert fm.bmr_mifflin_st_jeor("female", 50, 165, 25) == 10 * 50 + 6.25 * 165 - 5 * 25 - 161


def test_plan_surplus_macros_and_rate():
    plan = fm.build_plan(
        sex="male", age=22, height_cm=178, weight_kg=60, target_weight_kg=70,
        activity="moderate", today=date(2026, 11, 3),
    )
    assert plan.surplus == 400
    assert abs(plan.calories - (plan.tdee + 400)) <= 1
    assert 1.8 * 60 <= plan.macros.protein_g <= 2.2 * 60
    kcal = plan.macros.protein_g * 4 + plan.macros.carbs_g * 4 + plan.macros.fat_g * 9
    assert abs(kcal - plan.calories) < 15
    assert 0.25 <= plan.timeline.weekly_rate_kg <= 0.5


def test_timeline_milestones():
    t = fm.timeline(60, 70, 0.35, date(2026, 11, 3))  # Tuesday
    assert t.week_goal_date == date(2026, 11, 8)  # Sunday
    assert t.month_goal_date == date(2026, 11, 30)
    assert 60 < t.week_goal_kg < t.month_goal_kg < 70
    assert (t.target_date - date(2026, 11, 3)).days in (200, 201)  # 10 kg at 0.05 kg/day


def test_timeline_rolls_short_month_and_sunday():
    t = fm.timeline(60, 70, 0.35, date(2026, 11, 29))  # Sunday, 1 day before month end
    assert t.week_goal_date == date(2026, 12, 6)
    assert t.month_goal_date == date(2026, 12, 31)


def test_adjust_surplus():
    assert fm.adjust_surplus(400, 0.0, 7).surplus == 550
    assert fm.adjust_surplus(400, -0.3, 7).decision == "increase"
    assert fm.adjust_surplus(400, 0.3, 7).decision == "hold"
    assert fm.adjust_surplus(400, 1.0, 7).surplus == 300
    assert fm.adjust_surplus(1150, 0, 7).surplus == fm.SURPLUS_CEILING
