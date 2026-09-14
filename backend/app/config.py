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
    cors_origins: str = "http://localhost:3000"
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
