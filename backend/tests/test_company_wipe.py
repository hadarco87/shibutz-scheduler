"""Company multi-layer wipe endpoint."""

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
    Mission,
    MissionType,
    Person,
    Role,
    Schedule,
    SchedulePlan,
    ScheduleStatus,
    User,
    WorkloadEvent,
)


@pytest.fixture()
def client_and_db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSession = sessionmaker(bind=engine)
    Base.metadata.create_all(bind=engine)

    def override_get_db():
        session = TestingSession()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c, TestingSession
    app.dependency_overrides.clear()


def _register(client: TestClient):
    reg = client.post(
        "/api/auth/register",
        json={
            "email": "wipe@pluga.example.com",
            "password": "password1",
            "full_name": "מפקד",
            "company_name": "פלוגה מחיקה",
        },
    )
    assert reg.status_code == 200, reg.text
    token = reg.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_wipe_requires_at_least_one_layer(client_and_db):
    client, _ = client_and_db
    headers = _register(client)
    res = client.post(
        "/api/company/wipe",
        headers=headers,
        json={"operational": False, "catalog": False, "people": False},
    )
    assert res.status_code == 400


def test_wipe_operational_keeps_people_and_catalog(client_and_db):
    client, SessionLocal = client_and_db
    headers = _register(client)

    roles = client.get("/api/roles", headers=headers).json()
    role_id = roles[0]["id"]
    person = client.post(
        "/api/people",
        headers=headers,
        json={"full_name": "חייל", "role_id": role_id},
    ).json()
    mt = client.post(
        "/api/mission-types",
        headers=headers,
        json={"name": "סיור", "difficulty_weight": 2},
    ).json()
    mt_id = mt["id"]

    db = SessionLocal()
    try:
        company_id = person["company_id"]
        plan = SchedulePlan(
            company_id=company_id,
            start_date=datetime.utcnow().date(),
            days_count=1,
            status=ScheduleStatus.DRAFT,
        )
        db.add(plan)
        db.flush()
        start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        schedule = Schedule(
            company_id=company_id,
            plan_id=plan.id,
            day_index=0,
            window_start=start,
            window_end=start + timedelta(days=1),
            status=ScheduleStatus.DRAFT,
        )
        db.add(schedule)
        db.flush()
        mission = Mission(
            company_id=company_id,
            mission_type_id=mt_id,
            name="סיור",
            start_at=start,
            end_at=start + timedelta(hours=4),
            difficulty_weight=2,
            personnel_count=1,
            schedule_id=schedule.id,
        )
        db.add(mission)
        db.flush()
        assignment = Assignment(
            schedule_id=schedule.id,
            mission_id=mission.id,
            person_id=person["id"],
            difficulty_at_assignment=2,
        )
        db.add(assignment)
        db.flush()
        db.add(
            WorkloadEvent(
                company_id=company_id,
                person_id=person["id"],
                schedule_id=schedule.id,
                assignment_id=assignment.id,
                mission_id=mission.id,
                mission_type_id=mt_id,
                difficulty_weight=2,
                delta=8.0,
            )
        )
        db.commit()
    finally:
        db.close()

    res = client.post(
        "/api/company/wipe",
        headers=headers,
        json={"operational": True, "catalog": False, "people": False},
    )
    assert res.status_code == 200, res.text

    db = SessionLocal()
    try:
        company_id = person["company_id"]
        assert db.query(Schedule).filter(Schedule.company_id == company_id).count() == 0
        assert db.query(Mission).filter(Mission.company_id == company_id).count() == 0
        assert db.query(Assignment).count() == 0
        assert db.query(WorkloadEvent).filter(WorkloadEvent.company_id == company_id).count() == 0
        assert db.query(Person).filter(Person.company_id == company_id).count() == 1
        assert db.query(MissionType).filter(MissionType.company_id == company_id).count() >= 1
        assert db.query(Role).filter(Role.company_id == company_id).count() >= 1
        assert db.query(User).filter(User.company_id == company_id).count() >= 1
    finally:
        db.close()


def test_wipe_people_and_catalog_keeps_users(client_and_db):
    client, SessionLocal = client_and_db
    headers = _register(client)
    roles = client.get("/api/roles", headers=headers).json()
    role_id = roles[0]["id"]
    person = client.post(
        "/api/people",
        headers=headers,
        json={"full_name": "חייל", "role_id": role_id},
    ).json()
    company_id = person["company_id"]

    res = client.post(
        "/api/company/wipe",
        headers=headers,
        json={"operational": False, "catalog": True, "people": True},
    )
    assert res.status_code == 200, res.text

    db = SessionLocal()
    try:
        assert db.query(Person).filter(Person.company_id == company_id).count() == 0
        assert db.query(MissionType).filter(MissionType.company_id == company_id).count() == 0
        assert db.query(Role).filter(Role.company_id == company_id).count() == 0
        assert db.query(User).filter(User.company_id == company_id).count() >= 1
    finally:
        db.close()
