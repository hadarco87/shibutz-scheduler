"""Company invite / multi-user platoon access."""

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


def test_invite_joins_same_company(client):
    owner = client.post(
        "/api/auth/register",
        json={
            "email": "owner@pluga.example.com",
            "password": "password1",
            "full_name": "מפקד בעלים",
            "company_name": "פלוגה משותפת",
        },
    )
    assert owner.status_code == 200, owner.text
    owner_token = owner.json()["access_token"]
    headers = {"Authorization": f"Bearer {owner_token}"}

    me_owner = client.get("/api/auth/me", headers=headers)
    assert me_owner.status_code == 200
    company_id = me_owner.json()["company_id"]

    invite = client.post(
        "/api/company/invites",
        headers=headers,
        json={"email": "mate@pluga.example.com"},
    )
    assert invite.status_code == 200, invite.text
    token = invite.json()["token"]
    assert invite.json()["email"] == "mate@pluga.example.com"

    preview = client.get(f"/api/auth/invite/{token}")
    assert preview.status_code == 200
    assert preview.json()["company_name"] == "פלוגה משותפת"
    assert preview.json()["email"] == "mate@pluga.example.com"

    joined = client.post(
        "/api/auth/register-invite",
        json={
            "token": token,
            "email": "mate@pluga.example.com",
            "password": "password2",
            "full_name": "מפקד שותף",
        },
    )
    assert joined.status_code == 200, joined.text
    mate_token = joined.json()["access_token"]

    me_mate = client.get(
        "/api/auth/me", headers={"Authorization": f"Bearer {mate_token}"}
    )
    assert me_mate.status_code == 200
    assert me_mate.json()["company_id"] == company_id
    assert me_mate.json()["role"] == "commander"

    members = client.get("/api/company/members", headers=headers)
    assert members.status_code == 200
    emails = {m["email"] for m in members.json()}
    assert emails == {"owner@pluga.example.com", "mate@pluga.example.com"}

    # Mate can also invite
    invite2 = client.post(
        "/api/company/invites",
        headers={"Authorization": f"Bearer {mate_token}"},
        json={"email": "third@pluga.example.com"},
    )
    assert invite2.status_code == 200, invite2.text
