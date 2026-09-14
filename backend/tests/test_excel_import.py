"""Excel people import — flexible column detection."""

from pathlib import Path

import pytest
from openpyxl import Workbook
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import Company, Role, RoleCapability, User, UserRole
from app.security import get_password_hash
from app.services.excel_import import apply_people_import, parse_people_workbook


SAMPLE = Path(
    "/Users/hadarcohen/Downloads/מי עמי - לוח יציאות מעודכן בהכל להשתמש בזה ורק בזה עם מאקרו.xlsm"
)


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
    company = Company(name="פלוגה ב")
    session.add(company)
    session.flush()
    soldier = Role(company_id=company.id, name="חייל")
    commander = Role(company_id=company.id, name="מפקד")
    nco = Role(company_id=company.id, name="מפקד זוטר")
    session.add_all([soldier, commander, nco])
    session.flush()
    for r in (soldier, commander, nco):
        session.add(RoleCapability(role_id=r.id, can_fulfill_role_id=soldier.id))
    session.add(
        User(
            company_id=company.id,
            email="imp@test.com",
            full_name="Tester",
            hashed_password=get_password_hash("pass"),
            role=UserRole.COMMANDER,
        )
    )
    session.commit()
    try:
        yield session, company.id
    finally:
        session.close()


def test_parse_minimal_workbook(db):
    session, company_id = db
    wb = Workbook()
    ws = wb.active
    ws.title = "כוח אדם"
    ws.append(["מספר אישי", "שם פרטי", "שם משפחה", "טלפון", 'פק"ל', "מחלקה"])
    ws.append([12345, "ישראל", "ישראלי", "050-1111111", "חובש / קלע", "מחלקה 1"])
    ws.append([67890, "דנה", "כהן", "052-2222222", "מפקד", "מפקדת פלוגה"])
    buf = __import__("io").BytesIO()
    wb.save(buf)
    parsed = parse_people_workbook(buf.getvalue())
    assert parsed.sheet_name == "כוח אדם"
    assert len(parsed.rows) == 2
    assert parsed.rows[0].full_name == "ישראל ישראלי"
    assert "חובש" in parsed.rows[0].qualification_names
    assert parsed.rows[1].role_name == "מפקד"

    rows, created, updated, *_ = apply_people_import(
        session, company_id, parsed, commit=True
    )
    assert created == 2
    assert updated == 0
    # second import updates
    _, created2, updated2, *_ = apply_people_import(
        session, company_id, parsed, commit=True
    )
    assert created2 == 0
    assert updated2 == 2


@pytest.mark.skipif(not SAMPLE.exists(), reason="sample xlsm not on disk")
def test_parse_real_sample_sheet():
    data = SAMPLE.read_bytes()
    parsed = parse_people_workbook(data)
    assert "מתוכנן" in parsed.sheet_name or parsed.sheet_name.startswith("לוח")
    assert "personal_number" in parsed.column_mapping or "first_name" in parsed.column_mapping
    assert len(parsed.rows) >= 20
    with_pn = sum(1 for r in parsed.rows if r.personal_number)
    assert with_pn >= 10
    with_qual = sum(1 for r in parsed.rows if r.qualification_names)
    assert with_qual >= 5
