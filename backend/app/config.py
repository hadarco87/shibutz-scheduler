from functools import lru_cache
from typing import Optional

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "Shibutz Scheduler"
    environment: str = "development"  # development | production
    secret_key: str = "dev-secret-change-me-in-production"
    access_token_expire_minutes: int = 60 * 12
    algorithm: str = "HS256"
    database_url: str = "sqlite:///./shibutz.db"
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    # Matches the Vercel production alias AND every preview/branch deployment
    # of this project (e.g. shibutz-scheduler-git-main-xxx.vercel.app), so we
    # don't need to hand-update CORS_ORIGINS every time Vercel mints a new
    # preview URL. Override via CORS_ORIGIN_REGEX env var if the project is
    # renamed or a custom domain is used.
    cors_origin_regex: Optional[str] = r"^https://shibutz-scheduler(-[\w.-]+)?\.vercel\.app$"
    min_rest_hours: float = 6.0
    default_admin_email: str = "admin@example.com"
    default_admin_password: str = "admin123"
    # When unset: seed demo only outside production
    seed_demo: Optional[bool] = None

    @property
    def is_production(self) -> bool:
        return self.environment.lower() == "production"

    @property
    def should_seed_demo(self) -> bool:
        if self.seed_demo is not None:
            return self.seed_demo
        return not self.is_production

    @property
    def cors_origin_list(self):
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
