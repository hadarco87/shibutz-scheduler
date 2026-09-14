from datetime import datetime, timedelta

from app.models import KanimRule, KanimRuleKind
from app.services.after import max_kanim_in_window, resolve_kanim_for_date


def test_specific_date_overrides_weekday():
    rules = [
        KanimRule(id=1, company_id=1, kind=KanimRuleKind.WEEKDAY, min_count=10),
        KanimRule(id=2, company_id=1, kind=KanimRuleKind.WEEKEND, min_count=20),
        KanimRule(
            id=3,
            company_id=1,
            kind=KanimRuleKind.SPECIFIC_DATE,
            min_count=5,
            specific_date=datetime(2026, 9, 14).date(),  # Monday
        ),
    ]
    assert resolve_kanim_for_date(rules, datetime(2026, 9, 14).date()) == 5
    assert resolve_kanim_for_date(rules, datetime(2026, 9, 15).date()) == 10  # Tue
    assert resolve_kanim_for_date(rules, datetime(2026, 9, 12).date()) == 20  # Sat


def test_max_kanim_across_window():
    rules = [
        KanimRule(id=1, company_id=1, kind=KanimRuleKind.WEEKDAY, min_count=12),
        KanimRule(id=2, company_id=1, kind=KanimRuleKind.WEEKEND, min_count=18),
    ]
    # Fri noon → Sat noon: weekend rule applies
    start = datetime(2026, 9, 11, 12, 0)  # Friday
    end = datetime(2026, 9, 12, 12, 0)
    assert max_kanim_in_window(rules, start, end) == 18
