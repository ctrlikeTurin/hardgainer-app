import os
import sys
from pathlib import Path

os.environ["DATABASE_URL"] = "sqlite:///./test_hardgainer.db"
os.environ["GEMINI_API_KEY"] = ""
os.environ["CHECKIN_MIN_DAYS"] = "0"
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
