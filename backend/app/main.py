import threading
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from datetime import date, datetime, timezone

from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from sqlalchemy.orm import Session

from . import ai, services
from .auth import AuthUser, require_auth
from .config import settings
from .db import FoodLog, Goal, User, get_db, init_db
from .schemas import CheckInIn, OnboardingIn

ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"}


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(title="Hardgainer API", lifespan=lifespan)
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.frontend_origins,
    allow_methods=["*"],
    allow_headers=["Authorization", "Content-Type"],
)


class RateLimiter:
    """In-process sliding window: protects the shared free Gemini quota from one user. Use Redis if you run >1 worker."""

    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def check(self, key: str, limit: int, window_s: float = 60) -> None:
        now = time.monotonic()
        with self._lock:
            hits = self._hits[key]
            while hits and now - hits[0] > window_s:
                hits.popleft()
            if len(hits) >= limit:
                raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many scans. Wait a minute and try again.")
            hits.append(now)


food_limiter = RateLimiter()


def current_user(auth: AuthUser = Depends(require_auth), db: Session = Depends(get_db)) -> User:
    user = db.get(User, auth.id)
    if user is None:
        user = User(id=auth.id, email=auth.email)
        db.add(user)
        db.commit()
    return user


def onboarded_user(user: User = Depends(current_user)) -> User:
    if user.onboarded_on is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Complete onboarding first")
    return user


def check_client_date(d: date) -> date:
    # Clients send their local date; allow Â±1 day around UTC to cover every timezone.
    if abs((d - datetime.now(timezone.utc).date()).days) > 1:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Date is out of range")
    return d


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/me/dashboard")
def get_dashboard(
    day: date = Query(alias="date"), user: User = Depends(current_user), db: Session = Depends(get_db)
):
    return services.dashboard(db, user, check_client_date(day))


@app.post("/me/onboarding")
def post_onboarding(data: OnboardingIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    check_client_date(data.date)
    services.onboard(db, user, data)
    return services.dashboard(db, user, data.date)


@app.post("/food/scan")
def scan_food(
    image: UploadFile = File(...),
    log_date: date = Form(...),
    hint: str = Form("", max_length=200),
    user: User = Depends(onboarded_user),
    db: Session = Depends(get_db),
):
    check_client_date(log_date)
    if image.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Upload a JPEG, PNG, WebP or HEIC photo")
    data = image.file.read(settings.max_image_bytes + 1)
    if len(data) > settings.max_image_bytes:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "Image is too large (max 5 MB)")

    food_limiter.check(user.id, settings.food_scans_per_minute)
    try:
        estimate, model = ai.analyze_meal(data, image.content_type, hint)
    except ai.AIUnavailable as e:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(e))
    if not estimate.is_food or estimate.calories <= 0:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "No food detected in that photo. Try another angle.")

    entry = services.save_food_log(db, user, log_date, estimate, model)
    goal = services.latest(db, Goal, user.id)
    return {"log": services.food_log_out(entry), "today": services.day_summary(db, user, goal, log_date)}


@app.delete("/food/logs/{log_id}")
def delete_food_log(log_id: int, user: User = Depends(onboarded_user), db: Session = Depends(get_db)):
    entry = db.get(FoodLog, log_id)
    if entry is None or entry.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Log not found")
    day = entry.log_date
    db.delete(entry)
    db.commit()
    goal = services.latest(db, Goal, user.id)
    return {"today": services.day_summary(db, user, goal, day)}


@app.post("/checkins")
def post_checkin(data: CheckInIn, user: User = Depends(onboarded_user), db: Session = Depends(get_db)):
    check_client_date(data.date)
    try:
        result = services.process_checkin(db, user, data)
    except services.CheckInTooEarly as e:
        raise HTTPException(status.HTTP_409_CONFLICT, f"Your next check-in opens on {e.next_date.isoformat()}")
    return {"result": result, "dashboard": services.dashboard(db, user, data.date)}
