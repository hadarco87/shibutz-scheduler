"""Workload-aware scheduling engine.

Critical rule: GENERATE != COMMIT
This module only creates/updates DRAFT assignments. It never writes WorkloadEvent.
"""

from __future__ import annotations

import secrets
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple

from sqlalchemy.orm import Session, joinedload

from app.models import (
    Assignment,
    AuditLog,
    Mission,
    MissionRequirement,
    MissionType,
    MissionTypeRequirement,
    MissionTypeStaffingBand,
    Person,
    Schedule,
    ScheduleStatus,
    WorkloadEvent,
    WorkloadSnapshot,
    WorkloadSnapshotEntry,
)
from app.services.after import after_count_map, commit_after_drafts_on_publish
from app.services.routine import shifts_for_calendar_day
from app.services.staffing import StaffingReq, resolve_staffing_for_start
from app.services.validation import (
    ValidationResult,
    Violation,
    load_people,
    validate_assignment,
    validate_schedule,
)
from app.services.workload import compute_workload_weight, mission_duration_hours


@dataclass
class Conflict:
    mission_id: int
    mission_name: str
    message: str
    missing_role_id: Optional[int] = None
    missing_qualification_id: Optional[int] = None
    suggested_person_ids: List[int] = field(default_factory=list)


@dataclass
class SchedulingResult:
    status: str
    schedule: Schedule
    warnings: List[Violation] = field(default_factory=list)
    conflicts: List[Conflict] = field(default_factory=list)
    explanations: List[str] = field(default_factory=list)


def current_workload_map(db: Session, company_id: int) -> Dict[int, float]:
    """Sum immutable published workload events. Drafts never appear here."""
    totals: Dict[int, float] = defaultdict(float)
    events = db.query(WorkloadEvent).filter(WorkloadEvent.company_id == company_id).all()
    for e in events:
        totals[e.person_id] += e.delta
    return dict(totals)


def instantiate_recurring_missions(
    db: Session,
    schedule: Schedule,
) -> List[Mission]:
    """Create routine shifts for the schedule window from start hour + duration."""
    templates = (
        db.query(MissionType)
        .options(
            joinedload(MissionType.default_requirements),
            joinedload(MissionType.staffing_bands).joinedload(
                MissionTypeStaffingBand.requirements
            ),
        )
        .filter(
            MissionType.company_id == schedule.company_id,
            MissionType.is_active.is_(True),
            MissionType.is_recurring_template.is_(True),
        )
        .all()
    )
    created: List[Mission] = []
    ws = schedule.window_start
    we = schedule.window_end
    day = ws.replace(hour=0, minute=0, second=0, microsecond=0)
    last_day = (we - timedelta(microseconds=1)).replace(
        hour=0, minute=0, second=0, microsecond=0
    )

    for t in templates:
        duration = float(t.default_duration_hours or 0)
        if duration <= 0 or t.recurring_start_hour is None:
            continue
        policy = getattr(t, "routine_remainder_policy", None) or "include_short"
        default_reqs = [
            StaffingReq(r.role_id, r.qualification_id, r.count)
            for r in t.default_requirements
        ]
        bands = []
        for b in sorted(
            getattr(t, "staffing_bands", None) or [],
            key=lambda x: (x.sort_order, x.id),
        ):
            bands.append(
                (
                    b.start_minute,
                    b.end_minute,
                    b.personnel_count,
                    b.label,
                    [
                        StaffingReq(r.role_id, r.qualification_id, r.count)
                        for r in (b.requirements or [])
                    ],
                )
            )
        d = day
        while d <= last_day:
            for start, end in shifts_for_calendar_day(
                d, duration, int(t.recurring_start_hour), policy
            ):
                if not (ws <= start < we):
                    continue
                staffing = resolve_staffing_for_start(
                    start,
                    default_personnel=t.default_personnel_count,
                    default_requirements=default_reqs,
                    bands=bands,
                )
                mission = Mission(
                    company_id=schedule.company_id,
                    mission_type_id=t.id,
                    name=t.name,
                    start_at=start,
                    end_at=end,
                    difficulty_weight=t.difficulty_weight,
                    personnel_count=staffing.personnel_count,
                    is_adhoc=False,
                    schedule_id=schedule.id,
                )
                db.add(mission)
                db.flush()
                if staffing.requirements:
                    for req in staffing.requirements:
                        db.add(
                            MissionRequirement(
                                mission_id=mission.id,
                                role_id=req.role_id,
                                qualification_id=req.qualification_id,
                                count=req.count,
                            )
                        )
                else:
                    for _ in range(staffing.personnel_count):
                        db.add(
                            MissionRequirement(
                                mission_id=mission.id, count=1, label="חייל"
                            )
                        )
                created.append(mission)
            d += timedelta(days=1)
    db.flush()
    return created


