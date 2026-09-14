"""Bootstrap a new empty company (platoon) with minimal starter config."""

from sqlalchemy.orm import Session

from app.models import (
    Company,
    ConstraintSeverity,
    ConstraintType,
    Qualification,
    Role,
    RoleCapability,
    SchedulingConstraint,
    User,
    UserRole,
)
from app.security import get_password_hash


def bootstrap_company(
    db: Session,
    *,
    company_name: str,
    email: str,
    password: str,
    full_name: str,
) -> User:
    """Create company + commander user + starter roles/constraints. Returns the user."""
    company = Company(name=company_name.strip())
    db.add(company)
    db.flush()

    soldier = Role(company_id=company.id, name="חייל", description="חייל מן השורה")
    commander = Role(company_id=company.id, name="מפקד", description="מפקד משימה")
    nco = Role(company_id=company.id, name="מפקד זוטר", description="מש״ק")
    db.add_all([soldier, commander, nco])
    db.flush()

    for role in (soldier, commander, nco):
        db.add(RoleCapability(role_id=role.id, can_fulfill_role_id=soldier.id))
    db.add(RoleCapability(role_id=commander.id, can_fulfill_role_id=commander.id))
    db.add(RoleCapability(role_id=nco.id, can_fulfill_role_id=nco.id))
    db.add(RoleCapability(role_id=commander.id, can_fulfill_role_id=nco.id))
    db.add(RoleCapability(role_id=nco.id, can_fulfill_role_id=commander.id))

    db.add(Qualification(company_id=company.id, name="חובש"))
    db.add(Qualification(company_id=company.id, name="קשר"))

    db.add(
        SchedulingConstraint(
            company_id=company.id,
            name="מנוחה מינימלית",
            constraint_type=ConstraintType.MINIMUM_REST,
            severity=ConstraintSeverity.HARD,
            value=6.0,
            description="לפחות 6 שעות מנוחה לפני משימה",
        )
    )
    db.add(
        SchedulingConstraint(
            company_id=company.id,
            name="הוגנות עומס",
            constraint_type=ConstraintType.WORKLOAD_FAIRNESS,
            severity=ConstraintSeverity.SOFT,
            weight=1.0,
            description="העדפת חיילים עם עומס היסטורי נמוך יותר",
        )
    )

    user = User(
        company_id=company.id,
        email=email.strip().lower(),
        full_name=full_name.strip(),
        hashed_password=get_password_hash(password),
        role=UserRole.COMMANDER,
    )
    db.add(user)
    db.flush()
    return user
