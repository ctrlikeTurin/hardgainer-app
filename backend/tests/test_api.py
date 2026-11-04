from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import ai
from app.auth import AuthUser, require_auth
from app.db import Base, engine
from app.main import app

TODAY = datetime.now(timezone.utc).date().isoformat()


@pytest.fixture()
def client():
    Base.metadata.drop_all(engine)
    app.dependency_overrides[require_auth] = lambda: AuthUser(id="user-1", email="a@b.co")
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()
    engine.dispose()
    Path("test_hardgainer.db").unlink(missing_ok=True)


def onboard(client, environment="home"):
    return client.post("/me/onboarding", json={
        "age": 22, "sex": "male", "height_cm": 178, "weight_kg": 60, "target_weight_kg": 70,
        "activity_level": "moderate", "environment": environment, "date": TODAY,
    })


def test_requires_auth():
    with TestClient(app) as c:
        assert c.get(f"/me/dashboard?date={TODAY}").status_code == 401


def test_onboarding_builds_plan_and_home_ppl(client):
    assert client.get(f"/me/dashboard?date={TODAY}").json() == {"profile": None}
    r = onboard(client)
    assert r.status_code == 200
    body = r.json()
    assert body["goal"]["surplus"] == 400
    assert [d["day"] for d in body["workout"]["plan"]["days"]] == ["Friday", "Saturday", "Sunday"]
    assert body["workout"]["source"] == "template"


def test_target_must_exceed_current(client):
    r = client.post("/me/onboarding", json={
        "age": 22, "sex": "male", "height_cm": 178, "weight_kg": 70, "target_weight_kg": 65,
        "activity_level": "moderate", "environment": "gym", "date": TODAY,
    })
    assert r.status_code == 422


def test_food_scan_updates_remaining(client, monkeypatch):
    onboard(client)
    fake = ai.FoodEstimate(
        is_food=True, description="Rice and chicken", confidence="high",
        items=[ai.FoodItem(name="Rice", portion="200 g", calories=260, protein=5, carbs=56, fats=1),
               ai.FoodItem(name="Chicken", portion="150 g", calories=250, protein=46, carbs=0, fats=6)],
        calories=510, protein=51, carbs=56, fats=7,
    )
    monkeypatch.setattr(ai, "analyze_meal", lambda *a, **k: (fake, "gemini-2.5-flash"))
    r = client.post("/food/scan", data={"log_date": TODAY}, files={"image": ("m.jpg", b"x", "image/jpeg")})
    assert r.status_code == 200
    today = r.json()["today"]
    assert today["consumed"]["calories"] == 510
    assert today["remaining"]["calories"] == today["targets"]["calories"] - 510

    log_id = r.json()["log"]["id"]
    assert client.delete(f"/food/logs/{log_id}").json()["today"]["consumed"]["calories"] == 0


def test_food_scan_without_ai_key_returns_503(client):
    onboard(client)
    r = client.post("/food/scan", data={"log_date": TODAY}, files={"image": ("m.jpg", b"x", "image/jpeg")})
    assert r.status_code == 503


def test_checkin_stall_raises_calories_and_falls_back_to_rules(client):
    onboard(client, "gym")
    before = client.get(f"/me/dashboard?date={TODAY}").json()
    r = client.post("/checkins", json={"weight_kg": 60, "difficulty": 2, "notes": "", "date": TODAY})
    assert r.status_code == 200
    result = r.json()["result"]
    assert result["decision"] == "increase"
    assert result["calories_after"] == before["goal"]["calories"] + 150
    assert result["workout_source"] == "rules"
    after = r.json()["dashboard"]["workout"]
    assert after["week_number"] == 2
    first_before = before["workout"]["plan"]["days"][0]["exercises"][0]["sets"]
    assert after["plan"]["days"][0]["exercises"][0]["sets"] == first_before + 1
