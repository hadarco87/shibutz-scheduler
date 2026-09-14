"""Self-registration and tenant isolation smoke tests."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app


@pytest.fixture()
def client():
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
        yield c
    app.dependency_overrides.clear()


def test_register_creates_isolated_company(client):
    r1 = client.post(
        "/api/auth/register",
        json={
            "email": "a@pluga1.com",
            "password": "password1",
            "full_name": "מפקד א",
            "company_name": "פלוגה א",
        },
    )
    assert r1.status_code == 200, r1.text
    token_a = r1.json()["access_token"]

    r2 = client.post(
        "/api/auth/register",
        json={
            "email": "b@pluga2.com",
            "password": "password2",
            "full_name": "מפקד ב",
            "company_name": "פלוגה ב",
        },
    )
    assert r2.status_code == 200
    token_b = r2.json()["access_token"]

    me_a = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token_a}"})
    me_b = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token_b}"})
    assert me_a.status_code == 200
    assert me_b.status_code == 200
    assert me_a.json()["company_id"] != me_b.json()["company_id"]
    assert me_a.json()["company_name"] == "פלוגה א"
    assert me_b.json()["company_name"] == "פלוגה ב"

    # A creates a person; B must not see it
    roles_a = client.get("/api/roles", headers={"Authorization": f"Bearer {token_a}"})
    assert roles_a.status_code == 200
    role_id = roles_a.json()[0]["id"]
    created = client.post(
        "/api/people",
        headers={"Authorization": f"Bearer {token_a}"},
        json={"full_name": "חייל סודי", "role_id": role_id},
    )
    assert created.status_code == 200

    people_b = client.get("/api/people", headers={"Authorization": f"Bearer {token_b}"})
    assert people_b.status_code == 200
    assert all(p["full_name"] != "חייל סודי" for p in people_b.json())

    people_a = client.get("/api/people", headers={"Authorization": f"Bearer {token_a}"})
    assert any(p["full_name"] == "חייל סודי" for p in people_a.json())


def test_register_duplicate_email(client):
    body = {
        "email": "same@example.com",
        "password": "password1",
        "full_name": "אחד",
        "company_name": "פלוגה",
    }
    assert client.post("/api/auth/register", json=body).status_code == 200
    again = client.post("/api/auth/register", json={**body, "company_name": "אחרת"})
    assert again.status_code == 400


def test_public_schedule_requires_token(client):
    # Without token query param → validation error
    res = client.get("/api/schedules/public/1")
    assert res.status_code == 422
