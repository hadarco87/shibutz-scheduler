from contextlib import asynccontextmanager
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import router
from app.config import get_settings
from app.database import SessionLocal, ensure_schema
from app.seed import normalize_role_display_names, seed_if_empty

logger = logging.getLogger("uvicorn.error")


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings = get_settings()
    if settings.is_production and settings.secret_key.startswith("dev-secret"):
        logger.warning(
            "SECRET_KEY is still the development default — set a strong secret in production"
        )
    ensure_schema()
    db = SessionLocal()
    try:
        if settings.should_seed_demo:
            seed_if_empty(db)
        normalize_role_display_names(db)
    finally:
        db.close()
    yield


settings = get_settings()
app = FastAPI(
    title=settings.app_name,
    lifespan=lifespan,
    docs_url=None if settings.is_production else "/docs",
    redoc_url=None if settings.is_production else "/redoc",
    openapi_url=None if settings.is_production else "/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/api")


@app.get("/health")
def health():
    return {"status": "ok", "app": settings.app_name}
