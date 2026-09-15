from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app.models import (
    Assignment,
    Company,
    ConstraintSeverity,
    ConstraintType,
    Mission,
    MissionRequirement,
    MissionType,
    Person,
    PersonQualification,
    Qualification,
    Role,
    RoleCapability,
    Schedule,
    ScheduleStatus,
    SchedulingConstraint,
    User,
    UserRole,
    WorkloadEvent,
)
from app.security import get_password_hash
from app.services.scheduling import generate_schedule, publish_schedule
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
    company = Company(name="Test Co")
    db.add(company)
    db.flush()
    soldier = Role(company_id=company.id, name="חייל")
    commander = Role(company_id=company.id, name="מפקד")
    db.add_all([soldier, commander])
    db.flush()
    db.add(RoleCapability(role_id=soldier.id, can_fulfill_role_id=soldier.id))
    db.add(RoleCapability(role_id=commander.id, can_fulfill_role_id=commander.id))
    db.add(RoleCapability(role_id=commander.id, can_fulfill_role_id=soldier.id))
    medic = Qualification(company_id=company.id, name="חובש")
    db.add(medic)
    db.flush()
    db.add(
        SchedulingConstraint(
            company_id=company.id,
            name="rest",
            constraint_type=ConstraintType.MINIMUM_REST,
            severity=ConstraintSeverity.HARD,
            value=6,
        )
    )
    user = User(
        company_id=company.id,
        email="test@test.com",
        full_name="Tester",
        hashed_password=get_password_hash("pass"),
        role=UserRole.COMMANDER,
    )
    db.add(user)
    db.commit()
    return {
        "company": company,
        "soldier": soldier,
        "commander": commander,
        "medic": medic,
        "user": user,
    }


def test_leave_blocks_assignment(db, company_data):
    from app.models import LeavePeriod, LeaveType

    p = Person(
        company_id=company_data["company"].id,
        full_name="On Leave",
        role_id=company_data["soldier"].id,
    )
    db.add(p)
    db.flush()
    start = datetime(2026, 9, 14, 8)
    end = datetime(2026, 9, 14, 16)
    db.add(
        LeavePeriod(
            person_id=p.id,
            leave_type=LeaveType.LEAVE,
            start_at=start - timedelta(hours=1),
            end_at=end + timedelta(hours=1),
        )
    )
    mt = MissionType(
        company_id=company_data["company"].id,
        name="סיור",
        difficulty_weight=4,
        default_personnel_count=1,
    )
    db.add(mt)
    db.flush()
    mission = Mission(
        company_id=company_data["company"].id,
        mission_type_id=mt.id,
        name="סיור",
        start_at=start,
        end_at=end,
        difficulty_weight=4,
        personnel_count=1,
    )
    db.add(mission)
    db.commit()
    db.refresh(p)
    result = validate_assignment(
        db,
        company_id=company_data["company"].id,
        person=p,
        mission=mission,
        existing_assignments=[],
        missions_by_id={mission.id: mission},
    )
    assert not result.ok
    assert any(v.code == "leave" for v in result.hard_violations)


def test_commander_can_fill_soldier_slot(db, company_data):
    commander_person = Person(
        company_id=company_data["company"].id,
        full_name="Cmd",
        role_id=company_data["commander"].id,
    )
    db.add(commander_person)
    db.flush()
    mt = MissionType(
        company_id=company_data["company"].id,
        name="שג",
        difficulty_weight=2,
        default_personnel_count=1,
    )
    db.add(mt)
    db.flush()
    mission = Mission(
        company_id=company_data["company"].id,
        mission_type_id=mt.id,
        name="שג",
        start_at=datetime(2026, 9, 14, 8),
        end_at=datetime(2026, 9, 14, 12),
        difficulty_weight=2,
        personnel_count=1,
    )
    db.add(mission)
    db.commit()
    db.refresh(commander_person)
    result = validate_assignment(
        db,
        company_id=company_data["company"].id,
        person=commander_person,
        mission=mission,
        existing_assignments=[],
        missions_by_id={mission.id: mission},
        required_role_id=company_data["soldier"].id,
    )
    assert result.ok


def test_soldier_cannot_fill_commander_slot(db, company_data):
    soldier_person = Person(
        company_id=company_data["company"].id,
        full_name="Sol",
        role_id=company_data["soldier"].id,
    )
    db.add(soldier_person)
    db.flush()
    mt = MissionType(
        company_id=company_data["company"].id,
        name="סיור",
        difficulty_weight=4,
        default_personnel_count=1,
    )
    db.add(mt)
    db.flush()
    mission = Mission(
        company_id=company_data["company"].id,
        mission_type_id=mt.id,
        name="סיור",
        start_at=datetime(2026, 9, 14, 8),
        end_at=datetime(2026, 9, 14, 16),
        difficulty_weight=4,
        personnel_count=1,
    )
    db.add(mission)
    db.commit()
    db.refresh(soldier_person)
    result = validate_assignment(
        db,
        company_id=company_data["company"].id,
        person=soldier_person,
        mission=mission,
        existing_assignments=[],
        missions_by_id={mission.id: mission},
        required_role_id=company_data["commander"].id,
    )
    assert not result.ok
    assert any(v.code == "role" for v in result.hard_violations)


