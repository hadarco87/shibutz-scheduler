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

    if "mission_types" in insp.get_table_names():
        mt_cols = {c["name"] for c in insp.get_columns("mission_types")}
        with engine.begin() as conn:
            if "required_sleep_hours_before_after" not in mt_cols:
                conn.execute(
                    text(
                        "ALTER TABLE mission_types "
                        "ADD COLUMN required_sleep_hours_before_after FLOAT DEFAULT 0"
                    )
                )
            if "routine_remainder_policy" not in mt_cols:
                conn.execute(
                    text(
                        "ALTER TABLE mission_types "
                        "ADD COLUMN routine_remainder_policy VARCHAR(32) "
                        "DEFAULT 'include_short'"
                    )
                )
            if "recurrence_kind" not in mt_cols:
                conn.execute(
                    text(
                        "ALTER TABLE mission_types "
                        "ADD COLUMN recurrence_kind VARCHAR(32) DEFAULT 'daily'"
                    )
                )
            if "recurrence_interval_days" not in mt_cols:
                conn.execute(
                    text(
                        "ALTER TABLE mission_types "
                        "ADD COLUMN recurrence_interval_days INTEGER DEFAULT 1"
                    )
                )
            if "recurrence_weekdays" not in mt_cols:
                conn.execute(
                    text(
                        "ALTER TABLE mission_types "
                        "ADD COLUMN recurrence_weekdays VARCHAR(50)"
                    )
                )
            if "recurrence_anchor_date" not in mt_cols:
                conn.execute(
                    text(
                        "ALTER TABLE mission_types ADD COLUMN recurrence_anchor_date DATE"
                    )
                )
            if "routine_hours_mode" not in mt_cols:
                conn.execute(
                    text(
                        "ALTER TABLE mission_types "
                        "ADD COLUMN routine_hours_mode VARCHAR(32) DEFAULT 'uniform'"
                    )
                )
            # Existing routine types need a start hour for the new day model
            conn.execute(
                text(
                    "UPDATE mission_types SET recurring_start_hour = 8 "
                    "WHERE is_recurring_template = :is_recurring "
                    "AND recurring_start_hour IS NULL "
                    "AND (routine_hours_mode IS NULL OR routine_hours_mode = 'uniform')"
                ),
                {"is_recurring": True},
            )

    if "schedules" in insp.get_table_names():
        schedule_cols = {c["name"] for c in insp.get_columns("schedules")}
        with engine.begin() as conn:
            if "share_token" not in schedule_cols:
                conn.execute(
                    text("ALTER TABLE schedules ADD COLUMN share_token VARCHAR(64)")
                )
            if "plan_id" not in schedule_cols:
                conn.execute(
                    text("ALTER TABLE schedules ADD COLUMN plan_id INTEGER")
                )
            if "day_index" not in schedule_cols:
                conn.execute(
                    text("ALTER TABLE schedules ADD COLUMN day_index INTEGER DEFAULT 0")
                )

    if "scheduling_rules" in insp.get_table_names():
        rule_cols = {c["name"] for c in insp.get_columns("scheduling_rules")}
        with engine.begin() as conn:
            if "rule_kind" not in rule_cols:
                conn.execute(
                    text(
                        "ALTER TABLE scheduling_rules "
                        "ADD COLUMN rule_kind VARCHAR(32) DEFAULT 'transition'"
                    )
                )
            if "min_count" not in rule_cols:
                conn.execute(
                    text(
                        "ALTER TABLE scheduling_rules "
                        "ADD COLUMN min_count INTEGER DEFAULT 1"
                    )
                )
            if "presence_scope" not in rule_cols:
                conn.execute(
                    text(
                        "ALTER TABLE scheduling_rules "
                        "ADD COLUMN presence_scope VARCHAR(32) DEFAULT 'not_at_home'"
                    )
                )

    for table in (
        "mission_type_requirements",
        "mission_type_band_requirements",
        "mission_requirements",
    ):
        if table not in insp.get_table_names():
            continue
        cols = {c["name"] for c in insp.get_columns(table)}
        if "exact_role" not in cols:
            with engine.begin() as conn:
                conn.execute(
                    text(
                        f"ALTER TABLE {table} "
                        "ADD COLUMN exact_role BOOLEAN DEFAULT FALSE"
                    )
                )
        if "exact_qualification" not in cols:
            with engine.begin() as conn:
                conn.execute(
                    text(
                        f"ALTER TABLE {table} "
                        "ADD COLUMN exact_qualification BOOLEAN DEFAULT TRUE"
                    )
                )


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
