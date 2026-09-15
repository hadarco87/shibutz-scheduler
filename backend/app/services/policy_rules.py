"""User-defined scheduling transition rules (cooldown between mission types)."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Dict, List, Optional, Sequence

from sqlalchemy.orm import Session, joinedload

from app.models import (
    Assignment,
    ConstraintSeverity,
    Mission,
    Person,
    Schedule,
    SchedulingRule,
    SchedulingRuleBlockedType,
    SchedulingRuleRole,
    SchedulingRuleSourceType,
)
from app.services.validation import Violation, intervals_overlap
from app.services.workload import mission_duration_hours


def load_active_scheduling_rules(db: Session, company_id: int) -> List[SchedulingRule]:
    return (
        db.query(SchedulingRule)
        .options(
            joinedload(SchedulingRule.source_types).joinedload(
                SchedulingRuleSourceType.mission_type
            ),
            joinedload(SchedulingRule.blocked_types).joinedload(
                SchedulingRuleBlockedType.mission_type
            ),
            joinedload(SchedulingRule.roles).joinedload(SchedulingRuleRole.role),
        )
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
        .options(
            joinedload(SchedulingRule.source_types).joinedload(
                SchedulingRuleSourceType.mission_type
            ),
            joinedload(SchedulingRule.blocked_types).joinedload(
                SchedulingRuleBlockedType.mission_type
            ),
            joinedload(SchedulingRule.roles).joinedload(SchedulingRuleRole.role),
        )
        .filter(SchedulingRule.company_id == company_id)
        .order_by(SchedulingRule.id.asc())
        .all()
    )


def _rule_applies_to_person(rule: SchedulingRule, person: Person) -> bool:
    if rule.applies_to_all_roles:
        return True
    role_ids = {row.role_id for row in rule.roles}
    return person.role_id in role_ids


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
    """Return hard/soft violations for transition rules against this assignment."""
    if not mission.mission_type_id:
        return []

    active_rules = (
        rules if rules is not None else load_active_scheduling_rules(db, company_id)
    )
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
