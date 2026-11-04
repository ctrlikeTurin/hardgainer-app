CREATE TABLE users (
  id TEXT PRIMARY KEY,              -- Supabase auth.users.id
  email TEXT,
  age INTEGER,
  sex TEXT,
  height_cm REAL,
  start_weight_kg REAL,
  weight_kg REAL,
  target_weight_kg REAL,
  activity_level TEXT,
  environment TEXT,
  onboarded_on TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_on TEXT NOT NULL,
  bmr INTEGER NOT NULL,
  tdee INTEGER NOT NULL,
  surplus INTEGER NOT NULL,
  calories INTEGER NOT NULL,
  protein_g INTEGER NOT NULL,
  carbs_g INTEGER NOT NULL,
  fat_g INTEGER NOT NULL,
  weekly_rate_kg REAL NOT NULL,
  week_goal_kg REAL NOT NULL,
  week_goal_date TEXT NOT NULL,
  month_goal_kg REAL NOT NULL,
  month_goal_date TEXT NOT NULL,
  target_date TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT ''
);
CREATE INDEX ix_goals_user ON goals(user_id, id);

CREATE TABLE food_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  log_date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  description TEXT NOT NULL DEFAULT '',
  items TEXT NOT NULL DEFAULT '[]',
  calories REAL NOT NULL,
  protein REAL NOT NULL,
  carbs REAL NOT NULL,
  fats REAL NOT NULL,
  confidence TEXT NOT NULL DEFAULT 'medium',
  model TEXT NOT NULL DEFAULT ''
);
CREATE INDEX ix_food_logs_user_date ON food_logs(user_id, log_date);

CREATE TABLE workouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_number INTEGER NOT NULL,
  environment TEXT NOT NULL,
  plan TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ix_workouts_user ON workouts(user_id, id);

CREATE TABLE checkins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  checkin_date TEXT NOT NULL,
  weight_kg REAL NOT NULL,
  previous_weight_kg REAL NOT NULL,
  days_elapsed INTEGER NOT NULL,
  difficulty INTEGER NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  surplus_before INTEGER NOT NULL,
  surplus_after INTEGER NOT NULL,
  decision TEXT NOT NULL
);
CREATE INDEX ix_checkins_user ON checkins(user_id, id);
