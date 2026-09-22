"""Person labels (תוויות) — max 3 columns, assign to people."""

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app


def _client():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    return TestClient(app), engine


def _register(client: TestClient, email: str = "cmd@example.com"):
    res = client.post(
        "/api/auth/register",
        json={
            "email": email,
            "password": "password1",
            "full_name": "מפקד",
            "company_name": "פלוגה א",
        },
    )
    assert res.status_code == 200, res.text
    token = res.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_person_labels_crud_and_assign():
    client, engine = _client()
    try:
        headers = _register(client)

        # Create label with options
        res = client.post(
            "/api/person-labels",
            headers=headers,
            json={
                "name": "מחלקה",
                "selection_mode": "single",
                "options": [
                    {"name": "א", "sort_order": 0},
                    {"name": "ב", "sort_order": 1},
                ],
            },
        )
        assert res.status_code == 200, res.text
        label = res.json()
        assert label["name"] == "מחלקה"
        assert label["selection_mode"] == "single"
        assert len(label["options"]) == 2
        opt_a = next(o for o in label["options"] if o["name"] == "א")

        # Max 3
        for i, name in enumerate(["כיתה", "צוות"], start=1):
            r = client.post(
                "/api/person-labels",
                headers=headers,
                json={"name": name, "selection_mode": "multi", "options": [{"name": "1"}]},
            )
            assert r.status_code == 200, r.text
        r = client.post(
            "/api/person-labels",
            headers=headers,
            json={"name": "עוד", "selection_mode": "single", "options": []},
        )
        assert r.status_code == 400

        roles = client.get("/api/roles", headers=headers).json()
        role_id = roles[0]["id"]

        # Create person with label
        res = client.post(
            "/api/people",
            headers=headers,
            json={
                "full_name": "ישראל ישראלי",
                "role_id": role_id,
                "label_values": [
                    {"label_id": label["id"], "option_ids": [opt_a["id"]]}
                ],
            },
        )
        assert res.status_code == 200, res.text
        person = res.json()
        assert person["label_values"]
        assert person["label_values"][0]["option_ids"] == [opt_a["id"]]
        assert "א" in person["label_values"][0]["option_names"]

        # Single mode rejects multi
        opt_b = next(o for o in label["options"] if o["name"] == "ב")
        res = client.put(
            f"/api/people/{person['id']}",
            headers=headers,
            json={
                "label_values": [
                    {
                        "label_id": label["id"],
                        "option_ids": [opt_a["id"], opt_b["id"]],
                    }
                ]
            },
        )
        assert res.status_code == 400

        # List includes labels
        listed = client.get("/api/person-labels", headers=headers).json()
        assert len(listed) == 3
    finally:
        app.dependency_overrides.clear()
        engine.dispose()
