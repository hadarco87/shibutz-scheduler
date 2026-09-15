"""Multi-day schedule plans: cumulative draft fairness + after drafts."""

from datetime import date, datetime, timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import (
    AfterDraft,
    Assignment,
    Company,
    ConstraintSeverity,
    ConstraintType,
    Mission,
    MissionRequirement,
    MissionType,
    Person,
    Role,
    RoleCapability,
    Schedule,
    ScheduleStatus,
    SchedulingConstraint,
    User,
    UserRole,
)
from app.security import get_password_hash
from app.services.plans import create_schedule_plan, generate_plan, publish_plan
from app.services.scheduling import (
    provisional_after_counts_before_day,
    provisional_workload_before_day,
)
from app.services.validation import validate_assignment


@pytest.fixture()
def db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSession = sessionmaker(bind=engine)
    Base.metadata.create_all(bind=engine)
    session = TestingSession()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture()
def company_data(db):
    company = Company(name="Plan Co")
    db.add(company)
    db.flush()
    soldier = Role(company_id=company.id, name="חייל")
    db.add(soldier)
    db.flush()
    db.add(RoleCapability(role_id=soldier.id, can_fulfill_role_id=soldier.id))
    db.add(
        SchedulingConstraint(
            company_id=company.id,
            name="rest",
            constraint_type=ConstraintType.MINIMUM_REST,
            severity=ConstraintSeverity.HARD,
            value=0,
        )
    )
    user = User(
        company_id=company.id,
        email="plan@test.com",
        full_name="Planner",
        hashed_password=get_password_hash("pass"),
        role=UserRole.COMMANDER,
    )
    db.add(user)
    people = []
    for i in range(4):
        p = Person(
            company_id=company.id,
            full_name=f"Soldier {i+1}",
            role_id=soldier.id,
            is_active=True,
        )
        db.add(p)
        people.append(p)
    mt = MissionType(
        company_id=company.id,
        name="שמירה",
        difficulty_weight=2.0,
        default_personnel_count=1,
        is_active=True,
    )
    db.add(mt)
    db.flush()
    return {
        "company": company,
        "user": user,
        "soldier": soldier,
        "people": people,
        "mission_type": mt,
    }


def _add_mission(db, schedule, mt, soldier_role, start, end):
    mission = Mission(
        company_id=schedule.company_id,
        schedule_id=schedule.id,
        mission_type_id=mt.id,
        name=mt.name,
        start_at=start,
        end_at=end,
        difficulty_weight=mt.difficulty_weight,
        personnel_count=1,
    )
    db.add(mission)
    db.flush()
    db.add(
        MissionRequirement(
            mission_id=mission.id,
            role_id=soldier_role.id,
            count=1,
        )
    )
    db.flush()
    return mission


def test_create_plan_makes_day_schedules(db, company_data):
    start = date(2026, 9, 17)
    plan = create_schedule_plan(
        db,
        company_id=company_data["company"].id,
        user_id=company_data["user"].id,
        start_date=start,
        days_count=3,
        instantiate=False,
    )
    db.commit()
    days = (
        db.query(Schedule)
        .filter(Schedule.plan_id == plan.id)
        .order_by(Schedule.window_start)
        .all()
    )
    assert len(days) == 3
    assert days[0].day_index == 0
    assert days[0].window_start == datetime(2026, 9, 17, 0, 0, 0)
    assert days[2].window_start == datetime(2026, 9, 19, 0, 0, 0)


def test_provisional_workload_from_earlier_draft_days(db, company_data):
    plan = create_schedule_plan(
        db,
        company_id=company_data["company"].id,
        user_id=company_data["user"].id,
        start_date=date(2026, 9, 17),
        days_count=2,
        instantiate=False,
    )
    days = (
        db.query(Schedule)
        .filter(Schedule.plan_id == plan.id)
        .order_by(Schedule.window_start)
        .all()
    )
    day1, day2 = days
    person = company_data["people"][0]
    mt = company_data["mission_type"]
    mission = _add_mission(
        db,
        day1,
        mt,
        company_data["soldier"],
        datetime(2026, 9, 17, 8, 0),
        datetime(2026, 9, 17, 12, 0),
    )
    db.add(
        Assignment(
            schedule_id=day1.id,
            mission_id=mission.id,
            person_id=person.id,
            difficulty_at_assignment=2.0,
            is_manual=False,
        )
    )
    db.flush()

    provisional = provisional_workload_before_day(db, day2)
    # 2.0 difficulty × 4 hours = 8.0
    assert provisional.get(person.id) == pytest.approx(8.0)
    assert provisional_workload_before_day(db, day1) == {}


def test_after_draft_blocks_and_counts_toward_later_days(db, company_data):
    plan = create_schedule_plan(
        db,
        company_id=company_data["company"].id,
        user_id=company_data["user"].id,
        start_date=date(2026, 9, 17),
        days_count=2,
        instantiate=False,
    )
    days = (
        db.query(Schedule)
        .filter(Schedule.plan_id == plan.id)
        .order_by(Schedule.window_start)
        .all()
    )
    day1, day2 = days
    person = company_data["people"][0]
    db.add(
        AfterDraft(
            schedule_id=day1.id,
            person_id=person.id,
            start_at=datetime(2026, 9, 17, 0, 0),
            end_at=datetime(2026, 9, 17, 8, 0),
        )
    )
    db.flush()

    mission = _add_mission(
        db,
        day1,
        company_data["mission_type"],
        company_data["soldier"],
        datetime(2026, 9, 17, 2, 0),
        datetime(2026, 9, 17, 6, 0),
    )
    result = validate_assignment(
        db,
        company_id=company_data["company"].id,
        person=person,
        mission=mission,
        existing_assignments=[],
        missions_by_id={mission.id: mission},
        required_role_id=company_data["soldier"].id,
    )
    assert not result.ok
    assert any(v.code == "after_draft" for v in result.hard_violations)

    counts = provisional_after_counts_before_day(db, day2)
    assert counts.get(person.id) == 1


def test_generate_and_publish_plan(db, company_data):
    plan = create_schedule_plan(
        db,
        company_id=company_data["company"].id,
        user_id=company_data["user"].id,
        start_date=date(2026, 9, 17),
        days_count=2,
        instantiate=False,
    )
    days = (
        db.query(Schedule)
        .filter(Schedule.plan_id == plan.id)
        .order_by(Schedule.window_start)
        .all()
    )
    for i, day in enumerate(days):
        start = datetime(2026, 9, 17, 8, 0) + timedelta(days=i)
        _add_mission(
            db,
            day,
            company_data["mission_type"],
            company_data["soldier"],
            start,
            start + timedelta(hours=4),
        )
    db.flush()
    generate_plan(db, plan, user_id=company_data["user"].id, scope="all_draft")
    for day in days:
        db.refresh(day)
        assert day.status == ScheduleStatus.DRAFT
        assert len(day.assignments) >= 1

    publish_plan(db, plan, company_data["user"].id)
    db.refresh(plan)
    assert plan.status == ScheduleStatus.PUBLISHED
    for day in days:
        db.refresh(day)
        assert day.status == ScheduleStatus.PUBLISHED
