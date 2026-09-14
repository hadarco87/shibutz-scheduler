"""Routine staffing bands: different headcount by clock window."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import List, Optional, Sequence, Tuple


@dataclass
class StaffingReq:
    role_id: Optional[int]
    qualification_id: Optional[int]
    count: int


@dataclass
class ResolvedStaffing:
    personnel_count: int
    requirements: List[StaffingReq]
    band_label: Optional[str] = None


def minute_in_band(minute: int, start_minute: int, end_minute: int) -> bool:
    m = int(minute) % 1440
    s = int(start_minute) % 1440
    e = int(end_minute) % 1440
    if s == e:
        return True
    if s < e:
        return s <= m < e
    return m >= s or m < e


def find_band_for_minute(
    minute: int,
    bands: Sequence[Tuple[int, int, object]],
) -> Optional[object]:
    """bands: [(start_minute, end_minute, band_obj), ...] — first match wins."""
    for start_m, end_m, band in bands:
        if minute_in_band(minute, start_m, end_m):
            return band
    return None


def resolve_staffing_for_start(
    start_at: datetime,
    *,
    default_personnel: int,
    default_requirements: Sequence[StaffingReq],
    bands: Sequence[
        Tuple[int, int, int, Optional[str], Sequence[StaffingReq]]
    ],
) -> ResolvedStaffing:
    """Pick staffing by shift start time.

    bands items: (start_minute, end_minute, personnel, label, requirements)
    """
    minute = start_at.hour * 60 + start_at.minute
    for start_m, end_m, personnel, label, reqs in bands:
        if minute_in_band(minute, start_m, end_m):
            return ResolvedStaffing(
                personnel_count=max(1, int(personnel)),
                requirements=list(reqs),
                band_label=label,
            )
    return ResolvedStaffing(
        personnel_count=max(1, int(default_personnel)),
        requirements=list(default_requirements),
        band_label=None,
    )
