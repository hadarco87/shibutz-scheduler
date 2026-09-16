"""User-defined scheduling rules: transition cooldowns + min presence."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Dict, Iterable, List, Optional, Sequence, Set, Tuple

from sqlalchemy.orm import Session, joinedload

from app.models import (
    AfterDraft,
    AfterGrant,
    Assignment,
    ConstraintSeverity,
    Mission,
    Person,
    PresenceScope,
    Schedule,
    SchedulingRule,
    SchedulingRuleBlockedType,
    SchedulingRuleKind,
    SchedulingRuleQualification,
    SchedulingRuleRole,
    SchedulingRuleSourceType,
)
from app.services.validation import Violation, intervals_overlap, load_people
from app.services.workload import mission_duration_hours


def _rule_load_options():
    return (
        joinedload(SchedulingRule.source_types).joinedload(
            SchedulingRuleSourceType.mission_type
        ),
        joinedload(SchedulingRule.blocked_types).joinedload(
            SchedulingRuleBlockedType.mission_type
        ),
        joinedload(SchedulingRule.roles).joinedload(SchedulingRuleRole.role),
        joinedload(SchedulingRule.qualifications).joinedload(
            SchedulingRuleQualification.qualification
        ),
    )


def load_active_scheduling_rules(db: Session, company_id: int) -> List[SchedulingRule]:
    return (
        db.query(SchedulingRule)
        .options(*_rule_load_options())
        .filter(
            SchedulingRule.company_id == company_id,
            SchedulingRule.is_active.is_(True),
        )
        .order_by(SchedulingRule.id.asc())
        .all()
    )


def load_scheduling_rules(db: Session, company_id: int) -> List[SchedulingRule]:
    return (
        db.query(SchedulingRule)
        .options(*_rule_load_options())
        .filter(SchedulingRule.company_id == company_id)
        .order_by(SchedulingRule.id.asc())
        .all()
    )


def _rule_kind(rule: SchedulingRule) -> SchedulingRuleKind:
    kind = getattr(rule, "rule_kind", None) or SchedulingRuleKind.TRANSITION
    if isinstance(kind, str):
        try:
            return SchedulingRuleKind(kind)
        except ValueError:
            return SchedulingRuleKind.TRANSITION
    return kind


def _presence_scope(rule: SchedulingRule) -> PresenceScope:
    scope = getattr(rule, "presence_scope", None) or PresenceScope.NOT_AT_HOME
    if isinstance(scope, str):
        try:
            return PresenceScope(scope)
        except ValueError:
            return PresenceScope.NOT_AT_HOME
    return scope


def _rule_applies_to_person(rule: SchedulingRule, person: Person) -> bool:
    """For transition rules: who is restricted by the cooldown."""
    if rule.applies_to_all_roles:
        return True
    role_ids = {row.role_id for row in rule.roles}
    return person.role_id in role_ids


def _person_matches_presence_pool(rule: SchedulingRule, person: Person) -> bool:
    """For min-presence: who counts toward the required coverage."""
    role_ids = {row.role_id for row in rule.roles}
    qual_ids = {row.qualification_id for row in rule.qualifications}
    if not role_ids and not qual_ids:
        return False
    if role_ids and person.role_id not in role_ids:
        return False
    if qual_ids:
        person_quals = {pq.qualification_id for pq in person.qualifications}
        if not person_quals.intersection(qual_ids):
            return False
    return True


def _pool_label(rule: SchedulingRule) -> str:
    parts: List[str] = []
    for row in rule.roles:
        if row.role:
            parts.append(row.role.name)
    for row in rule.qualifications:
        if row.qualification:
            parts.append(row.qualification.name)
    return " / ".join(parts) if parts else "כוח אדם"


def _scope_label(scope: PresenceScope) -> str:
    if scope == PresenceScope.ON_MISSION:
        return "במשימה"
    if scope == PresenceScope.ON_MISSION_TYPES:
        return "במוצב (סוגי משימה נבחרים)"
    return "במוצב או בפעילות (לא בבית)"


def evaluate_scheduling_rules(
    db: Session,
    *,
    company_id: int,
    person: Person,
    mission: Mission,
    existing_assignments: Sequence[Assignment],
    missions_by_id: Dict[int, Mission],
    rules: Optional[List[SchedulingRule]] = None,
) -> List[Violation]:
    """Transition-rule violations for a candidate assignment."""
    if not mission.mission_type_id:
        return []

    active_rules = [
        r
        for r in (
            rules if rules is not None else load_active_scheduling_rules(db, company_id)
        )
        if _rule_kind(r) == SchedulingRuleKind.TRANSITION
    ]
    if not active_rules:
        return []

    max_cooldown = max((float(r.cooldown_hours) for r in active_rules), default=0.0)
    max_source = max((float(r.min_source_hours) for r in active_rules), default=0.0)
    lookback = max_cooldown + max_source + 24.0
    window_start = mission.start_at - timedelta(hours=lookback)

    prior_by_id: Dict[int, Mission] = {}

    for a in existing_assignments:
        if a.person_id != person.id:
            continue
        m = missions_by_id.get(a.mission_id)
        if not m or m.id == mission.id:
            continue
        if m.end_at >= window_start:
            prior_by_id[m.id] = m

    rows = (
        db.query(Mission)
        .join(Assignment, Assignment.mission_id == Mission.id)
        .join(Schedule, Assignment.schedule_id == Schedule.id)
        .filter(
            Schedule.company_id == company_id,
            Assignment.person_id == person.id,
            Mission.id != mission.id,
            Mission.end_at >= window_start,
            Mission.end_at < mission.end_at + timedelta(hours=lookback),
        )
        .all()
    )
    for m in rows:
        prior_by_id[m.id] = m

    violations: List[Violation] = []
    for rule in active_rules:
        if not _rule_applies_to_person(rule, person):
            continue
        source_ids = {row.mission_type_id for row in rule.source_types}
        blocked_ids = {row.mission_type_id for row in rule.blocked_types}
        if not source_ids or not blocked_ids:
            continue
        if mission.mission_type_id not in blocked_ids:
            continue

        for prior in prior_by_id.values():
            if not prior.mission_type_id or prior.mission_type_id not in source_ids:
                continue
            hours = mission_duration_hours(prior.start_at, prior.end_at)
            if hours + 1e-9 < float(rule.min_source_hours):
                continue
            cooldown_end = prior.end_at + timedelta(hours=float(rule.cooldown_hours))
            if not intervals_overlap(
                mission.start_at, mission.end_at, prior.end_at, cooldown_end
            ):
                continue

            source_name = next(
                (
                    row.mission_type.name
                    for row in rule.source_types
                    if row.mission_type_id == prior.mission_type_id and row.mission_type
                ),
                "משימה קודמת",
            )
            blocked_name = next(
                (
                    row.mission_type.name
                    for row in rule.blocked_types
                    if row.mission_type_id == mission.mission_type_id and row.mission_type
                ),
                mission.name,
            )
            severity = (
                "hard" if rule.severity == ConstraintSeverity.HARD else "soft"
            )
            gap_h = max(
                (mission.start_at - prior.end_at).total_seconds() / 3600.0,
                0.0,
            )
            violations.append(
                Violation(
                    severity,
                    "scheduling_rule",
                    (
                        f"{person.full_name}: אחרי «{source_name}» "
                        f"({hours:.0f} ש׳) אסור «{blocked_name}» "
                        f"ל־{rule.cooldown_hours:.0f} שעות מסוף המשמרת "
                        f"(חלפו רק {gap_h:.1f} ש׳)"
                    ),
                    mission.id,
                    person.id,
                    {
                        "rule_id": rule.id,
                        "source_mission_id": prior.id,
                        "source_mission_type_id": prior.mission_type_id,
                        "blocked_mission_type_id": mission.mission_type_id,
                        "cooldown_hours": float(rule.cooldown_hours),
                        "gap_hours": gap_h,
                    },
                )
            )
            break

    return violations


def _is_at_home(
    person: Person,
    start: datetime,
    end: datetime,
    after_intervals: Sequence[Tuple[int, datetime, datetime]],
) -> bool:
    for leave in person.leave_periods:
        if intervals_overlap(leave.start_at, leave.end_at, start, end):
            return True
    for pid, a_start, a_end in after_intervals:
        if pid == person.id and intervals_overlap(a_start, a_end, start, end):
            return True
    return False


def _person_present(
    *,
    person: Person,
    start: datetime,
    end: datetime,
    scope: PresenceScope,
    counting_type_ids: Set[int],
    assignments: Sequence[Assignment],
    missions_by_id: Dict[int, Mission],
    after_intervals: Sequence[Tuple[int, datetime, datetime]],
) -> bool:
    if not person.is_active:
        return False

    if scope == PresenceScope.NOT_AT_HOME:
        return not _is_at_home(person, start, end, after_intervals)

    on_mission = False
    for a in assignments:
        if a.person_id != person.id:
            continue
        m = missions_by_id.get(a.mission_id)
        if not m:
            continue
        if not intervals_overlap(m.start_at, m.end_at, start, end):
            continue
        if scope == PresenceScope.ON_MISSION:
            on_mission = True
            break
        if scope == PresenceScope.ON_MISSION_TYPES:
            if m.mission_type_id and m.mission_type_id in counting_type_ids:
                on_mission = True
                break
    return on_mission


def _collect_after_intervals(
    db: Session,
    *,
    company_id: int,
    window_start: datetime,
    window_end: datetime,
    schedule_id: Optional[int],
    provisional_afters: Optional[Sequence[Tuple[int, datetime, datetime]]],
) -> List[Tuple[int, datetime, datetime]]:
    intervals: List[Tuple[int, datetime, datetime]] = []

    if provisional_afters is not None:
        intervals.extend(list(provisional_afters))
    elif schedule_id is not None:
        drafts = (
            db.query(AfterDraft)
            .filter(AfterDraft.schedule_id == schedule_id)
            .all()
        )
        for d in drafts:
            intervals.append((d.person_id, d.start_at, d.end_at))

    grants = (
        db.query(AfterGrant)
        .filter(
            AfterGrant.company_id == company_id,
            AfterGrant.start_at < window_end,
            AfterGrant.end_at > window_start,
        )
        .all()
    )
    for g in grants:
        # Avoid double-counting if grant came from this draft schedule after publish
        if provisional_afters is not None and schedule_id and g.schedule_id == schedule_id:
            continue
        intervals.append((g.person_id, g.start_at, g.end_at))

    return intervals


def evaluate_min_presence_rules(
    db: Session,
    *,
    schedule: Schedule,
    rules: Optional[List[SchedulingRule]] = None,
    provisional_afters: Optional[Sequence[Tuple[int, datetime, datetime]]] = None,
) -> List[Violation]:
    """Ensure minimum coverage holds for every instant in the schedule window."""
    active_rules = [
        r
        for r in (
            rules
            if rules is not None
            else load_active_scheduling_rules(db, schedule.company_id)
        )
        if _rule_kind(r) == SchedulingRuleKind.MIN_PRESENCE
    ]
    if not active_rules:
        return []

    window_start = schedule.window_start
    window_end = schedule.window_end
    people = load_people(db, schedule.company_id)
    assignments = (
        db.query(Assignment).filter(Assignment.schedule_id == schedule.id).all()
    )
    missions = (
        db.query(Mission).filter(Mission.schedule_id == schedule.id).all()
    )
    missions_by_id = {m.id: m for m in missions}
    after_intervals = _collect_after_intervals(
        db,
        company_id=schedule.company_id,
        window_start=window_start,
        window_end=window_end,
        schedule_id=schedule.id,
        provisional_afters=provisional_afters,
    )

    violations: List[Violation] = []
    for rule in active_rules:
        pool = [p for p in people if _person_matches_presence_pool(rule, p)]
        if not pool:
            severity = (
                "hard" if rule.severity == ConstraintSeverity.HARD else "soft"
            )
            violations.append(
                Violation(
                    severity,
                    "min_presence",
                    (
                        f"כלל נוכחות: אין אף אחד מ־«{_pool_label(rule)}» "
                        f"בכוח האדם הפעיל"
                    ),
                    details={"rule_id": rule.id},
                )
            )
            continue

        scope = _presence_scope(rule)
        counting_types = {row.mission_type_id for row in rule.source_types}
        if scope == PresenceScope.ON_MISSION_TYPES and not counting_types:
            continue

        breakpoints: Set[datetime] = {window_start, window_end}
        for m in missions:
            if m.start_at > window_start and m.start_at < window_end:
                breakpoints.add(m.start_at)
            if m.end_at > window_start and m.end_at < window_end:
                breakpoints.add(m.end_at)
        for _pid, a0, a1 in after_intervals:
            if a0 > window_start and a0 < window_end:
                breakpoints.add(a0)
            if a1 > window_start and a1 < window_end:
                breakpoints.add(a1)
        for p in pool:
            for leave in p.leave_periods:
                if leave.start_at > window_start and leave.start_at < window_end:
                    breakpoints.add(leave.start_at)
                if leave.end_at > window_start and leave.end_at < window_end:
                    breakpoints.add(leave.end_at)

        times = sorted(breakpoints)
        min_count = max(int(getattr(rule, "min_count", 1) or 1), 1)
        failed_at: Optional[datetime] = None
        failed_count = 0
        for i in range(len(times) - 1):
            t0, t1 = times[i], times[i + 1]
            if t1 <= t0:
                continue
            # Sample the open interval [t0, t1)
            sample_end = min(t0 + timedelta(seconds=1), t1)
            present = sum(
                1
                for p in pool
                if _person_present(
                    person=p,
                    start=t0,
                    end=sample_end,
                    scope=scope,
                    counting_type_ids=counting_types,
                    assignments=assignments,
                    missions_by_id=missions_by_id,
                    after_intervals=after_intervals,
                )
            )
            if present < min_count:
                failed_at = t0
                failed_count = present
                break

        if failed_at is not None:
            severity = (
                "hard" if rule.severity == ConstraintSeverity.HARD else "soft"
            )
            when = failed_at.strftime("%d.%m %H:%M")
            violations.append(
                Violation(
                    severity,
                    "min_presence",
                    (
                        f"כלל נוכחות: בכל רגע חייבים לפחות {min_count} "
                        f"מ־«{_pool_label(rule)}» {_scope_label(scope)} "
                        f"— ב־{when} נמצאו רק {failed_count}"
                    ),
                    details={
                        "rule_id": rule.id,
                        "at": failed_at.isoformat(),
                        "have": failed_count,
                        "need": min_count,
                        "presence_scope": scope.value,
                    },
                )
                )

    return violations


def evaluate_sleep_before_after(
    db: Session,
    *,
    company_id: int,
    person: Person,
    after_start: datetime,
    rules: Optional[List[SchedulingRule]] = None,
    lookback_days: float = 3.0,
    prior_end_limit: Optional[datetime] = None,
) -> List[Violation]:
    """Block / warn after that starts too soon after sleep-disrupting missions.

    prior_end_limit: latest mission end time to consider (defaults to after_start).
    Preview may pass window_end so same-day early-morning finishes are visible.
    """
    active_rules = [
        r
        for r in (
            rules
            if rules is not None
            else load_active_scheduling_rules(db, company_id)
        )
        if _rule_kind(r) == SchedulingRuleKind.SLEEP_BEFORE_AFTER
    ]
    if not active_rules:
        return []

    end_limit = prior_end_limit or after_start
    lookback = after_start - timedelta(days=lookback_days)
    prior_rows = (
        db.query(Assignment, Mission)
        .join(Mission, Mission.id == Assignment.mission_id)
        .filter(
            Mission.company_id == company_id,
            Assignment.person_id == person.id,
            Mission.end_at >= lookback,
            Mission.end_at <= end_limit,
            Mission.mission_type_id.isnot(None),
        )
        .all()
    )
    latest_by_type: Dict[int, Tuple[datetime, Mission]] = {}
    for _a, mission in prior_rows:
        mt_id = mission.mission_type_id
        if mt_id is None:
            continue
        prev = latest_by_type.get(mt_id)
        if not prev or mission.end_at > prev[0]:
            latest_by_type[mt_id] = (mission.end_at, mission)

    violations: List[Violation] = []
    for rule in active_rules:
        if not _rule_applies_to_person(rule, person):
            continue
        source_ids = {row.mission_type_id for row in rule.source_types}
        if not source_ids:
            continue
        sleep_h = float(rule.cooldown_hours or 0)
        if sleep_h <= 0:
            continue

        triggering: Optional[Tuple[datetime, Mission, str]] = None
        for mt_id in source_ids:
            hit = latest_by_type.get(mt_id)
            if not hit:
                continue
            end_at, mission = hit
            name = next(
                (
                    row.mission_type.name
                    for row in rule.source_types
                    if row.mission_type_id == mt_id and row.mission_type
                ),
                mission.name,
            )
            if triggering is None or end_at > triggering[0]:
                triggering = (end_at, mission, name)

        if not triggering:
            continue
        end_at, mission, name = triggering
        ready = end_at + timedelta(hours=sleep_h)
        if after_start >= ready:
            continue
        severity = "hard" if rule.severity == ConstraintSeverity.HARD else "soft"
        night = (
            end_at.hour >= 22
            or end_at.hour < 6
            or mission.start_at.hour >= 22
            or mission.start_at.hour < 6
        )
        prefix = "משימת לילה · " if night else ""
        violations.append(
            Violation(
                severity,
                "sleep_before_after",
                (
                    f"{prefix}{person.full_name}: אחרי «{name}» נדרשות "
                    f"{sleep_h:g} ש׳ במוצב לפני יציאה לאפטר "
                    f"(מוכן מ־{ready.strftime('%d.%m %H:%M')})"
                ),
                mission.id,
                person.id,
                {
                    "rule_id": rule.id,
                    "mission_id": mission.id,
                    "mission_type_id": mission.mission_type_id,
                    "ready_at": ready.isoformat(),
                    "after_start": after_start.isoformat(),
                    "sleep_hours": sleep_h,
                },
            )
        )
    return violations
