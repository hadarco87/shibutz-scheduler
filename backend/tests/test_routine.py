from datetime import datetime

from app.services.routine import (
    build_routine_segments,
    routine_covers_full_day,
    shifts_for_calendar_day,
)


def test_routine_covers_full_day():
    assert routine_covers_full_day(8) is True
    assert routine_covers_full_day(4) is True
    assert routine_covers_full_day(6) is True
    assert routine_covers_full_day(10) is False
    assert routine_covers_full_day(7) is False


def test_include_short_segments():
    segs, rem = build_routine_segments(10, 8, "include_short")
    assert rem == 0
    assert [(round(s, 3), round(l, 3)) for s, l in segs] == [
        (8.0, 10.0),
        (18.0, 10.0),
        (4.0, 4.0),
    ]


def test_full_only_leaves_gap():
    segs, rem = build_routine_segments(10, 8, "full_only")
    assert rem == 4.0
    assert [(round(s, 3), round(l, 3)) for s, l in segs] == [
        (8.0, 10.0),
        (18.0, 10.0),
    ]


def test_eight_hour_from_thirteen():
    segs, rem = build_routine_segments(8, 13, "include_short")
    assert rem == 0
    assert [(round(s), round(l)) for s, l in segs] == [
        (13, 8),
        (21, 8),
        (5, 8),
    ]


def test_shifts_for_calendar_day():
    day = datetime(2026, 9, 15)
    shifts = shifts_for_calendar_day(day, 8, 13, "include_short")
    assert len(shifts) == 3
    assert shifts[0][0] == datetime(2026, 9, 15, 5, 0)
    assert shifts[1][0] == datetime(2026, 9, 15, 13, 0)
    assert shifts[2][0] == datetime(2026, 9, 15, 21, 0)
    assert shifts[2][1] == datetime(2026, 9, 16, 5, 0)
