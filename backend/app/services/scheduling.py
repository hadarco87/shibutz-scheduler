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
    Qualification,
    Role,
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
from app.services.windows import shifts_for_windows_in_range
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
    for t in templates:
        if _schedule_has_mission_type(db, schedule.id, t.id):
            continue
        created.extend(_instantiate_routine_type(db, schedule, t))
    db.flush()
    return created


def instantiate_window_missions(
    db: Session,
    schedule: Schedule,
) -> List[Mission]:
    """Create one-off missions from active non-routine types with time windows."""
    templates = (
        db.query(MissionType)
        .options(
            joinedload(MissionType.default_requirements),
            joinedload(MissionType.time_windows),
        )
        .filter(
            MissionType.company_id == schedule.company_id,
            MissionType.is_active.is_(True),
            MissionType.is_recurring_template.is_(False),
        )
        .all()
    )
    created: List[Mission] = []
    for t in templates:
        if _schedule_has_mission_type(db, schedule.id, t.id):
            continue
        created.extend(_instantiate_window_type(db, schedule, t))
    db.flush()
    return created


def instantiate_active_mission_types(
    db: Session,
    schedule: Schedule,
) -> List[Mission]:
    """Instantiate all active configured mission types into a draft schedule."""
    created = instantiate_recurring_missions(db, schedule)
    created.extend(instantiate_window_missions(db, schedule))
    return created


def sync_mission_type_to_drafts(db: Session, mt: MissionType) -> int:
    """Add a newly configured active type into existing draft schedules (no dupes)."""
    if not mt.is_active:
        return 0
    drafts = (
        db.query(Schedule)
        .filter(
            Schedule.company_id == mt.company_id,
            Schedule.status == ScheduleStatus.DRAFT,
        )
        .all()
    )
    total = 0
    for schedule in drafts:
        if _schedule_has_mission_type(db, schedule.id, mt.id):
            continue
        if mt.is_recurring_template:
            created = _instantiate_routine_type(db, schedule, mt)
        else:
            created = _instantiate_window_type(db, schedule, mt)
        total += len(created)
    if total:
        db.flush()
    return total


def _schedule_has_mission_type(db: Session, schedule_id: int, mission_type_id: int) -> bool:
    return (
        db.query(Mission.id)
        .filter(
            Mission.schedule_id == schedule_id,
            Mission.mission_type_id == mission_type_id,
        )
        .first()
        is not None
    )


