"""Shared validation used by auto-scheduling, manual edits, and publish.

GENERATE != COMMIT — this module never writes workload events.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Dict, Iterable, List, Optional, Set

from sqlalchemy.orm import Session, joinedload

from app.models import (
    Assignment,
    ConstraintType,
    LeavePeriod,
    Mission,
    Person,
    Qualification,
    Restriction,
    Role,
    RoleCapability,
    Schedule,
    SchedulingConstraint,
)
from app.services.recurrence import blocking_recurring_restriction


@dataclass
class Violation:
    severity: str
    code: str
    message: str
    mission_id: Optional[int] = None
    person_id: Optional[int] = None
    details: Optional[dict] = None


@dataclass
class ValidationResult:
    ok: bool
    violations: List[Violation] = field(default_factory=list)

    @property
    def hard_violations(self) -> List[Violation]:
        return [v for v in self.violations if v.severity == "hard"]

    @property
    def soft_violations(self) -> List[Violation]:
        return [v for v in self.violations if v.severity == "soft"]


def intervals_overlap(a_start: datetime, a_end: datetime, b_start: datetime, b_end: datetime) -> bool:
    return a_start < b_end and b_start < a_end


def get_min_rest_hours(db: Session, company_id: int, default: float = 6.0) -> float:
    rule = (
        db.query(SchedulingConstraint)
        .filter(
            SchedulingConstraint.company_id == company_id,
            SchedulingConstraint.constraint_type == ConstraintType.MINIMUM_REST,
            SchedulingConstraint.is_active.is_(True),
        )
        .first()
    )
    if rule and rule.value is not None:
        return float(rule.value)
    return default


def role_can_fulfill(db: Session, person_role_id: int, required_role_id: int) -> bool:
    if person_role_id == required_role_id:
        return True
    cap = (
        db.query(RoleCapability)
        .filter(
            RoleCapability.role_id == person_role_id,
            RoleCapability.can_fulfill_role_id == required_role_id,
        )
        .first()
    )
    return cap is not None


def person_qualification_ids(person: Person) -> Set[int]:
    return {pq.qualification_id for pq in person.qualifications}


def person_allowed_mission_type_ids(person: Person) -> Set[int]:
    return {row.mission_type_id for row in person.allowed_mission_types}


def is_on_leave(person: Person, start: datetime, end: datetime) -> Optional[LeavePeriod]:
    for leave in person.leave_periods:
        if intervals_overlap(leave.start_at, leave.end_at, start, end):
            return leave
    return None


def blocking_restriction(
    person: Person,
    mission: Mission,
    start: datetime,
    end: datetime,
) -> Optional[Restriction]:
    for r in person.restrictions:
        if not intervals_overlap(r.start_at, r.end_at, start, end):
            continue
        if r.unavailable and r.mission_type_id is None and r.qualification_id is None:
            return r
        if r.mission_type_id and r.mission_type_id == mission.mission_type_id:
            return r
        if r.qualification_id:
            req_quals = {
                req.qualification_id
                for req in mission.requirements
                if req.qualification_id
            }
            if r.qualification_id in req_quals:
                return r
    return None


def rest_before_mission(
    person_id: int,
    mission_start: datetime,
    assignments: Iterable[Assignment],
    missions_by_id: Dict[int, Mission],
) -> Optional[timedelta]:
    prior_ends = []
    for a in assignments:
        if a.person_id != person_id:
            continue
        m = missions_by_id.get(a.mission_id)
        if not m:
            continue
        if m.end_at <= mission_start:
            prior_ends.append(m.end_at)
    if not prior_ends:
        return None
    last_end = max(prior_ends)
    return mission_start - last_end


def load_people(db: Session, company_id: int) -> List[Person]:
    return (
        db.query(Person)
        .options(
            joinedload(Person.qualifications),
            joinedload(Person.leave_periods),
            joinedload(Person.restrictions),
            joinedload(Person.recurring_restrictions),
            joinedload(Person.allowed_mission_types),
            joinedload(Person.role).joinedload(Role.can_fulfill),
        )
        .filter(Person.company_id == company_id, Person.is_active.is_(True))
        .all()
    )


def validate_assignment(
    db: Session,
    *,
    company_id: int,
    person: Person,
    mission: Mission,
    existing_assignments: List[Assignment],
    missions_by_id: Dict[int, Mission],
    required_role_id: Optional[int] = None,
    required_qualification_id: Optional[int] = None,
    allow_override: bool = False,
    override_reason: Optional[str] = None,
) -> ValidationResult:
    violations: List[Violation] = []

    if not person.is_active:
        violations.append(
            Violation("hard", "inactive", f"{person.full_name} אינו פעיל", mission.id, person.id)
        )

    leave = is_on_leave(person, mission.start_at, mission.end_at)
    if leave:
        violations.append(
            Violation(
                "hard",
                "leave",
                f"{person.full_name} בחופשה/היעדרות בתקופת המשימה",
                mission.id,
                person.id,
                {"leave_id": leave.id},
            )
        )

    restriction = blocking_restriction(person, mission, mission.start_at, mission.end_at)
    if restriction:
        violations.append(
            Violation(
                "hard",
                "restriction",
                f"{person.full_name} מוגבל: {restriction.restriction_type}",
                mission.id,
                person.id,
                {"restriction_id": restriction.id},
            )
        )

    req_quals = {
        req.qualification_id
        for req in mission.requirements
        if req.qualification_id
    }
    recurring = blocking_recurring_restriction(
        list(person.recurring_restrictions),
        mission.start_at,
        mission.end_at,
        mission_type_id=mission.mission_type_id,
        required_qualification_ids=req_quals,
    )
    if recurring:
        violations.append(
            Violation(
                "hard",
                "recurring_restriction",
                f"{person.full_name} מוגבל באופן רוטיני: {recurring.restriction_type}",
                mission.id,
                person.id,
                {"recurring_restriction_id": recurring.id, "kind": recurring.kind.value},
            )
        )

    allowed_types = person_allowed_mission_type_ids(person)
    if allowed_types and mission.mission_type_id not in allowed_types:
        violations.append(
            Violation(
                "hard",
                "mission_type_whitelist",
                f"{person.full_name} מורשה רק לסוגי משימות מסוימים — לא לסוג זה",
                mission.id,
                person.id,
                {
                    "mission_type_id": mission.mission_type_id,
                    "allowed_mission_type_ids": list(allowed_types),
                },
            )
        )

    if required_role_id and not role_can_fulfill(db, person.role_id, required_role_id):
        role = db.get(Role, required_role_id)
        role_name = role.name if role else str(required_role_id)
        violations.append(
            Violation(
                "hard",
                "role",
                f"{person.full_name} אינו יכול למלא את התפקיד «{role_name}»",
                mission.id,
                person.id,
                {"required_role_id": required_role_id, "required_role_name": role_name},
            )
        )

    if required_qualification_id:
        if required_qualification_id not in person_qualification_ids(person):
            qual = db.get(Qualification, required_qualification_id)
            qual_name = qual.name if qual else str(required_qualification_id)
            violations.append(
                Violation(
                    "hard",
                    "qualification",
                    f"{person.full_name} חסר פק״ל «{qual_name}»",
                    mission.id,
                    person.id,
                    {
                        "required_qualification_id": required_qualification_id,
                        "required_qualification_name": qual_name,
                    },
                )
            )

    for a in existing_assignments:
        if a.person_id != person.id:
            continue
        other = missions_by_id.get(a.mission_id)
        if not other:
            continue
        if other.id == mission.id:
            violations.append(
                Violation(
                    "hard",
                    "duplicate",
                    f"{person.full_name} כבר משובץ למשימה זו",
                    mission.id,
                    person.id,
                )
            )
            continue
        if intervals_overlap(mission.start_at, mission.end_at, other.start_at, other.end_at):
            violations.append(
                Violation(
                    "hard",
                    "overlap",
                    f"{person.full_name} כבר משובץ במשימה חופפת: {other.name}",
                    mission.id,
                    person.id,
                    {"other_mission_id": other.id},
                )
            )

    min_rest = get_min_rest_hours(db, company_id)
    rest = rest_before_mission(person.id, mission.start_at, existing_assignments, missions_by_id)
    if rest is not None and rest < timedelta(hours=min_rest):
        hours = rest.total_seconds() / 3600
        msg = (
            f"{person.full_name} קיבל רק {hours:.1f} שעות מנוחה לפני המשימה "
            f"(מינימום: {min_rest:.0f} שעות)"
        )
        violations.append(
            Violation(
                "hard",
                "rest",
                msg,
                mission.id,
                person.id,
                {"rest_hours": hours, "min_rest_hours": min_rest},
            )
        )

    if allow_override and override_reason:
        # Commander explicit override: keep violations as soft warnings for audit UX
        for v in violations:
            if v.severity == "hard":
                v.severity = "soft"
                v.message = f"[חריגה מאושרת] {v.message} — סיבה: {override_reason}"
                v.code = f"overridden_{v.code}"

    ok = not any(v.severity == "hard" for v in violations)
    return ValidationResult(ok=ok, violations=violations)


def validate_mission_staffing(
    mission: Mission,
    assignments: List[Assignment],
    people_by_id: Optional[Dict[int, Person]] = None,
    db: Optional[Session] = None,
) -> List[Violation]:
    violations: List[Violation] = []
    assigned = [a for a in assignments if a.mission_id == mission.id]
    if len(assigned) < mission.personnel_count:
        violations.append(
            Violation(
                "hard",
                "understaffed",
                f"משימה {mission.name}: חסרים אנשים ({len(assigned)}/{mission.personnel_count})",
                mission.id,
                details={"have": len(assigned), "need": mission.personnel_count},
            )
        )

    used_assignment_ids: Set[int] = set()
    for req in mission.requirements:
        matching = 0
        for a in assigned:
            if a.id in used_assignment_ids:
                continue
            if a.requirement_id == req.id:
                matching += 1
                used_assignment_ids.add(a.id)
                continue
            if a.requirement_id is None and people_by_id and db:
                person = people_by_id.get(a.person_id)
                if not person:
                    continue
                role_ok = True
                qual_ok = True
                if req.role_id:
                    role_ok = role_can_fulfill(db, person.role_id, req.role_id)
                if req.qualification_id:
                    qual_ok = req.qualification_id in person_qualification_ids(person)
                if role_ok and qual_ok:
                    matching += 1
                    used_assignment_ids.add(a.id)
        if matching < req.count:
            label = req.label or "דרישה"
            violations.append(
                Violation(
                    "hard",
                    "requirement",
                    f"משימה {mission.name}: לא מולאה {label} ({matching}/{req.count})",
                    mission.id,
                    details={
                        "requirement_id": req.id,
                        "role_id": req.role_id,
                        "qualification_id": req.qualification_id,
                        "have": matching,
                        "need": req.count,
                    },
                )
            )
    return violations


def validate_schedule(db: Session, schedule: Schedule) -> ValidationResult:
    missions = (
        db.query(Mission)
        .options(joinedload(Mission.requirements))
        .filter(Mission.schedule_id == schedule.id)
        .all()
    )
    assignments = (
        db.query(Assignment).filter(Assignment.schedule_id == schedule.id).all()
    )
    people = {
        p.id: p
        for p in load_people(db, schedule.company_id)
    }
    # Also include inactive people already assigned
    for a in assignments:
        if a.person_id not in people:
            p = db.query(Person).options(
                joinedload(Person.qualifications),
                joinedload(Person.leave_periods),
                joinedload(Person.restrictions),
                joinedload(Person.recurring_restrictions),
                joinedload(Person.allowed_mission_types),
            ).filter(Person.id == a.person_id).first()
            if p:
                people[p.id] = p

    missions_by_id = {m.id: m for m in missions}
    violations: List[Violation] = []

    for mission in missions:
        mission_assignments = [a for a in assignments if a.mission_id == mission.id]
        for a in mission_assignments:
            person = people.get(a.person_id)
            if not person:
                violations.append(
                    Violation("hard", "missing_person", "חייל לא נמצא", mission.id, a.person_id)
                )
                continue
            req = None
            if a.requirement_id:
                req = next((r for r in mission.requirements if r.id == a.requirement_id), None)
            others = [x for x in assignments if x.id != a.id]
            result = validate_assignment(
                db,
                company_id=schedule.company_id,
                person=person,
                mission=mission,
                existing_assignments=others,
                missions_by_id=missions_by_id,
                required_role_id=req.role_id if req else None,
                required_qualification_id=req.qualification_id if req else None,
                allow_override=bool(a.override_reason),
                override_reason=a.override_reason,
            )
            violations.extend(result.violations)
        violations.extend(
            validate_mission_staffing(
                mission, assignments, people_by_id=people, db=db
            )
        )

    ok = not any(v.severity == "hard" for v in violations)
    return ValidationResult(ok=ok, violations=violations)