def _expand_slots(mission: Mission) -> List[MissionRequirement]:
    slots: List[MissionRequirement] = []
    for req in mission.requirements:
        for _ in range(req.count):
            slots.append(req)
    while len(slots) < mission.personnel_count:
        slots.append(
            MissionRequirement(
                id=None,  # type: ignore
                mission_id=mission.id,
                count=1,
                label="כללי",
            )
        )
    return slots[: mission.personnel_count]


def _candidate_score(
    person: Person,
    workload: float,
    used_counts: Dict[int, int],
    after_count_30d: int = 0,
) -> float:
    # Lower is better. Prefer fewer recent afters even over workload fairness.
    return (
        after_count_30d * 1000
        + workload * 100
        + used_counts.get(person.id, 0) * 10
    )


def generate_schedule(db: Session, schedule: Schedule, user_id: Optional[int] = None) -> SchedulingResult:
    if schedule.status == ScheduleStatus.PUBLISHED:
        raise ValueError("לא ניתן לשבץ מחדש שיבוץ שפורסם")

    # Clear previous draft assignments only
    db.query(Assignment).filter(Assignment.schedule_id == schedule.id).delete()
    db.flush()

    missions = (
        db.query(Mission)
        .options(joinedload(Mission.requirements))
        .filter(Mission.schedule_id == schedule.id)
        .order_by(Mission.start_at.asc(), Mission.difficulty_weight.desc())
        .all()
    )
    people = load_people(db, schedule.company_id)
    workload = current_workload_map(db, schedule.company_id)
    after_counts = after_count_map(db, schedule.company_id, schedule.window_start)
    missions_by_id = {m.id: m for m in missions}

    assignments: List[Assignment] = []
    used_counts: Dict[int, int] = defaultdict(int)
    conflicts: List[Conflict] = []
    explanations: List[str] = []
    warnings: List[Violation] = []

    for mission in missions:
        slots = _expand_slots(mission)
        for slot in slots:
            req_id = slot.id if getattr(slot, "id", None) else None
            candidates: List[Tuple[float, Person, ValidationResult]] = []
            exclusion_notes: List[str] = []

            for person in people:
                result = validate_assignment(
                    db,
                    company_id=schedule.company_id,
                    person=person,
                    mission=mission,
                    existing_assignments=assignments,
                    missions_by_id=missions_by_id,
                    required_role_id=slot.role_id,
                    required_qualification_id=slot.qualification_id,
                )
                if not result.ok:
                    if result.hard_violations:
                        exclusion_notes.append(
                            f"{person.full_name}: {result.hard_violations[0].message}"
                        )
                    continue
                score = _candidate_score(
                    person,
                    workload.get(person.id, 0.0),
                    used_counts,
                    after_counts.get(person.id, 0),
                )
                candidates.append((score, person, result))

            if not candidates:
                msg = f"לא ניתן לאייש את {mission.name}"
                if slot.role_id:
                    msg += " (חסר תפקיד מתאים)"
                if slot.qualification_id:
                    msg += " (חסר פק\"ל מתאים)"
                if exclusion_notes:
                    msg += f". סיבה עיקרית: {exclusion_notes[0]}"
                conflicts.append(
                    Conflict(
                        mission_id=mission.id,
                        mission_name=mission.name,
                        message=msg,
                        missing_role_id=slot.role_id,
                        missing_qualification_id=slot.qualification_id,
                        suggested_person_ids=[],
                    )
                )
                explanations.append(msg)
                continue

            candidates.sort(key=lambda x: x[0])
            score, person, result = candidates[0]
            assignment = Assignment(
                schedule_id=schedule.id,
                mission_id=mission.id,
                person_id=person.id,
                requirement_id=req_id,
                is_manual=False,
                difficulty_at_assignment=mission.difficulty_weight,
            )
            db.add(assignment)
            db.flush()
            assignments.append(assignment)
            used_counts[person.id] += 1
            explanations.append(
                f"{person.full_name} שובץ ל-{mission.name} "
                f"(אפטרים 30י׳: {after_counts.get(person.id, 0)}; "
                f"מדד עומס היסטורי: {workload.get(person.id, 0):.1f}; "
                f"תרומה צפויה: {compute_workload_weight(mission.difficulty_weight, mission_duration_hours(mission.start_at, mission.end_at)):.1f})"
            )
            warnings.extend(result.soft_violations)

    db.flush()
    validation = validate_schedule(db, schedule)
    warnings.extend(validation.soft_violations)

    if conflicts or validation.hard_violations:
        status = "infeasible"
    elif warnings:
        status = "success_with_warnings"
    else:
        status = "success"

    db.add(
        AuditLog(
            company_id=schedule.company_id,
            user_id=user_id,
            action="generate_schedule",
            entity_type="schedule",
            entity_id=schedule.id,
            details=f"status={status}; assignments={len(assignments)}; conflicts={len(conflicts)}",
        )
    )
    db.commit()
    db.refresh(schedule)

    return SchedulingResult(
        status=status,
        schedule=schedule,
        warnings=warnings,
        conflicts=conflicts,
        explanations=explanations,
    )


