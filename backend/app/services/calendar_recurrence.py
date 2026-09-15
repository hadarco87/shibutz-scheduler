"""Calendar-day recurrence matching for restrictions and routine missions."""

from __future__ import annotations

from datetime import date, datetime
from typing import Optional, Union


def day_matches_recurrence(
    day: Union[datetime, date],
    kind: str,
    *,
    interval_days: int = 1,
    weekdays: Optional[str] = None,
    anchor_date: Optional[Union[datetime, date]] = None,
) -> bool:
    """Return True if calendar day is an occurrence of the recurrence rule.

    kind: daily | every_n_days | weekly
    weekdays: comma-separated Python weekdays (0=Mon … 6=Sun)
    anchor_date: required meaningfully for every_n_days (day 0 of the cycle)
    """
    if isinstance(day, datetime):
        day0 = day.replace(hour=0, minute=0, second=0, microsecond=0)
    else:
        day0 = datetime(day.year, day.month, day.day)

    kind_norm = (kind or "daily").strip().lower()
    if kind_norm == "daily":
        return True

    if kind_norm == "every_n_days":
        interval = max(int(interval_days or 1), 1)
        if interval <= 1:
            return True
        if anchor_date is None:
            return False
        if isinstance(anchor_date, datetime):
            anchor = anchor_date.replace(hour=0, minute=0, second=0, microsecond=0)
        else:
            anchor = datetime(anchor_date.year, anchor_date.month, anchor_date.day)
        delta = (day0 - anchor).days
        return delta >= 0 and delta % interval == 0

    if kind_norm == "weekly":
        raw = (weekdays or "").strip()
        if not raw:
            return False
        days = {int(x.strip()) for x in raw.split(",") if x.strip() != ""}
        return day0.weekday() in days

    return False
