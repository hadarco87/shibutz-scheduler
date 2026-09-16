"""Non-routine mission type clock windows (support overnight)."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import List, Tuple


def parse_hhmm(value: str) -> int:
    """Parse 'HH:MM' or 'HMM' / 'HHMM' loosely into minutes from midnight."""
    raw = (value or "").strip().replace(".", ":")
    if ":" in raw:
        parts = raw.split(":")
        if len(parts) != 2:
            raise ValueError(f"שעה לא חוקית: {value}")
        hour, minute = int(parts[0]), int(parts[1])
    elif raw.isdigit() and len(raw) in (3, 4):
        hour = int(raw[:-2])
        minute = int(raw[-2:])
    else:
        raise ValueError(f"שעה לא חוקית: {value}")
    if hour < 0 or hour > 23 or minute < 0 or minute > 59:
        raise ValueError(f"שעה לא חוקית: {value}")
    return hour * 60 + minute


def format_hhmm(minute: int) -> str:
    m = int(minute) % (24 * 60)
    return f"{m // 60:02d}:{m % 60:02d}"


def window_datetimes(
    day_start: datetime,
    start_minute: int,
    end_minute: int,
) -> Tuple[datetime, datetime]:
    """Map a clock window onto a calendar day. end <= start ⇒ ends next day."""
    day = day_start.replace(hour=0, minute=0, second=0, microsecond=0)
    start = day + timedelta(minutes=int(start_minute))
    end = day + timedelta(minutes=int(end_minute))
    if end_minute <= start_minute:
        end += timedelta(days=1)
    if end <= start:
        raise ValueError("טווח שעות חייב להיות חיובי")
    return start, end


def shifts_for_windows_in_range(
    window_start: datetime,
    window_end: datetime,
    windows: List[Tuple[int, int]],
) -> List[Tuple[datetime, datetime]]:
    """Create mission intervals overlapping [window_start, window_end).

    Includes overnight carry-in from the previous calendar day (start before
    window_start, end inside the window).
    """
    if not windows:
        return []
    day = window_start.replace(hour=0, minute=0, second=0, microsecond=0)
    last = (window_end - timedelta(microseconds=1)).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    out: List[Tuple[datetime, datetime]] = []
    d = day - timedelta(days=1)
    while d <= last:
        for start_m, end_m in windows:
            start, end = window_datetimes(d, start_m, end_m)
            if start < window_end and end > window_start:
                out.append((start, end))
        d += timedelta(days=1)
    out.sort(key=lambda x: x[0])
    return out