def publish_schedule(db: Session, schedule: Schedule, user_id: int) -> Schedule:
    """Atomic publication. Only place that creates WorkloadEvent rows."""
    if schedule.status == ScheduleStatus.PUBLISHED:
        raise ValueError("השיבוץ כבר פורסם")

    validation = validate_schedule(db, schedule)
    if not validation.ok:
        messages = "; ".join(v.message for v in validation.hard_violations[:5])
        raise ValueError(f"לא ניתן לפרסם — יש הפרות קשיחות: {messages}")

    assignments = (
        db.query(Assignment).filter(Assignment.schedule_id == schedule.id).all()
    )
    missions = {
        m.id: m
        for m in db.query(Mission).filter(Mission.schedule_id == schedule.id).all()
    }

    # Prevent double-publish workload duplication
    existing_events = (
        db.query(WorkloadEvent)
        .filter(WorkloadEvent.schedule_id == schedule.id)
        .count()
    )
    if existing_events:
        raise ValueError("כבר קיימים אירועי עומס לשיבוץ זה")

    for a in assignments:
        mission = missions[a.mission_id]
        hours = mission_duration_hours(mission.start_at, mission.end_at)
        delta = compute_workload_weight(a.difficulty_at_assignment, hours)
        db.add(
            WorkloadEvent(
                company_id=schedule.company_id,
                person_id=a.person_id,
                schedule_id=schedule.id,
                assignment_id=a.id,
                mission_id=mission.id,
                mission_type_id=mission.mission_type_id,
                difficulty_weight=a.difficulty_at_assignment,
                delta=delta,
            )
        )
    db.flush()
    commit_after_drafts_on_publish(db, schedule)
    totals = current_workload_map(db, schedule.company_id)

    snapshot = WorkloadSnapshot(
        company_id=schedule.company_id,
        schedule_id=schedule.id,
        taken_at=datetime.utcnow(),
        note=f"לאחר פרסום שיבוץ #{schedule.id}",
    )
    db.add(snapshot)
    db.flush()
    people = db.query(Person).filter(Person.company_id == schedule.company_id).all()
    for p in people:
        db.add(
            WorkloadSnapshotEntry(
                snapshot_id=snapshot.id,
                person_id=p.id,
                total_workload=totals.get(p.id, 0.0),
            )
        )

    schedule.status = ScheduleStatus.PUBLISHED
    schedule.approved_by_id = user_id
    schedule.published_at = datetime.utcnow()
    if not schedule.share_token:
        schedule.share_token = secrets.token_urlsafe(24)

    db.add(
        AuditLog(
            company_id=schedule.company_id,
            user_id=user_id,
            action="publish_schedule",
            entity_type="schedule",
            entity_id=schedule.id,
            details="מאושר לפרסום",
        )
    )
    db.commit()
    db.refresh(schedule)
    return schedule


