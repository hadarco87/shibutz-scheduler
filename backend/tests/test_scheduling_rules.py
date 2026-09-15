"""Scheduling transition rules (cooldown between mission types)."""

from datetime import datetime, timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import (
    Assignment,
    Company,
    ConstraintSeverity,
    Mission,
    MissionType,
    Person,
    Role,
    RoleCapability,
    Schedule,
    ScheduleStatus,
    SchedulingRule,
    SchedulingRuleBlockedType,
    SchedulingRuleSourceType,
    User,
    UserRole,
)
from app.security import get_password_hash
from app.services.policy_rules import evaluate_scheduling_rules
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
    company = Company(name="Rules Co")
    db.add(company)
    db.flush()
    soldier = Role(company_id=company.id, name="חייל")
    db.add(soldier)
    db.flush()
    db.add(RoleCapability(role_id=soldier.id, can_fulfill_role_id=soldier.id))
    user = User(
        company_id=company.id,
        email="rules@test.com",
        full_name="Rules",
        hashed_password=get_password_hash("pass"),
        role=UserRole.COMMANDER,
    )
    db.add(user)
    person = Person(
        company_id=company.id,
        full_name="Soldier 1",
        role_id=soldier.id,
        is_active=True,
    )
    db.add(person)
    gate = MissionType(
        company_id=company.id, name='ש"ג', difficulty_weight=2.0, is_active=True
    )
    patrol = MissionType(
        company_id=company.id, name="סיור", difficulty_weight=3.0, is_active=True
    )
    db.add_all([gate, patrol])
    db.flush()
    return {
        "company": company,
        "soldier": soldier,
        "person": person,
        "gate": gate,
        "patrol": patrol,
    }


def test_hard_rule_blocks_mission_within_cooldown(db, company_data):
    company = company_data["company"]
    person = company_data["person"]
    gate = company_data["gate"]
    patrol = company_data["patrol"]

    rule = SchedulingRule(
        company_id=company.id,
        min_source_hours=8,
        cooldown_hours=8,
        severity=ConstraintSeverity.HARD,
        applies_to_all_roles=True,
        is_active=True,
    )
    db.add(rule)
    db.flush()
    db.add(SchedulingRuleSourceType(rule_id=rule.id, mission_type_id=gate.id))
    db.add(SchedulingRuleBlockedType(rule_id=rule.id, mission_type_id=patrol.id))

    day1 = Schedule(
        company_id=company.id,
        window_start=datetime(2026, 9, 17, 0, 0),
        window_end=datetime(2026, 9, 18, 0, 0),
        status=ScheduleStatus.PUBLISHED,
    )
    day2 = Schedule(
        company_id=company.id,
        window_start=datetime(2026, 9, 18, 0, 0),
        window_end=datetime(2026, 9, 19, 0, 0),
        status=ScheduleStatus.DRAFT,
    )
    db.add_all([day1, day2])
    db.flush()

    prior = Mission(
        company_id=company.id,
        schedule_id=day1.id,
        mission_type_id=gate.id,
        name='ש"ג',
        start_at=datetime(2026, 9, 17, 16, 0),
        end_at=datetime(2026, 9, 18, 0, 0),
        difficulty_weight=2,
        personnel_count=1,
    )
    nxt = Mission(
        company_id=company.id,
        schedule_id=day2.id,
        mission_type_id=patrol.id,
        name="סיור",
        start_at=datetime(2026, 9, 18, 4, 0),
        end_at=datetime(2026, 9, 18, 8, 0),
        difficulty_weight=3,
        personnel_count=1,
    )
    db.add_all([prior, nxt])
    db.flush()
    db.add(
        Assignment(
            schedule_id=day1.id,
            mission_id=prior.id,
            person_id=person.id,
            difficulty_at_assignment=2,
            is_manual=False,
        )
    )
    db.flush()

    violations = evaluate_scheduling_rules(
        db,
        company_id=company.id,
        person=person,
        mission=nxt,
        existing_assignments=[],
        missions_by_id={},
    )
    assert any(v.code == "scheduling_rule" and v.severity == "hard" for v in violations)

    result = validate_assignment(
        db,
        company_id=company.id,
        person=person,
        mission=nxt,
        existing_assignments=[],
        missions_by_id={nxt.id: nxt},
    )
    assert not result.ok
    assert any(v.code == "scheduling_rule" for v in result.hard_violations)


