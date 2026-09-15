"""Multi-day schedule plans with cumulative draft fairness."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Optional

from sqlalchemy.orm import Session, joinedload

from app.models import Schedule, SchedulePlan, ScheduleStatus
from app.services.scheduling import (
    generate_schedule,
    instantiate_active_mission_types,
    publish_schedule,
)


MAX_PLAN_DAYS = 7


def calendar_day_bounds(day: date) -> tuple[datetime, datetime]:
    start = datetime(day.year, day.month, day.day, 0, 0, 0)
    end = start + timedelta(days=1)
    return start, end


def create_schedule_plan(
    db: Session,
    *,
    company_id: int,
    user_id: int,
    start_date: date,
    days_count: int,
    instantiate: bool = True,
    notes: Optional[str] = None,
) -> SchedulePlan:
    days_count = max(1, min(int(days_count), MAX_PLAN_DAYS))
    plan = SchedulePlan(
        company_id=company_id,
        start_date=start_date,
        days_count=days_count,
        status=ScheduleStatus.DRAFT,
        created_by_id=user_id,
        notes=notes,
    )
    db.add(plan)
    db.flush()

    for i in range(days_count):
        day = start_date + timedelta(days=i)
        ws, we = calendar_day_bounds(day)
        schedule = Schedule(
            company_id=company_id,
            plan_id=plan.id,
            day_index=i,
            window_start=ws,
            window_end=we,
            status=ScheduleStatus.DRAFT,
            created_by_id=user_id,
        )
        db.add(schedule)
        db.flush()
        if instantiate:
            instantiate_active_mission_types(db, schedule)
    db.flush()
    return plan


def generate_plan(
    db: Session,
    plan: SchedulePlan,
    *,
    user_id: Optional[int] = None,
    scope: str = "all_draft",
    day_schedule_id: Optional[int] = None,
) -> SchedulePlan:
    if plan.status == ScheduleStatus.PUBLISHED:
        raise ValueError("לא ניתן לשבץ מחדש תוכנית שפורסמה")

    days = (
        db.query(Schedule)
        .filter(Schedule.plan_id == plan.id)
        .order_by(Schedule.window_start.asc())
        .all()
    )
    if scope == "day":
        if not day_schedule_id:
            raise ValueError("חסר מזהה יום לשיבוץ")
        target = next((s for s in days if s.id == day_schedule_id), None)
        if not target:
            raise ValueError("היום לא שייך לתוכנית")
        if target.status == ScheduleStatus.PUBLISHED:
            raise ValueError("לא ניתן לשבץ מחדש יום שפורסם")
        generate_schedule(db, target, user_id=user_id)
        return plan

    for schedule in days:
        if schedule.status == ScheduleStatus.PUBLISHED:
            continue
        generate_schedule(db, schedule, user_id=user_id)
    return plan


def publish_plan(db: Session, plan: SchedulePlan, user_id: int) -> SchedulePlan:
    if plan.status == ScheduleStatus.PUBLISHED:
        raise ValueError("התוכנית כבר פורסמה")
    days = (
        db.query(Schedule)
        .filter(Schedule.plan_id == plan.id)
        .order_by(Schedule.window_start.asc())
        .all()
    )
    if not days:
        raise ValueError("אין ימים בתוכנית")
    for schedule in days:
        if schedule.status == ScheduleStatus.PUBLISHED:
            continue
        publish_schedule(db, schedule, user_id)
    plan.status = ScheduleStatus.PUBLISHED
    plan.published_at = datetime.utcnow()
    db.commit()
    db.refresh(plan)
    return plan


def load_plan(db: Session, plan_id: int, company_id: int) -> Optional[SchedulePlan]:
    return (
        db.query(SchedulePlan)
        .options(joinedload(SchedulePlan.schedules))
        .filter(SchedulePlan.id == plan_id, SchedulePlan.company_id == company_id)
        .first()
    )


def active_draft_plan(db: Session, company_id: int) -> Optional[SchedulePlan]:
    return (
        db.query(SchedulePlan)
        .options(joinedload(SchedulePlan.schedules))
        .filter(
            SchedulePlan.company_id == company_id,
            SchedulePlan.status == ScheduleStatus.DRAFT,
        )
        .order_by(SchedulePlan.start_date.desc(), SchedulePlan.id.desc())
        .first()
    )
