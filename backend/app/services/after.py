"""After (אפטר) quota, candidates, sleep warnings, and publish commit."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Dict, List, Optional, Tuple

from sqlalchemy.orm import Session, joinedload

from app.models import (
    AfterDraft,
    AfterGrant,
    Assignment,
    KanimRule,
    KanimRuleKind,
    LeavePeriod,
    LeaveType,
    Person,
    Schedule,
    ScheduleStatus,
)


AFTER_HISTORY_DAYS = 30


def _is_israeli_weekday(d: date) -> bool:
    # Mon=0 ... Sun=6. Israeli weekdays = Sun–Thu.
    return d.weekday() in (6, 0, 1, 2, 3)


def resolve_kanim_for_date(rules: List[KanimRule], d: date) -> int:
    """Specific date overrides weekend/weekday. Missing rule → 0."""
    for r in rules:
        if r.kind == KanimRuleKind.SPECIFIC_DATE and r.specific_date == d:
            return int(r.min_count)
    kind = KanimRuleKind.WEEKDAY if _is_israeli_weekday(d) else KanimRuleKind.WEEKEND
    for r in rules:
        if r.kind == kind:
            return int(r.min_count)
    return 0


def max_kanim_in_window(
    rules: List[KanimRule], window_start: datetime, window_end: datetime
) -> int:
    """Strictest (highest) minimum staffing across days covered by the window."""
    if window_end <= window_start:
        return resolve_kanim_for_date(rules, window_start.date())
    day = window_start.date()
    last = (window_end - timedelta(microseconds=1)).date()
    peak = 0
    while day <= last:
        peak = max(peak, resolve_kanim_for_date(rules, day))
        day += timedelta(days=1)
    return peak


def after_count_map(
    db: Session, company_id: int, as_of: Optional[datetime] = None
) -> Dict[int, int]:
    """Published after grants overlapping the last 30 days ending at as_of."""
    as_of = as_of or datetime.utcnow()
    since = as_of - timedelta(days=AFTER_HISTORY_DAYS)
    counts: Dict[int, int] = defaultdict(int)
    rows = (
        db.query(AfterGrant)
        .filter(
            AfterGrant.company_id == company_id,
            AfterGrant.start_at < as_of,
            AfterGrant.end_at > since,
        )
        .all()
    )
    for g in rows:
        counts[g.person_id] += 1
    return dict(counts)


@dataclass
class AfterCandidate:
    person_id: int
    person_name: str
    after_count_30d: int
    sleep_warning: bool = False
    sleep_warning_message: Optional[str] = None
    recommended_rank: int = 0


@dataclass
class AfterPreview:
    total_active: int
    min_kanim: int
    after_quota: int
    candidates: List[AfterCandidate] = field(default_factory=list)
    drafts: List[AfterDraft] = field(default_factory=list)


def build_after_preview(db: Session, schedule: Schedule) -> AfterPreview:
    rules = (
        db.query(KanimRule).filter(KanimRule.company_id == schedule.company_id).all()
    )
    min_kanim = max_kanim_in_window(rules, schedule.window_start, schedule.window_end)
    people = (
        db.query(Person)
        .options(joinedload(Person.role))
        .filter(Person.company_id == schedule.company_id, Person.is_active.is_(True))
        .all()
    )
    total_active = len(people)
    after_quota = max(0, total_active - min_kanim)

    assigned_ids = {
        a.person_id
        for a in db.query(Assignment).filter(Assignment.schedule_id == schedule.id).all()
    }

    after_counts = after_count_map(db, schedule.company_id, schedule.window_start)

    from app.services.policy_rules import (
        evaluate_sleep_before_after,
        load_active_scheduling_rules,
    )
    from app.models import SchedulingRuleKind

    sleep_rules = [
        r
        for r in load_active_scheduling_rules(db, schedule.company_id)
        if (
            r.rule_kind == SchedulingRuleKind.SLEEP_BEFORE_AFTER
            or str(getattr(r.rule_kind, "value", r.rule_kind)) == "sleep_before_after"
        )
    ]

    free = [p for p in people if p.id not in assigned_ids]
    free.sort(key=lambda p: (after_counts.get(p.id, 0), p.full_name))

    # Default proposed after start = beginning of the schedule day.
    proposed_start = schedule.window_start

    candidates: List[AfterCandidate] = []
    for rank, p in enumerate(free, start=1):
        sleep_warning = False
        msg = None
        if sleep_rules:
            hits = evaluate_sleep_before_after(
                db,
                company_id=schedule.company_id,
                person=p,
                after_start=proposed_start,
                rules=sleep_rules,
                prior_end_limit=schedule.window_end,
            )
            if hits:
                sleep_warning = True
                hard = [v for v in hits if v.severity == "hard"]
                msg = (hard or hits)[0].message
        candidates.append(
            AfterCandidate(
                person_id=p.id,
                person_name=p.full_name,
                after_count_30d=after_counts.get(p.id, 0),
                sleep_warning=sleep_warning,
                sleep_warning_message=msg,
                recommended_rank=rank,
            )
        )

    drafts = (
        db.query(AfterDraft)
        .filter(AfterDraft.schedule_id == schedule.id)
        .order_by(AfterDraft.start_at)
        .all()
    )
    return AfterPreview(
        total_active=total_active,
        min_kanim=min_kanim,
        after_quota=after_quota,
        candidates=candidates,
        drafts=drafts,
    )


def save_after_drafts(
    db: Session,
    schedule: Schedule,
    items: List[Tuple[int, datetime, datetime]],
) -> List[AfterDraft]:
    if schedule.status != ScheduleStatus.DRAFT:
        raise ValueError("ניתן לערוך אפטרים רק בטיוטה")
    preview = build_after_preview(db, schedule)
    if len(items) > preview.after_quota:
        raise ValueError(
            f"חריגה ממכסת אפטר ({preview.after_quota}). בדקו את מספר הקנים בהגדרות."
        )
    eligible = {c.person_id for c in preview.candidates}
    for person_id, start, end in items:
        if person_id not in eligible:
            raise ValueError("ניתן לפרגן אפטר רק לחיילים ללא משימה בחלון")
        if end <= start:
            raise ValueError("סיום האפטר חייב להיות אחרי ההתחלה")

    from app.services.policy_rules import (
        evaluate_min_presence_rules,
        evaluate_sleep_before_after,
        load_active_scheduling_rules,
    )
    from app.models import SchedulingRuleKind

    sleep_rules = [
        r
        for r in load_active_scheduling_rules(db, schedule.company_id)
        if (
            r.rule_kind == SchedulingRuleKind.SLEEP_BEFORE_AFTER
            or str(getattr(r.rule_kind, "value", r.rule_kind)) == "sleep_before_after"
        )
    ]
    people_by_id = {
        p.id: p
        for p in db.query(Person)
        .filter(Person.company_id == schedule.company_id)
        .all()
    }

    for person_id, start, end in items:
        person = people_by_id.get(person_id)
        if not person:
            person = db.query(Person).filter(Person.id == person_id).first()
        if person and sleep_rules:
            sleep_hits = evaluate_sleep_before_after(
                db,
                company_id=schedule.company_id,
                person=person,
                after_start=start,
                rules=sleep_rules,
            )
            hard_sleep = [v for v in sleep_hits if v.severity == "hard"]
            if hard_sleep:
                raise ValueError(hard_sleep[0].message)

    db.query(AfterDraft).filter(AfterDraft.schedule_id == schedule.id).delete()
    created: List[AfterDraft] = []
    for person_id, start, end in items:
        row = AfterDraft(
            schedule_id=schedule.id,
            person_id=person_id,
            start_at=start,
            end_at=end,
        )
        db.add(row)
        created.append(row)
    db.flush()

    presence = evaluate_min_presence_rules(
        db,
        schedule=schedule,
        provisional_afters=items,
    )
    hard = [v for v in presence if v.severity == "hard"]
    if hard:
        raise ValueError(hard[0].message)

    return created


def commit_after_drafts_on_publish(db: Session, schedule: Schedule) -> None:
    """Persist after grants + temporary leave. GENERATE != COMMIT until here."""
    drafts = (
        db.query(AfterDraft).filter(AfterDraft.schedule_id == schedule.id).all()
    )
    for d in drafts:
        db.add(
            AfterGrant(
                company_id=schedule.company_id,
                person_id=d.person_id,
                schedule_id=schedule.id,
                start_at=d.start_at,
                end_at=d.end_at,
                granted_at=datetime.utcnow(),
            )
        )
        db.add(
            LeavePeriod(
                person_id=d.person_id,
                leave_type=LeaveType.TEMPORARY_ABSENCE,
                start_at=d.start_at,
                end_at=d.end_at,
                notes="אפטר (אושר בפרסום שיבוץ)",
            )
        )
    db.query(AfterDraft).filter(AfterDraft.schedule_id == schedule.id).delete()
    db.flush()