def list_replacement_candidates(
    db: Session,
    schedule: Schedule,
    assignment_id: int,
) -> List[Tuple[Person, ValidationResult]]:
    """People who can validly take this assignment slot (hard constraints)."""
    assignment = (
        db.query(Assignment)
        .filter(Assignment.id == assignment_id, Assignment.schedule_id == schedule.id)
        .first()
    )
    if not assignment:
        raise ValueError("שיבוץ לא נמצא")

    mission = (
        db.query(Mission)
        .options(joinedload(Mission.requirements))
        .filter(Mission.id == assignment.mission_id)
        .first()
    )
    if not mission:
        raise ValueError("משימה לא נמצאה")

    others = (
        db.query(Assignment)
        .filter(Assignment.schedule_id == schedule.id, Assignment.id != assignment.id)
        .all()
    )
    missions_by_id = {
        m.id: m
        for m in db.query(Mission)
        .options(joinedload(Mission.requirements))
        .filter(Mission.schedule_id == schedule.id)
        .all()
    }
    req = None
    if assignment.requirement_id:
        req = next(
            (r for r in mission.requirements if r.id == assignment.requirement_id),
            None,
        )

    eligible: List[Tuple[Person, ValidationResult]] = []
    for person in load_people(db, schedule.company_id):
        if person.id == assignment.person_id:
            continue
        result = validate_assignment(
            db,
            company_id=schedule.company_id,
            person=person,
            mission=mission,
            existing_assignments=others,
            missions_by_id=missions_by_id,
            required_role_id=req.role_id if req else None,
            required_qualification_id=req.qualification_id if req else None,
        )
        if result.ok:
            eligible.append((person, result))

    eligible.sort(key=lambda x: x[0].full_name)
    return eligible


def replace_assignment(
    db: Session,
    schedule: Schedule,
    assignment_id: int,
    new_person_id: int,
    override_reason: Optional[str] = None,
) -> Assignment:
    if schedule.status == ScheduleStatus.PUBLISHED:
        raise ValueError("לא ניתן לערוך שיבוץ שפורסם")

    assignment = (
        db.query(Assignment)
        .filter(Assignment.id == assignment_id, Assignment.schedule_id == schedule.id)
        .first()
    )
    if not assignment:
        raise ValueError("שיבוץ לא נמצא")

    mission = (
        db.query(Mission)
        .options(joinedload(Mission.requirements))
        .filter(Mission.id == assignment.mission_id)
        .first()
    )
    person = (
        db.query(Person)
        .options(
            joinedload(Person.qualifications),
            joinedload(Person.leave_periods),
            joinedload(Person.restrictions),
            joinedload(Person.recurring_restrictions),
            joinedload(Person.allowed_mission_types),
        )
        .filter(Person.id == new_person_id)
        .first()
    )
    if not mission or not person:
        raise ValueError("משימה או חייל לא נמצאו")

    others = (
        db.query(Assignment)
        .filter(Assignment.schedule_id == schedule.id, Assignment.id != assignment.id)
        .all()
    )
    missions_by_id = {
        m.id: m
        for m in db.query(Mission)
        .options(joinedload(Mission.requirements))
        .filter(Mission.schedule_id == schedule.id)
        .all()
    }
    req = None
    if assignment.requirement_id:
        req = next(
            (r for r in mission.requirements if r.id == assignment.requirement_id),
            None,
        )

    result = validate_assignment(
        db,
        company_id=schedule.company_id,
        person=person,
        mission=mission,
        existing_assignments=others,
        missions_by_id=missions_by_id,
        required_role_id=req.role_id if req else None,
        required_qualification_id=req.qualification_id if req else None,
        allow_override=bool(override_reason),
        override_reason=override_reason,
    )
    if not result.ok:
        raise ValueError(result.hard_violations[0].message)

    assignment.person_id = new_person_id
    assignment.is_manual = True
    assignment.override_reason = override_reason
    db.commit()
    db.refresh(assignment)
    return assignment
