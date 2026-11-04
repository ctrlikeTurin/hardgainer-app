# Hardgainer

Fitness and nutrition app for skinny people trying to gain muscle. React (Vite) frontend, FastAPI backend, Supabase Auth, Google Gemini (free tier).

## Architecture

```
React (Vite) ── Supabase Auth (email + verification) ──► access token (JWT)
     │
     │  Bearer JWT, photos pre-shrunk to ~1024px JPEG in the browser
     ▼
FastAPI ── verifies JWT via Supabase JWKS
   ├── fitness_math.py   Mifflin-St Jeor, surplus, macros, milestones (pure Python, no AI)
   ├── ai.py             Gemini: meal photo → JSON macros; weekly workout progression
   ├── workouts.py       Week-1 templates + rules fallback when AI is unavailable
   └── SQLAlchemy ──► SQLite (dev) / Supabase Postgres (prod)
```

## Data model

| Table | Key columns |
|---|---|
| `users` | `id` (= Supabase `auth.users.id`), age, sex, height_cm, start_weight_kg, weight_kg, target_weight_kg, activity_level, environment (home/gym), onboarded_on |
| `goals` | user_id, created_on, bmr, tdee, surplus, calories, protein_g/carbs_g/fat_g, weekly_rate_kg, week_goal_kg+date, month_goal_kg+date, target_date, reason. A new row is added at every check-in, so history is kept. |
| `food_logs` | user_id, log_date (user's local date), description, items (JSON), calories, protein, carbs, fats, confidence, model |
| `workouts` | user_id, week_number, environment, plan (JSON), source (`template` / `rules` / Gemini model id) |
| `checkins` | user_id, checkin_date, weight_kg, previous_weight_kg, days_elapsed, difficulty (1-5), notes, surplus_before/after, decision |

## The math (`backend/app/fitness_math.py`)

- **BMR**: Mifflin-St Jeor, `10w + 6.25h − 5a + 5` (male) / `− 161` (female).
- **TDEE**: BMR × activity multiplier (1.2 – 1.9).
- **Surplus**: 300–500 kcal depending on activity level.
- **Macros**: protein 2.0 g/kg; fat 25% of kcal (min 0.8 g/kg); carbs make up the rest.
- **Rate**: `surplus × 7 / 7700`, clamped to 0.25–0.5 kg/week.
- **Milestones**: projected weight on the coming Sunday, at the end of the month (rolls to next month if under 7 days left), and the exact date the target is reached.
- **Weekly check-in**: if the weekly gain is below 0.1 kg, surplus +150; above 0.6 kg, −100; otherwise unchanged. Clamped to 250–1200 kcal.

## Speed and free-tier choices

| Choice | Why |
|---|---|
| Browser shrinks photos to 1024px JPEG before upload | 3–8 MB phone photos become ~150 KB. Faster upload, far fewer image tokens. |
| `response_schema` structured JSON | Always-parseable replies, no retries, short outputs |
| `thinkingLevel: minimal` | Flash models "think" by default. Minimal thinking cuts latency and quota use for these simple tasks. |
| Model fallback chain | Vision: 3.5 Flash → 3.5 Flash-Lite → 3.1 Flash-Lite. Text: 3.5 Flash-Lite → 3.1 Flash-Lite → 3.5 Flash. A 429/503 on one model moves to the next, which has its own free quota. (Gemini 2.5 is closed to new API keys.) |
| No AI for math or week 1 | Onboarding is instant. AI is only called for photos and weekly progression. |
| Rules-based progression fallback | Check-ins still work if Gemini is down or out of quota |
| Per-user scan rate limit (5/min) | One user can't drain the shared free quota |
| One `/me/dashboard` call, all its queries in one D1 batch | One round trip to the database per page load |
| Worker pinned near D1 (`placement` in `wrangler.jsonc`) | ~40 ms per query instead of ~155 ms from Johannesburg |
| Last dashboard cached on the device | The app shows instantly on return visits, then refreshes |
| `public/_headers`: hashed assets cached for a year | Return visits don't re-download or re-check code |
| `@supabase/auth-js` only, self-hosted fonts, WebP exercise photos | Smaller first load, no third-party font servers |

Models are configurable via `VISION_MODELS` / `TEXT_MODELS` in `.env`. Swap in newer free models without code changes.

## Setup

1. **Supabase** (free): create a project. Under *Authentication → Providers → Email*, keep **Confirm email** on, so unverified users never get a session. Add `http://localhost:5173` to *Authentication → URL Configuration → Redirect URLs*.
2. **Gemini key** (free): https://aistudio.google.com/apikey
3. **Backend**
   ```powershell
   cd backend
   python -m venv .venv; .\.venv\Scripts\pip install -r requirements-dev.txt
   copy .env.example .env   # fill SUPABASE_URL and GEMINI_API_KEY
   .\.venv\Scripts\uvicorn app.main:app --reload
   .\.venv\Scripts\python -m pytest
   ```
4. **Frontend**
   ```powershell
   cd frontend
   npm install
   copy .env.example .env   # fill VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
   npm run dev
   ```

## Cloudflare deployment (production)

Live at https://hardgainer.hardgainer-frontend.workers.dev. One Worker serves the React app and the API (`frontend/worker/`, a TypeScript port of the Python backend) on the same domain, with Cloudflare D1 (SQLite) as the database. Everything runs on Cloudflare's free plan. The Python backend in `backend/` stays as a reference and local alternative; set `VITE_API_URL` to use it.

```powershell
cd frontend
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put SUPABASE_URL
# VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY go in frontend/.env.production (public values, built into the page)
npx wrangler d1 migrations apply hardgainer --remote   # after adding a migration
npm run deploy
node scripts/webp-exercise-images.mjs   # after rebuilding the exercise library
node scripts/smoke-test.mjs   # against `npx vite dev`; uses the test secret in .dev.vars
```

Security headers (including the Content Security Policy) live in `frontend/public/_headers`. The CSP allows the small inline theme script in `index.html` by hash; if you change that script, rebuild and update the hash:

```powershell
python -c "import re,hashlib,base64;s=open('dist/client/index.html',encoding='utf-8').read();print(['sha256-'+base64.b64encode(hashlib.sha256(m.encode()).digest()).decode() for m in re.findall(r'<script>(.*?)</script>',s,re.S)])"
```

To use Cloudflare AI Gateway, create a gateway in the dashboard and set `AI_GATEWAY_URL` in `wrangler.jsonc` to `https://gateway.ai.cloudflare.com/v1/<account_id>/<gateway>/google-ai-studio`.

## App screens

- **Today**: calorie ring and macro bars; log meals by photo, text description (AI) or manual entry; one-tap "eat it again" for recent meals; ½× / 1.5× / 2× portion fixes; a daily calorie-dense food tip.
- **Train**: day tabs, demo photos and step-by-step instructions for every exercise (public-domain [free-exercise-db](https://github.com/yuhonas/free-exercise-db), built by `scripts/build-exercise-library.mjs`), tap-to-complete sets with an automatic rest timer. Set progress is kept per device in `localStorage`.
- **Progress**: weight chart against the planned pace, milestones, daily plan breakdown, check-in history.
- Light/dark theme, logging streak, weekly check-in as a bottom sheet.

## API (Worker routes are prefixed with `/api`)

| Method | Path | Purpose |
|---|---|---|
| GET | `/me/dashboard?date=YYYY-MM-DD` | Profile, goal, today's macros and remaining amounts, current workout, check-in status |
| POST | `/me/onboarding` | Save the profile, then calculate the plan and week-1 workout |
| POST | `/food/scan` (multipart `image`, `log_date`, `hint`) | Gemini Vision → macros, saved, returns updated remaining |
| POST | `/food/describe` (`text`, `log_date`) | Gemini text → macros, saved |
| POST | `/food/quick` | Manual entry (description, calories, optional macros) |
| POST | `/food/logs/{id}/repeat` | Log a previous meal again |
| PATCH | `/food/logs/{id}` (`factor` 0.25–4) | Scale a logged portion |
| DELETE | `/food/logs/{id}` | Remove a log entry |
| PATCH | `/me/profile` | Change target weight, activity level or training location (keeps the tuned surplus) |
| DELETE | `/me` | Delete all of the user's data (and the login too, if `SUPABASE_SERVICE_ROLE_KEY` is set) |
| POST | `/checkins` | Weekly weight + difficulty → new calories + next week's workout |

Production notes: replace `create_all` with Alembic migrations, and move the in-memory rate limiter to Redis if you run more than one worker.
