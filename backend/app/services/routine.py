"""Routine mission shift helpers (start hour + duration within a calendar day)."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import List, Tuple


def routine_covers_full_day(duration_hours: float) -> bool:
    if duration_hours <= 0:
        return False
    # Allow small float noise
    steps = round(24 / duration_hours, 6)
    return abs(steps - round(steps)) < 1e-6


def build_routine_segments(
    duration_hours: float,
    start_hour: int,
    remainder_policy: str = "include_short",
) -> Tuple[List[Tuple[float, float]], float]:
    """Return ([(start_hour_mod_24, length), ...], remainder_hours).

    Walks a 24h cycle starting at start_hour. If duration does not divide 24,
    remainder_policy decides whether to append a short final segment.
    """
    if duration_hours <= 0:
        return [], 24.0
    segments: List[Tuple[float, float]] = []
    elapsed = 0.0
    t = float(start_hour)
    while elapsed + duration_hours <= 24 + 1e-9:
        segments.append((t % 24, float(duration_hours)))
        t += duration_hours
        elapsed += duration_hours
    rem = round(24.0 - elapsed, 6)
    if rem > 1e-6 and remainder_policy == "include_short":
        segments.append((t % 24, rem))
        rem = 0.0
    return segments, max(0.0, rem)


def shifts_for_calendar_day(
    day_start: datetime,
    duration_hours: float,
    start_hour: int,
    remainder_policy: str = "include_short",
) -> List[Tuple[datetime, datetime]]:
    """Mission intervals whose start falls inside [day_start, day_start+1day)."""
    day_start = day_start.replace(hour=0, minute=0, second=0, microsecond=0)
    segments, _ = build_routine_segments(duration_hours, start_hour, remainder_policy)
    out: List[Tuple[datetime, datetime]] = []
    for hour_mod, length in segments:
        # hour_mod may be fractional in theory; keep minutes
        hours = int(hour_mod)
        minutes = int(round((hour_mod - hours) * 60))
        start = day_start + timedelta(hours=hours, minutes=minutes)
        end = start + timedelta(hours=length)
        out.append((start, end))
    out.sort(key=lambda x: x[0])
    return out