def test_rule_allows_after_cooldown(db, company_data):
    company = company_data["company"]
    person = company_data["person"]
    gate = company_data["gate"]
    patrol = company_data["patrol"]

    rule = SchedulingRule(
        company_id=company.id,
        min_source_hours=8,
        cooldown_hours=8,
        severity=ConstraintSeverity.HARD,
        applies_to_all_roles=True,
        is_active=True,
    )
    db.add(rule)
    db.flush()
    db.add(SchedulingRuleSourceType(rule_id=rule.id, mission_type_id=gate.id))
    db.add(SchedulingRuleBlockedType(rule_id=rule.id, mission_type_id=patrol.id))

    day1 = Schedule(
        company_id=company.id,
        window_start=datetime(2026, 9, 17, 0, 0),
        window_end=datetime(2026, 9, 18, 0, 0),
        status=ScheduleStatus.PUBLISHED,
    )
    db.add(day1)
    db.flush()
    prior = Mission(
        company_id=company.id,
        schedule_id=day1.id,
        mission_type_id=gate.id,
        name='ש"ג',
        start_at=datetime(2026, 9, 17, 8, 0),
        end_at=datetime(2026, 9, 17, 16, 0),
        difficulty_weight=2,
        personnel_count=1,
    )
    nxt = Mission(
        company_id=company.id,
        schedule_id=day1.id,
        mission_type_id=patrol.id,
        name="סיור",
        start_at=datetime(2026, 9, 18, 1, 0),
        end_at=datetime(2026, 9, 18, 5, 0),
        difficulty_weight=3,
        personnel_count=1,
    )
    db.add_all([prior, nxt])
    db.flush()
    db.add(
        Assignment(
            schedule_id=day1.id,
            mission_id=prior.id,
            person_id=person.id,
            difficulty_at_assignment=2,
            is_manual=False,
        )
    )
    db.flush()

    violations = evaluate_scheduling_rules(
        db,
        company_id=company.id,
        person=person,
        mission=nxt,
        existing_assignments=[],
        missions_by_id={},
    )
    assert violations == []


def test_min_presence_not_at_home(db, company_data):
    from app.models import (
        PersonQualification,
        PresenceScope,
        Qualification,
        SchedulingRuleKind,
        SchedulingRuleQualification,
    )
    from app.services.policy_rules import evaluate_min_presence_rules

    company = company_data["company"]
    person = company_data["person"]
    medic_qual = Qualification(company_id=company.id, name="חובש")
    db.add(medic_qual)
    db.flush()
    db.add(
        PersonQualification(person_id=person.id, qualification_id=medic_qual.id)
    )
    other = Person(
        company_id=company.id,
        full_name="Soldier 2",
        role_id=company_data["soldier"].id,
        is_active=True,
    )
    db.add(other)
    db.flush()
    db.add(
        PersonQualification(person_id=other.id, qualification_id=medic_qual.id)
    )

    rule = SchedulingRule(
        company_id=company.id,
        rule_kind=SchedulingRuleKind.MIN_PRESENCE,
        min_count=1,
        presence_scope=PresenceScope.NOT_AT_HOME,
        severity=ConstraintSeverity.HARD,
        applies_to_all_roles=True,
        is_active=True,
    )
    db.add(rule)
    db.flush()
    db.add(
        SchedulingRuleQualification(
            rule_id=rule.id, qualification_id=medic_qual.id
        )
    )

    schedule = Schedule(
        company_id=company.id,
        window_start=datetime(2026, 9, 18, 0, 0),
        window_end=datetime(2026, 9, 19, 0, 0),
        status=ScheduleStatus.DRAFT,
    )
    db.add(schedule)
    db.flush()

    assert evaluate_min_presence_rules(db, schedule=schedule) == []

    bad = evaluate_min_presence_rules(
        db,
        schedule=schedule,
        provisional_afters=[
            (person.id, datetime(2026, 9, 18, 0, 0), datetime(2026, 9, 18, 8, 0)),
            (other.id, datetime(2026, 9, 18, 0, 0), datetime(2026, 9, 18, 8, 0)),
        ],
    )
    assert any(v.code == "min_presence" and v.severity == "hard" for v in bad)

    fine = evaluate_min_presence_rules(
        db,
        schedule=schedule,
        provisional_afters=[
            (person.id, datetime(2026, 9, 18, 0, 0), datetime(2026, 9, 18, 8, 0)),
        ],
    )
    assert fine == []