def _staffing_from_type(t: MissionType, start: datetime):
    default_reqs = [
        StaffingReq(r.role_id, r.qualification_id, r.count)
        for r in (t.default_requirements or [])
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
    return resolve_staffing_for_start(
        start,
        default_personnel=t.default_personnel_count,
        default_requirements=default_reqs,
        bands=bands,
    )


def _add_mission_with_staffing(
    db: Session,
    schedule: Schedule,
    t: MissionType,
    start: datetime,
    end: datetime,
    *,
    is_adhoc: bool,
) -> Mission:
    staffing = _staffing_from_type(t, start)
    mission = Mission(
        company_id=schedule.company_id,
        mission_type_id=t.id,
        name=t.name,
        start_at=start,
        end_at=end,
        difficulty_weight=t.difficulty_weight,
        personnel_count=staffing.personnel_count,
        is_adhoc=is_adhoc,
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
    return mission


def _instantiate_routine_type(
    db: Session, schedule: Schedule, t: MissionType
) -> List[Mission]:
    duration = float(t.default_duration_hours or 0)
    if duration <= 0 or t.recurring_start_hour is None:
        return []
    policy = getattr(t, "routine_remainder_policy", None) or "include_short"
    ws = schedule.window_start
    we = schedule.window_end
    day = ws.replace(hour=0, minute=0, second=0, microsecond=0)
    last_day = (we - timedelta(microseconds=1)).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    created: List[Mission] = []
    d = day
    while d <= last_day:
        for start, end in shifts_for_calendar_day(
            d, duration, int(t.recurring_start_hour), policy
        ):
            if not (ws <= start < we):
                continue
            created.append(
                _add_mission_with_staffing(
                    db, schedule, t, start, end, is_adhoc=False
                )
            )
        d += timedelta(days=1)
    return created


def _instantiate_window_type(
    db: Session, schedule: Schedule, t: MissionType
) -> List[Mission]:
    windows = sorted(
        getattr(t, "time_windows", None) or [],
        key=lambda w: (w.sort_order, w.id),
    )
    if not windows:
        return []
    pairs = [(w.start_minute, w.end_minute) for w in windows]
    created: List[Mission] = []
    for start, end in shifts_for_windows_in_range(
        schedule.window_start, schedule.window_end, pairs
    ):
        created.append(
            _add_mission_with_staffing(db, schedule, t, start, end, is_adhoc=False)
        )
    return created


def _format_mission_window(mission: Mission) -> str:
    s = mission.start_at
    e = mission.end_at
    return (
        f"{s.day}.{s.month} {s.hour:02d}:{s.minute:02d}"
        f"–{e.day}.{e.month} {e.hour:02d}:{e.minute:02d}"
    )


def _slot_requirement_label(
    slot: MissionRequirement,
    role_names: Dict[int, str],
    qual_names: Dict[int, str],
) -> str:
    parts: List[str] = []
    if slot.role_id:
        parts.append(f"תפקיד «{role_names.get(slot.role_id, str(slot.role_id))}»")
    if slot.qualification_id:
        parts.append(
            f"פק״ל «{qual_names.get(slot.qualification_id, str(slot.qualification_id))}»"
        )
    if parts:
        return " + ".join(parts)
    if slot.label:
        return str(slot.label)
    return "איוש כללי"


def _pick_slot_failure_example(
    hard_violations: List[Violation],
    *,
    required_role_id: Optional[int],
    required_qualification_id: Optional[int],
) -> Optional[Violation]:
    if not hard_violations:
        return None
    preferred_codes = []
    if required_qualification_id:
        preferred_codes.append("qualification")
    if required_role_id:
        preferred_codes.append("role")
    for code in preferred_codes:
        for v in hard_violations:
            if v.code == code:
                return v
    return hard_violations[0]


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


def _role_seniority(role: Optional[Role]) -> int:
    """Higher = scarcer leadership resource. Used to avoid wasting commanders/officers."""
    if role is None:
        return 0
    name = (role.name or "").strip()
    score = 0
    if "קצין" in name:
        score += 40
    if any(token in name for token in ("מפקד", 'מ"פ', "מ״פ", "סמפ", "סמל״פ", 'סמל"פ')):
        score += 25
    if any(token in name for token in ("זוטר", 'מש"ק', "מש״ק", "סמל")):
        score += 10
    # Flexible roles that can cover many slots are treated as slightly scarcer.
    try:
        fulfill_count = len(role.can_fulfill or [])
    except Exception:
        fulfill_count = 0
    if fulfill_count > 1:
        score += min(15, (fulfill_count - 1) * 3)
    return score


def _overqualification_cost(person: Person, required_role_id: Optional[int]) -> float:
    """Prefer exact-role matches; keep senior roles for senior slots only.

    Lower is better (added into the candidate score).
    """
    seniority = _role_seniority(person.role)
    if required_role_id is None:
        # Open / qualification-only slot — prefer the least senior eligible person.
        return float(seniority)
    if person.role_id == required_role_id:
        return 0.0
    # Eligible via capability but overqualified (e.g. commander filling חייל).
    return 12.0 + float(seniority)


def _candidate_score(
    person: Person,
    workload: float,
    used_counts: Dict[int, int],
    after_count_30d: int = 0,
    required_role_id: Optional[int] = None,
) -> float:
    # Lower is better. Prefer fewer recent afters even over workload fairness.
    # Prefer soldiers over commanders/officers when the slot does not require them.
    return (
        after_count_30d * 1000
        + workload * 100
        + _overqualification_cost(person, required_role_id) * 40
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
    role_names = {
        r.id: r.name
        for r in db.query(Role).filter(Role.company_id == schedule.company_id).all()
    }
    qual_names = {
        q.id: q.name
        for q in db.query(Qualification)
        .filter(Qualification.company_id == schedule.company_id)
        .all()
    }

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
            slot_related_examples: List[str] = []
            other_examples: List[str] = []

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
                        picked = _pick_slot_failure_example(
                            result.hard_violations,
                            required_role_id=slot.role_id,
                            required_qualification_id=slot.qualification_id,
                        )
                        if picked:
                            note = picked.message
                            if picked.code in ("qualification", "role") and (
                                (
                                    slot.qualification_id
                                    and picked.code == "qualification"
                                )
                                or (slot.role_id and picked.code == "role")
                            ):
                                if len(slot_related_examples) < 2:
                                    slot_related_examples.append(note)
                            elif len(other_examples) < 2:
                                other_examples.append(note)
                    continue
                score = _candidate_score(
                    person,
                    workload.get(person.id, 0.0),
                    used_counts,
                    after_counts.get(person.id, 0),
                    required_role_id=slot.role_id,
                )
                candidates.append((score, person, result))

            if not candidates:
                need = _slot_requirement_label(slot, role_names, qual_names)
                when = _format_mission_window(mission)
                msg = (
                    f"לא ניתן לאייש את {mission.name} ({when}) — "
                    f"חסרה משבצת: {need}."
                )
                examples = slot_related_examples or other_examples
                if examples:
                    msg += f" דוגמה: {examples[0]}"
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


@dataclass
class ReplacementCandidate:
    person: Person
    result: ValidationResult
    requires_override: bool = False


@dataclass
class ReplacementOptions:
    mode: str
    slot_label: str
    required_role_name: Optional[str]
    required_qualification_name: Optional[str]
    empty_message: str
    candidates: List[ReplacementCandidate] = field(default_factory=list)


def list_replacement_candidates(
    db: Session,
    schedule: Schedule,
    assignment_id: int,
    *,
    mode: str = "matching",
) -> ReplacementOptions:
    """List people who can take this assignment slot.

    mode=matching: must satisfy the slot's role/qualification requirements.
    mode=all: ignore role/qual requirements (still blocks leave/overlap/etc.);
              candidates that fail matching are marked requires_override=True.
    """
    if mode not in ("matching", "all"):
        mode = "matching"

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

    required_role_id = req.role_id if req else None
    required_qualification_id = req.qualification_id if req else None

    role_name = None
    if required_role_id:
        role = db.get(Role, required_role_id)
        role_name = role.name if role else None
    qual_name = None
    if required_qualification_id:
        qual = db.get(Qualification, required_qualification_id)
        qual_name = qual.name if qual else None

    slot_parts: List[str] = []
    if role_name:
        slot_parts.append(f"תפקיד «{role_name}»")
    if qual_name:
        slot_parts.append(f"פק״ל «{qual_name}»")
    slot_label = " + ".join(slot_parts) if slot_parts else "איוש כללי"

    if qual_name:
        empty_message = f"אין אנשים עם פק״ל «{qual_name}» שזמינים למשבצת הזו כרגע"
    elif role_name:
        empty_message = f"אין אנשים שיכולים למלא תפקיד «{role_name}» שזמינים למשבצת הזו כרגע"
    else:
        empty_message = "אין חיילים זמינים למשבצת הזו כרגע"

    candidates: List[ReplacementCandidate] = []
    for person in load_people(db, schedule.company_id):
        if person.id == assignment.person_id:
            continue

        matching_result = validate_assignment(
            db,
            company_id=schedule.company_id,
            person=person,
            mission=mission,
            existing_assignments=others,
            missions_by_id=missions_by_id,
            required_role_id=required_role_id,
            required_qualification_id=required_qualification_id,
        )

        if mode == "matching":
            if matching_result.ok:
                candidates.append(
                    ReplacementCandidate(
                        person=person,
                        result=matching_result,
                        requires_override=False,
                    )
                )
            continue

        # mode == "all": keep hard availability constraints, relax role/qual fit
        availability_result = validate_assignment(
            db,
            company_id=schedule.company_id,
            person=person,
            mission=mission,
            existing_assignments=others,
            missions_by_id=missions_by_id,
            required_role_id=None,
            required_qualification_id=None,
        )
        if not availability_result.ok:
            continue
        requires_override = not matching_result.ok
        if requires_override:
            for v in matching_result.hard_violations:
                if v.code in ("role", "qualification"):
                    availability_result.violations.append(
                        Violation(
                            "soft",
                            v.code,
                            v.message,
                            v.mission_id,
                            v.person_id,
                            v.details,
                        )
                    )
        candidates.append(
            ReplacementCandidate(
                person=person,
                result=availability_result,
                requires_override=requires_override,
            )
        )

    candidates.sort(
        key=lambda c: (
            1 if c.requires_override else 0,
            _overqualification_cost(c.person, required_role_id),
            c.person.full_name,
        )
    )
    return ReplacementOptions(
        mode=mode,
        slot_label=slot_label,
        required_role_name=role_name,
        required_qualification_name=qual_name,
        empty_message=empty_message,
        candidates=candidates,
    )


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