def test_allowed_mission_types_whitelist(db, company_data):
    from app.models import PersonAllowedMissionType

    gate = MissionType(
        company_id=company_data["company"].id,
        name='ש"ג',
        difficulty_weight=2,
        default_personnel_count=1,
    )
    patrol = MissionType(
        company_id=company_data["company"].id,
        name="סיור",
        difficulty_weight=4,
        default_personnel_count=1,
    )
    db.add_all([gate, patrol])
    db.flush()
    person = Person(
        company_id=company_data["company"].id,
        full_name="Gate Only",
        role_id=company_data["soldier"].id,
    )
    db.add(person)
    db.flush()
    db.add(PersonAllowedMissionType(person_id=person.id, mission_type_id=gate.id))
    gate_mission = Mission(
        company_id=company_data["company"].id,
        mission_type_id=gate.id,
        name='ש"ג',
        start_at=datetime(2026, 9, 14, 8),
        end_at=datetime(2026, 9, 14, 12),
        difficulty_weight=2,
        personnel_count=1,
    )
    patrol_mission = Mission(
        company_id=company_data["company"].id,
        mission_type_id=patrol.id,
        name="סיור",
        start_at=datetime(2026, 9, 14, 8),
        end_at=datetime(2026, 9, 14, 16),
        difficulty_weight=4,
        personnel_count=1,
    )
    db.add_all([gate_mission, patrol_mission])
    db.commit()
    db.refresh(person)

    ok = validate_assignment(
        db,
        company_id=company_data["company"].id,
        person=person,
        mission=gate_mission,
        existing_assignments=[],
        missions_by_id={gate_mission.id: gate_mission},
    )
    blocked = validate_assignment(
        db,
        company_id=company_data["company"].id,
        person=person,
        mission=patrol_mission,
        existing_assignments=[],
        missions_by_id={patrol_mission.id: patrol_mission},
    )
    assert ok.ok
    assert not blocked.ok
    assert any(v.code == "mission_type_whitelist" for v in blocked.hard_violations)


def test_recurring_restriction_every_two_days(db, company_data):
    from app.models import RecurrenceKind, RecurringRestriction

    person = Person(
        company_id=company_data["company"].id,
        full_name="Recurring",
        role_id=company_data["soldier"].id,
    )
    db.add(person)
    db.flush()
    anchor = datetime(2026, 9, 13, 0, 0)
    db.add(
        RecurringRestriction(
            person_id=person.id,
            kind=RecurrenceKind.EVERY_N_DAYS,
            interval_days=2,
            time_start="00:00",
            time_end="23:59",
            anchor_date=anchor,
            restriction_type="כל יומיים",
            unavailable=True,
        )
    )
    mt = MissionType(
        company_id=company_data["company"].id,
        name="סיור",
        difficulty_weight=4,
        default_personnel_count=1,
    )
    db.add(mt)
    db.flush()
    blocked_mission = Mission(
        company_id=company_data["company"].id,
        mission_type_id=mt.id,
        name="סיור",
        start_at=datetime(2026, 9, 15, 8),  # +2 days from anchor
        end_at=datetime(2026, 9, 15, 16),
        difficulty_weight=4,
        personnel_count=1,
    )
    free_mission = Mission(
        company_id=company_data["company"].id,
        mission_type_id=mt.id,
        name="סיור2",
        start_at=datetime(2026, 9, 14, 8),  # +1 day — free
        end_at=datetime(2026, 9, 14, 16),
        difficulty_weight=4,
        personnel_count=1,
    )
    db.add_all([blocked_mission, free_mission])
    db.commit()
    db.refresh(person)

    blocked = validate_assignment(
        db,
        company_id=company_data["company"].id,
        person=person,
        mission=blocked_mission,
        existing_assignments=[],
        missions_by_id={blocked_mission.id: blocked_mission},
    )
    free = validate_assignment(
        db,
        company_id=company_data["company"].id,
        person=person,
        mission=free_mission,
        existing_assignments=[],
        missions_by_id={free_mission.id: free_mission},
    )
    assert not blocked.ok
    assert any(v.code == "recurring_restriction" for v in blocked.hard_violations)
    assert free.ok


