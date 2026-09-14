"""Workload index helpers.

Final weight per assignment:
    workload = mission_difficulty × hours_served

Only published assignments create WorkloadEvent deltas (GENERATE != COMMIT).
"""

from __future__ import annotations

from datetime import datetime


def mission_duration_hours(start_at: datetime, end_at: datetime) -> float:
    seconds = (end_at - start_at).total_seconds()
    return max(seconds / 3600.0, 0.0)


def compute_workload_weight(difficulty: float, hours: float) -> float:
    """שקלול סופי: רמת קושי × שעות שירות."""
    return float(difficulty) * float(hours)
