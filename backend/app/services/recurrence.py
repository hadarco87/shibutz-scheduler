"""Recurring restriction window matching."""

from __future__ import annotations

from datetime import datetime, timedelta, time
from typing import List, Optional, Tuple

from app.models import RecurringRestriction
from app.services.calendar_recurrence import day_matches_recurrence


def _parse_hhmm(value: str) -> time:
    parts = (value or "00:00").split(":")
    hour = int(parts[0])
    minute = int(parts[1]) if len(parts) > 1 else 0
    if hour == 24:
        return time(23, 59)
    return time(hour, minute)


def _windows_for_day(
    day: datetime, time_start: str, time_end: str
) -> List[Tuple[datetime, datetime]]:
    """Return one or two datetime windows for a calendar day."""
    start_t = _parse_hhmm(time_start)
    end_t = _parse_hhmm(time_end)
    day0 = day.replace(hour=0, minute=0, second=0, microsecond=0)
    start_dt = day0.replace(hour=start_t.hour, minute=start_t.minute)
    end_dt = day0.replace(hour=end_t.hour, minute=end_t.minute)
    if end_t <= start_t:
        # overnight: day start→midnight next, and/or treat as start→next day end
        return [(start_dt, day0 + timedelta(days=1) + (end_dt - day0))]
    if start_t == time(0, 0) and end_t >= time(23, 59):
        return [(day0, day0 + timedelta(days=1))]
    return [(start_dt, end_dt)]


def _day_matches(rule: RecurringRestriction, day: datetime) -> bool:
    if rule.active_from and day < rule.active_from.replace(
        hour=0, minute=0, second=0, microsecond=0
    ):
        return False
    if rule.active_until:
        until = rule.active_until.replace(hour=23, minute=59, second=59)
        if day > until:
            return False

    return day_matches_recurrence(
        day,
        rule.kind.value if hasattr(rule.kind, "value") else str(rule.kind),
        interval_days=rule.interval_days or 1,
        weekdays=rule.weekdays,
        anchor_date=rule.anchor_date or rule.active_from,
    )


def recurring_windows_overlapping(
    rule: RecurringRestriction, start: datetime, end: datetime
) -> List[Tuple[datetime, datetime]]:
    """Expand rule into concrete windows that overlap [start, end)."""
    if not rule.is_active:
        return []
    windows: List[Tuple[datetime, datetime]] = []
    day = start.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=1)
    last = end.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)
    while day <= last:
        if _day_matches(rule, day):
            for w_start, w_end in _windows_for_day(day, rule.time_start, rule.time_end):
                if w_start < end and start < w_end:
                    windows.append((w_start, w_end))
        day += timedelta(days=1)
    return windows


def blocking_recurring_restriction(
    person_restrictions: List[RecurringRestriction],
    mission_start: datetime,
    mission_end: datetime,
    mission_type_id: Optional[int] = None,
    required_qualification_ids: Optional[set] = None,
) -> Optional[RecurringRestriction]:
    required_qualification_ids = required_qualification_ids or set()
    for rule in person_restrictions:
        if not recurring_windows_overlapping(rule, mission_start, mission_end):
            continue
        if rule.unavailable and rule.mission_type_id is None and rule.qualification_id is None:
            return rule
        if rule.mission_type_id and mission_type_id == rule.mission_type_id:
            return rule
        if rule.qualification_id and rule.qualification_id in required_qualification_ids:
            return rule
    return None