def test_generate_does_not_change_workload(db, company_data):
    people = []
    for i in range(6):
        p = Person(
            company_id=company_data["company"].id,
            full_name=f"P{i}",
            role_id=company_data["soldier"].id
            if i
            else company_data["commander"].id,
        )
        db.add(p)
        db.flush()
        if i == 1:
            db.add(
                PersonQualification(
                    person_id=p.id, qualification_id=company_data["medic"].id
                )
            )
        people.append(p)

    mt = MissionType(
        company_id=company_data["company"].id,
        name="כוננות",
        difficulty_weight=1,
        default_personnel_count=2,
    )
    db.add(mt)
    db.flush()
    schedule = Schedule(
        company_id=company_data["company"].id,
        window_start=datetime(2026, 9, 14, 12),
        window_end=datetime(2026, 9, 15, 12),
        status=ScheduleStatus.DRAFT,
        created_by_id=company_data["user"].id,
    )
    db.add(schedule)
    db.flush()
    mission = Mission(
        company_id=company_data["company"].id,
        mission_type_id=mt.id,
        name="כוננות",
        start_at=datetime(2026, 9, 14, 20),
        end_at=datetime(2026, 9, 15, 4),
        difficulty_weight=1,
        personnel_count=2,
        schedule_id=schedule.id,
    )
    db.add(mission)
    db.flush()
    db.add(MissionRequirement(mission_id=mission.id, role_id=company_data["soldier"].id, count=2))
    db.commit()

    before = db.query(WorkloadEvent).count()
    generate_schedule(db, schedule, user_id=company_data["user"].id)
    after = db.query(WorkloadEvent).count()
    assert before == after == 0
    assert db.query(Assignment).filter(Assignment.schedule_id == schedule.id).count() == 2


def test_publish_creates_workload_once(db, company_data):
    p = Person(
        company_id=company_data["company"].id,
        full_name="Avi",
        role_id=company_data["soldier"].id,
    )
    db.add(p)
    db.flush()
    mt = MissionType(
        company_id=company_data["company"].id,
        name="שג",
        difficulty_weight=2,
        default_personnel_count=1,
    )
    db.add(mt)
    db.flush()
    schedule = Schedule(
        company_id=company_data["company"].id,
        window_start=datetime(2026, 9, 14, 12),
        window_end=datetime(2026, 9, 15, 12),
        status=ScheduleStatus.DRAFT,
        created_by_id=company_data["user"].id,
    )
    db.add(schedule)
    db.flush()
    mission = Mission(
        company_id=company_data["company"].id,
        mission_type_id=mt.id,
        name="שג",
        start_at=datetime(2026, 9, 14, 14),
        end_at=datetime(2026, 9, 14, 18),
        difficulty_weight=2,
        personnel_count=1,
        schedule_id=schedule.id,
    )
    db.add(mission)
    db.flush()
    db.add(MissionRequirement(mission_id=mission.id, role_id=company_data["soldier"].id, count=1))
    a = Assignment(
        schedule_id=schedule.id,
        mission_id=mission.id,
        person_id=p.id,
        difficulty_at_assignment=2,
    )
    db.add(a)
    db.commit()

    publish_schedule(db, schedule, company_data["user"].id)
    events = db.query(WorkloadEvent).all()
    assert len(events) == 1
    # difficulty 2 × 4 hours = 8
    assert events[0].delta == 8.0
    assert events[0].difficulty_weight == 2.0
    with pytest.raises(ValueError):
        publish_schedule(db, schedule, company_data["user"].id)


def test_replacement_candidates_filter_by_role_and_availability(db, company_data):
    from app.services.scheduling import list_replacement_candidates

    soldier_a = Person(
        company_id=company_data["company"].id,
        full_name="Sold A",
        role_id=company_data["soldier"].id,
    )
    soldier_b = Person(
        company_id=company_data["company"].id,
        full_name="Sold B",
        role_id=company_data["soldier"].id,
    )
    commander = Person(
        company_id=company_data["company"].id,
        full_name="Cmd Only",
        role_id=company_data["commander"].id,
    )
    db.add_all([soldier_a, soldier_b, commander])
    db.flush()

    mt = MissionType(
        company_id=company_data["company"].id,
        name="חמל",
        difficulty_weight=2,
        default_personnel_count=1,
    )
    db.add(mt)
    db.flush()
    schedule = Schedule(
        company_id=company_data["company"].id,
        window_start=datetime(2026, 9, 15, 0),
        window_end=datetime(2026, 9, 16, 0),
        status=ScheduleStatus.DRAFT,
        created_by_id=company_data["user"].id,
    )
    db.add(schedule)
    db.flush()
    mission = Mission(
        company_id=company_data["company"].id,
        mission_type_id=mt.id,
        name="חמל",
        start_at=datetime(2026, 9, 15, 0),
        end_at=datetime(2026, 9, 15, 8),
        difficulty_weight=2,
        personnel_count=1,
        schedule_id=schedule.id,
    )
    db.add(mission)
    db.flush()
    req = MissionRequirement(
        mission_id=mission.id, role_id=company_data["soldier"].id, count=1
    )
    db.add(req)
    db.flush()
    assignment = Assignment(
        schedule_id=schedule.id,
        mission_id=mission.id,
        person_id=soldier_a.id,
        requirement_id=req.id,
        difficulty_at_assignment=2,
    )
    db.add(assignment)
    other = Mission(
        company_id=company_data["company"].id,
        mission_type_id=mt.id,
        name="אחר",
        start_at=datetime(2026, 9, 15, 4),
        end_at=datetime(2026, 9, 15, 12),
        difficulty_weight=2,
        personnel_count=1,
        schedule_id=schedule.id,
    )
    db.add(other)
    db.flush()
    db.add(
        Assignment(
            schedule_id=schedule.id,
            mission_id=other.id,
            person_id=soldier_b.id,
            difficulty_at_assignment=2,
        )
    )
    db.commit()

    candidates = list_replacement_candidates(db, schedule, assignment.id)
    names = {p.full_name for p, _ in candidates}
    assert "Sold A" not in names
    assert "Sold B" not in names
    assert "Cmd Only" in names


