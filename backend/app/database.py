from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import sessionmaker, DeclarativeBase

from app.config import get_settings

settings = get_settings()

connect_args = {}
if settings.database_url.startswith("sqlite"):
    connect_args = {"check_same_thread": False}

engine = create_engine(
    settings.database_url,
    connect_args=connect_args,
    future=True,
)

if settings.database_url.startswith("sqlite"):

    @event.listens_for(engine, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def ensure_schema() -> None:
    """Add newly introduced columns/tables for existing DBs."""
    from sqlalchemy import inspect

    Base.metadata.create_all(bind=engine)
    insp = inspect(engine)
    if "people" in insp.get_table_names():
        people_cols = {c["name"] for c in insp.get_columns("people")}
        with engine.begin() as conn:
            if "personal_number" not in people_cols:
                conn.execute(
                    text("ALTER TABLE people ADD COLUMN personal_number VARCHAR(64)")
                )
            if "phone" not in people_cols:
                conn.execute(text("ALTER TABLE people ADD COLUMN phone VARCHAR(40)"))

    if not settings.database_url.startswith("sqlite"):
        return
    with engine.begin() as conn:
        cols = {
            row[1]
            for row in conn.execute(text("PRAGMA table_info(mission_types)")).fetchall()
        }
        if "required_sleep_hours_before_after" not in cols:
            conn.execute(
                text(
                    "ALTER TABLE mission_types "
                    "ADD COLUMN required_sleep_hours_before_after FLOAT DEFAULT 0"
                )
            )
        if "routine_remainder_policy" not in cols:
            conn.execute(
                text(
                    "ALTER TABLE mission_types "
                    "ADD COLUMN routine_remainder_policy VARCHAR(32) "
                    "DEFAULT 'include_short'"
                )
            )
        # Existing routine types need a start hour for the new day model
        conn.execute(
            text(
                "UPDATE mission_types SET recurring_start_hour = 8 "
                "WHERE is_recurring_template = 1 AND recurring_start_hour IS NULL"
            )
        )
        schedule_cols = {
            row[1]
            for row in conn.execute(text("PRAGMA table_info(schedules)")).fetchall()
        }
        if "share_token" not in schedule_cols:
            conn.execute(
                text("ALTER TABLE schedules ADD COLUMN share_token VARCHAR(64)")
            )


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
