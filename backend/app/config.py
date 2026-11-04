from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./hardgainer.db"
    supabase_url: str = ""
    supabase_jwt_secret: str = ""

    gemini_api_key: str = ""
    # e.g. https://gateway.ai.cloudflare.com/v1/<account_id>/<gateway>/google-ai-studio
    ai_gateway_url: str = ""
    vision_models: list[str] = ["gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"]
    text_models: list[str] = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.5-flash"]
    ai_timeout_seconds: int = 30

    frontend_origins: list[str] = ["http://localhost:5173"]
    max_image_bytes: int = 5 * 1024 * 1024
    food_scans_per_minute: int = 5
    checkin_min_days: int = 6


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
