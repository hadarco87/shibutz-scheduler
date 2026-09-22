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


def test_people_bulk_update():
    client, engine = _client()
    try:
        headers = _register(client, "bulk@example.com")
        roles = client.get("/api/roles", headers=headers).json()
        role_soldier = next(r for r in roles if r["name"] == "חייל")
        role_cmd = next(r for r in roles if r["name"] == "מפקד")

        quals = client.get("/api/qualifications", headers=headers).json()
        q = next((x for x in quals if x["name"] == "חובש"), None)
        if not q:
            q = client.post(
                "/api/qualifications",
                headers=headers,
                json={"name": "חובש-בדיקה"},
            ).json()

        label = client.post(
            "/api/person-labels",
            headers=headers,
            json={
                "name": "מחלקה",
                "selection_mode": "single",
                "options": [{"name": "א"}, {"name": "ב"}],
            },
        ).json()
        opt_a = next(o for o in label["options"] if o["name"] == "א")

        ids = []
        for name in ("אחד", "שתיים", "שלוש"):
            p = client.post(
                "/api/people",
                headers=headers,
                json={"full_name": name, "role_id": role_soldier["id"]},
            ).json()
            ids.append(p["id"])

        res = client.post(
            "/api/people/bulk",
            headers=headers,
            json={
                "person_ids": ids,
                "role_id": role_cmd["id"],
                "add_qualification_ids": [q["id"]],
                "label_value": {"label_id": label["id"], "option_ids": [opt_a["id"]]},
            },
        )
        assert res.status_code == 200, res.text
        assert res.json()["updated"] == 3

        people = client.get("/api/people", headers=headers).json()
        by_id = {p["id"]: p for p in people}
        for pid in ids:
            assert by_id[pid]["role_id"] == role_cmd["id"]
            assert q["id"] in by_id[pid]["qualification_ids"]
            assert by_id[pid]["label_values"][0]["option_ids"] == [opt_a["id"]]

        res = client.post(
            "/api/people/bulk",
            headers=headers,
            json={
                "person_ids": ids[:2],
                "remove_qualification_ids": [q["id"]],
            },
        )
        assert res.status_code == 200
        people = client.get("/api/people", headers=headers).json()
        by_id = {p["id"]: p for p in people}
        assert q["id"] not in by_id[ids[0]]["qualification_ids"]
        assert q["id"] in by_id[ids[2]]["qualification_ids"]
    finally:
        app.dependency_overrides.clear()
        engine.dispose()
