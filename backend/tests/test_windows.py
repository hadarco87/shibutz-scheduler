from datetime import datetime

from app.services.windows import (
    format_hhmm,
    parse_hhmm,
    shifts_for_windows_in_range,
    window_datetimes,
)


def test_parse_hhmm_variants():
    assert parse_hhmm("05:30") == 5 * 60 + 30
    assert parse_hhmm("1830") == 18 * 60 + 30
    assert parse_hhmm("7:00") == 7 * 60


def test_same_day_window():
    start, end = window_datetimes(datetime(2026, 9, 15), 5 * 60 + 30, 7 * 60)
    assert start == datetime(2026, 9, 15, 5, 30)
    assert end == datetime(2026, 9, 15, 7, 0)


def test_overnight_window():
    start, end = window_datetimes(datetime(2026, 9, 15), 22 * 60, 6 * 60)
    assert start == datetime(2026, 9, 15, 22, 0)
    assert end == datetime(2026, 9, 16, 6, 0)


def test_hapak_two_windows_in_day():
    ws = datetime(2026, 9, 15, 0, 0)
    we = datetime(2026, 9, 16, 0, 0)
    shifts = shifts_for_windows_in_range(
        ws,
        we,
        [(5 * 60 + 30, 7 * 60), (18 * 60, 19 * 60 + 30)],
    )
    assert shifts == [
        (datetime(2026, 9, 15, 5, 30), datetime(2026, 9, 15, 7, 0)),
        (datetime(2026, 9, 15, 18, 0), datetime(2026, 9, 15, 19, 30)),
    ]


def test_format_roundtrip():
    assert format_hhmm(parse_hhmm("19:30")) == "19:30"