def test_prefer_soldier_over_commander_for_soldier_slot(db, company_data):
    """Do not waste commanders on slots that a soldier can fill."""
    soldier = Person(
        company_id=company_data["company"].id,
        full_name="חייל זמין",
        role_id=company_data["soldier"].id,
    )
    commander = Person(
        company_id=company_data["company"].id,
        full_name="מפקד זמין",
        role_id=company_data["commander"].id,
    )
    db.add_all([soldier, commander])
    db.flush()

    mt = MissionType(
        company_id=company_data["company"].id,
        name="ש״ג",
        difficulty_weight=2,
        default_personnel_count=1,
    )
    db.add(mt)
    db.flush()
    schedule = Schedule(
        company_id=company_data["company"].id,
        window_start=datetime(2026, 9, 20, 0),
        window_end=datetime(2026, 9, 21, 0),
        status=ScheduleStatus.DRAFT,
        created_by_id=company_data["user"].id,
    )
    db.add(schedule)
    db.flush()
    mission = Mission(
        company_id=company_data["company"].id,
        mission_type_id=mt.id,
        name="ש״ג",
        start_at=datetime(2026, 9, 20, 8),
        end_at=datetime(2026, 9, 20, 12),
        difficulty_weight=2,
        personnel_count=1,
        schedule_id=schedule.id,
    )
    db.add(mission)
    db.flush()
    db.add(
        MissionRequirement(
            mission_id=mission.id, role_id=company_data["soldier"].id, count=1
        )
    )
    db.commit()

    result = generate_schedule(db, schedule, company_data["user"].id)
    db.commit()
    assert result.status in ("success", "success_with_warnings")
    assigned_ids = [a.person_id for a in result.schedule.assignments]
    assert assigned_ids == [soldier.id]


def test_prefer_soldier_on_open_qualification_slot(db, company_data):
    """Qualification-only slots should prefer soldiers when both have the פק״ל."""
    medic = company_data["medic"]
    soldier = Person(
        company_id=company_data["company"].id,
        full_name="חייל חובש",
        role_id=company_data["soldier"].id,
    )
    commander = Person(
        company_id=company_data["company"].id,
        full_name="מפקד חובש",
        role_id=company_data["commander"].id,
    )
    db.add_all([soldier, commander])
    db.flush()
    db.add(PersonQualification(person_id=soldier.id, qualification_id=medic.id))
    db.add(PersonQualification(person_id=commander.id, qualification_id=medic.id))
    db.flush()

    mt = MissionType(
        company_id=company_data["company"].id,
        name="פינוי",
        difficulty_weight=3,
        default_personnel_count=1,
    )
    db.add(mt)
    db.flush()
    schedule = Schedule(
        company_id=company_data["company"].id,
        window_start=datetime(2026, 9, 21, 0),
        window_end=datetime(2026, 9, 22, 0),
        status=ScheduleStatus.DRAFT,
        created_by_id=company_data["user"].id,
    )
    db.add(schedule)
    db.flush()
    mission = Mission(
        company_id=company_data["company"].id,
        mission_type_id=mt.id,
        name="פינוי",
        start_at=datetime(2026, 9, 21, 10),
        end_at=datetime(2026, 9, 21, 14),
        difficulty_weight=3,
        personnel_count=1,
        schedule_id=schedule.id,
    )
    db.add(mission)
    db.flush()
    db.add(
        MissionRequirement(mission_id=mission.id, qualification_id=medic.id, count=1)
    )
    db.commit()

    result = generate_schedule(db, schedule, company_data["user"].id)
    db.commit()
    assigned_ids = [a.person_id for a in result.schedule.assignments]
    assert assigned_ids == [soldier.id]
