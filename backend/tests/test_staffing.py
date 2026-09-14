from datetime import datetime

from app.services.staffing import (
    StaffingReq,
    minute_in_band,
    resolve_staffing_for_start,
)


def test_minute_in_band_day_and_night():
    assert minute_in_band(6 * 60, 6 * 60, 18 * 60) is True
    assert minute_in_band(12 * 60, 6 * 60, 18 * 60) is True
    assert minute_in_band(18 * 60, 6 * 60, 18 * 60) is False
    assert minute_in_band(18 * 60, 18 * 60, 6 * 60) is True
    assert minute_in_band(2 * 60, 18 * 60, 6 * 60) is True
    assert minute_in_band(10 * 60, 18 * 60, 6 * 60) is False


def test_resolve_sg_style_bands():
    day_req = [StaffingReq(role_id=1, qualification_id=None, count=1)]
    night_req = [StaffingReq(role_id=1, qualification_id=None, count=2)]
    bands = [
        (6 * 60, 18 * 60, 1, "יום", day_req),
        (18 * 60, 6 * 60, 2, "לילה", night_req),
    ]
    day = resolve_staffing_for_start(
        datetime(2026, 9, 15, 14, 0),
        default_personnel=1,
        default_requirements=day_req,
        bands=bands,
    )
    night = resolve_staffing_for_start(
        datetime(2026, 9, 15, 18, 0),
        default_personnel=1,
        default_requirements=day_req,
        bands=bands,
    )
    assert day.personnel_count == 1 and day.band_label == "יום"
    assert night.personnel_count == 2 and night.band_label == "לילה"
