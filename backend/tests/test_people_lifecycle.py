"""Suspend and hard-delete people."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app.services.validation import load_people


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


def _auth_and_person(client: TestClient):
    reg = client.post(
        "/api/auth/register",
        json={
            "email": "cmd@pluga.example.com",
            "password": "password1",
            "full_name": "מפקד",
            "company_name": "פלוגה בדיקה",
        },
    )
    assert reg.status_code == 200, reg.text
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    roles = client.get("/api/roles", headers=headers)
    role_id = roles.json()[0]["id"]
    created = client.post(
        "/api/people",
        headers=headers,
        json={"full_name": "חייל לבדיקה", "role_id": role_id},
    )
    assert created.status_code == 200, created.text
    return headers, created.json()


def test_suspend_excludes_from_scheduling_pool(client_and_db):
    client, SessionLocal = client_and_db
    headers, person = _auth_and_person(client)
    person_id = person["id"]
    company_id = person["company_id"]

    upd = client.put(
        f"/api/people/{person_id}",
        headers=headers,
        json={"is_active": False},
    )
    assert upd.status_code == 200
    assert upd.json()["is_active"] is False

    db = SessionLocal()
    try:
        active = load_people(db, company_id)
        assert all(p.id != person_id for p in active)
    finally:
        db.close()

    reactivate = client.put(
        f"/api/people/{person_id}",
        headers=headers,
        json={"is_active": True},
    )
    assert reactivate.status_code == 200
    assert reactivate.json()["is_active"] is True


def test_hard_delete_person(client_and_db):
    client, _ = client_and_db
    headers, person = _auth_and_person(client)
    person_id = person["id"]

    deleted = client.delete(f"/api/people/{person_id}", headers=headers)
    assert deleted.status_code == 200, deleted.text
    assert deleted.json()["ok"] is True

    people = client.get("/api/people", headers=headers)
    assert people.status_code == 200
    assert all(p["id"] != person_id for p in people.json())

    missing = client.delete(f"/api/people/{person_id}", headers=headers)
    assert missing.status_code == 404
