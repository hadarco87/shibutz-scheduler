"""Seed company data for local development — real roster + mission types."""

from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import (
    Assignment,
    Company,
    ConstraintSeverity,
    ConstraintType,
    KanimRule,
    KanimRuleKind,
    Mission,
    MissionType,
    MissionTypeRequirement,
    MissionTypeWindow,
    MissionTypeStaffingBand,
    MissionTypeBandRequirement,
    Person,
    PersonQualification,
    Qualification,
    Role,
    RoleCapability,
    Schedule,
    ScheduleStatus,
    SchedulingConstraint,
    SchedulingRule,
    SchedulingRuleKind,
    SchedulingRuleSourceType,
    User,
    UserRole,
    WorkloadEvent,
    WorkloadSnapshot,
    WorkloadSnapshotEntry,
)
from app.security import get_password_hash


# Real personnel list (as provided). role_key: soldier | commander | nco
ROSTER = [
    ("דורון סמוקלובר", "commander"),
    ("גל פריצר ולדמן", "commander"),
    ("אלון טורוביצקי", "nco"),
    ("נדב מאור", "soldier"),
    ("אמנון גמבר", "soldier"),
    ("ערן מליל", "soldier"),
    ("הדר כהן", "nco"),
    ("אברהם בן חמו", "soldier"),
    ("מולגטה פנטה", "soldier"),
    ("בני דסה", "soldier"),
    ("יוסי דפוסי", "soldier"),
    ("ליאור חיים ויקלר", "soldier"),
    ("אורן חזקיהו", "soldier"),
    ("דוד קוסוף", "soldier"),
    ("לירן משה", "soldier"),
    ("כפיר אברהם", "soldier"),
    ("גיא ויינברג", "soldier"),
    ("דור אלקובי", "soldier"),
    ("אשר צור", "soldier"),
    ("יוחאי דוד", "soldier"),
    ("משה דוד", "soldier"),
    ("אביתר נצר", "soldier"),
    ("אלכסנדר קופרשיין", "soldier"),
    ("ברוך מאיר בוז'ובסקי", "soldier"),
    ("כפיר אשואל", "soldier"),
    ("סמואל אשואל", "soldier"),
    ("דור לוי", "soldier"),
    ("ערן נפתלי", "soldier"),
    ("רועי נגר", "soldier"),
    ("שגב צפניה", "soldier"),
    ("אלכסנדר אריפין", "soldier"),
    ("חיים בולוסקי", "soldier"),
    ("אדיסו אסמר", "soldier"),
    ("אסף יעקובי", "soldier"),
    ("רן שיא", "nco"),
    ("יוסף עבד אלחאק", "soldier"),
    ("ארז דגן", "soldier"),
    ("תמיר דגן", "soldier"),
    ("לוקאס משול", "soldier"),
    ("לוי מזרחי", "soldier"),
    ("גיא שריר", "soldier"),
    ("רועי כהן", "soldier"),
    ("שחר כהן", "soldier"),
    ("יונתן חור", "soldier"),
    ("לירון בן הרוש", "soldier"),
    ("עלי היב", "soldier"),
    ("דניאל קריף", "soldier"),
    ("אלעד חזן", "soldier"),
    ("אבי יוסף", "soldier"),
    ("חגי דגן", "soldier"),
    ("דניאל צור", "soldier"),
    ("עמית רחמים", "soldier"),
    ("אמיר ברינר", "soldier"),
    ("דור בר", "soldier"),
    ("אייל סגל", "soldier"),
    ("נדב חיים ליטמן", "soldier"),
    ("ערן קמבר", "soldier"),
    ("תמור טוויל", "soldier"),
    ("ניר פרץ", "soldier"),
    ("אורי ברק", "soldier"),
    ("ולדימיר מור", "soldier"),
    ("יוחאי", "soldier"),
    ("ינון כוכבי", "soldier"),
    ("רותם אלקיים", "soldier"),
    ("אלמוג אשכנזי", "soldier"),
    ("ארז חלק", "soldier"),
]


def seed_if_empty(db: Session) -> None:
    if db.query(Company).first():
        return

    settings = get_settings()
    company = Company(name="פלוגה א'")
    db.add(company)
    db.flush()

    admin = User(
        company_id=company.id,
        email=settings.default_admin_email,
        full_name="קצין שיבוץ",
        hashed_password=get_password_hash(settings.default_admin_password),
        role=UserRole.COMMANDER,
    )
    db.add(admin)

    soldier = Role(company_id=company.id, name="חייל", description="חייל מן השורה")
    commander = Role(company_id=company.id, name="מפקד", description="מפקד משימה")
    nco = Role(company_id=company.id, name="מפקד זוטר", description="מש״ק")
    db.add_all([soldier, commander, nco])
    db.flush()

    for role in (soldier, commander, nco):
        db.add(RoleCapability(role_id=role.id, can_fulfill_role_id=soldier.id))
    db.add(RoleCapability(role_id=commander.id, can_fulfill_role_id=commander.id))
    db.add(RoleCapability(role_id=nco.id, can_fulfill_role_id=nco.id))
    db.add(RoleCapability(role_id=commander.id, can_fulfill_role_id=nco.id))
    db.add(RoleCapability(role_id=nco.id, can_fulfill_role_id=commander.id))

    medic = Qualification(company_id=company.id, name="חובש")
    radio = Qualification(company_id=company.id, name="קשר")
    marksman = Qualification(company_id=company.id, name="צלף")
    db.add_all([medic, radio, marksman])
    db.flush()

    db.add(
        SchedulingConstraint(
            company_id=company.id,
            name="מנוחה מינימלית",
            constraint_type=ConstraintType.MINIMUM_REST,
            severity=ConstraintSeverity.HARD,
            value=6.0,
            description="לפחות 6 שעות מנוחה לפני משימה",
        )
    )
    db.add(
        SchedulingConstraint(
            company_id=company.id,
            name="הוגנות עומס",
            constraint_type=ConstraintType.WORKLOAD_FAIRNESS,
            severity=ConstraintSeverity.SOFT,
            weight=1.0,
            description="העדפת חיילים עם עומס היסטורי נמוך יותר",
        )
    )

    # Mission types from the operational chart legend
    # name, difficulty, personnel, duration_h, recurring?, start_hour
    mission_defs = [
        ("סיור", 4, 4, 8, True, 13),
        ("כרמל", 4, 4, 8, True, 13),
        ('ש"ג', 2, 1, 4, True, 6),
        ("קצין מוצב", 3, 1, 8, True, 8),
        ("יזומה", 5, 6, 5, False, None),
        ('חוץ רס"פ', 3, 2, 8, False, None),
        ('חפ"ק', 3, 3, 8, False, None),
        ("מתנדב מטבח", 1, 2, 4, True, 8),
        ("אימון", 2, 8, 4, False, None),
        ('חמ"ל', 2, 2, 8, True, 8),
        ("ליווי רכב", 3, 2, 4, False, None),
    ]

    mission_types = {}
    for name, diff, count, dur, recurring, start_h in mission_defs:
        mt = MissionType(
            company_id=company.id,
            name=name,
            description=name,
            default_duration_hours=dur,
            difficulty_weight=diff,
            default_personnel_count=count,
            is_recurring_template=recurring,
            recurring_start_hour=start_h,
            recurring_end_hour=None,
            required_sleep_hours_before_after=0,
            routine_remainder_policy="include_short",
        )
        db.add(mt)
        db.flush()
        mission_types[name] = mt

    # Sleep before after — configured as a scheduling rule (not on mission types)
    sleep_rule = SchedulingRule(
        company_id=company.id,
        name="שינה לפני אפטר אחרי סיור/כרמל",
        rule_kind=SchedulingRuleKind.SLEEP_BEFORE_AFTER,
        cooldown_hours=6.0,
        severity=ConstraintSeverity.HARD,
        applies_to_all_roles=True,
        is_active=True,
    )
    db.add(sleep_rule)
    db.flush()
    for key in ("סיור", "כרמל"):
        db.add(
            SchedulingRuleSourceType(
                rule_id=sleep_rule.id, mission_type_id=mission_types[key].id
            )
        )

    # Default clock windows for non-routine types (overnight-capable)
    seed_windows = {
        "יזומה": [(8 * 60, 13 * 60)],
        'חוץ רס"פ': [(8 * 60, 16 * 60)],
        'חפ"ק': [(5 * 60 + 30, 7 * 60), (18 * 60, 19 * 60 + 30)],
        "אימון": [(8 * 60, 12 * 60)],
        "ליווי רכב": [(6 * 60, 10 * 60)],
    }
    for name, windows in seed_windows.items():
        mt = mission_types[name]
        for i, (sm, em) in enumerate(windows):
            db.add(
                MissionTypeWindow(
                    mission_type_id=mt.id,
                    start_minute=sm,
                    end_minute=em,
                    sort_order=i,
                )
            )

    # ש״ג: day 1 soldier / night 2 soldiers
    sg = mission_types['ש"ג']
    day_band = MissionTypeStaffingBand(
        mission_type_id=sg.id,
        label="יום",
        start_minute=6 * 60,
        end_minute=18 * 60,
        personnel_count=1,
        sort_order=0,
    )
    night_band = MissionTypeStaffingBand(
        mission_type_id=sg.id,
        label="לילה",
        start_minute=18 * 60,
        end_minute=6 * 60,
        personnel_count=2,
        sort_order=1,
    )
    db.add_all([day_band, night_band])
    db.flush()
    db.add(
        MissionTypeBandRequirement(
            band_id=day_band.id, role_id=soldier.id, count=1
        )
    )
    db.add(
        MissionTypeBandRequirement(
            band_id=night_band.id, role_id=soldier.id, count=2
        )
    )

    # Default staffing requirements
    db.add_all(
        [
            MissionTypeRequirement(
                mission_type_id=mission_types["סיור"].id, role_id=commander.id, count=1
            ),
            MissionTypeRequirement(
                mission_type_id=mission_types["סיור"].id, qualification_id=medic.id, count=1
            ),
            MissionTypeRequirement(
                mission_type_id=mission_types["סיור"].id, qualification_id=radio.id, count=1
            ),
            MissionTypeRequirement(
                mission_type_id=mission_types["סיור"].id, role_id=soldier.id, count=1
            ),
            MissionTypeRequirement(
                mission_type_id=mission_types["כרמל"].id, role_id=commander.id, count=1
            ),
            MissionTypeRequirement(
                mission_type_id=mission_types["כרמל"].id, role_id=soldier.id, count=3
            ),
            MissionTypeRequirement(
                mission_type_id=mission_types["קצין מוצב"].id,
                role_id=commander.id,
                count=1,
            ),
            MissionTypeRequirement(
                mission_type_id=mission_types["יזומה"].id, role_id=commander.id, count=1
            ),
            MissionTypeRequirement(
                mission_type_id=mission_types["יזומה"].id,
                qualification_id=medic.id,
                count=1,
            ),
            MissionTypeRequirement(
                mission_type_id=mission_types["יזומה"].id,
                qualification_id=radio.id,
                count=1,
            ),
            MissionTypeRequirement(
                mission_type_id=mission_types["יזומה"].id, role_id=soldier.id, count=3
            ),
            MissionTypeRequirement(
                mission_type_id=mission_types['חוץ רס"פ'].id, role_id=nco.id, count=1
            ),
            MissionTypeRequirement(
                mission_type_id=mission_types['חוץ רס"פ'].id, role_id=soldier.id, count=1
            ),
            MissionTypeRequirement(
                mission_type_id=mission_types['חפ"ק'].id, role_id=commander.id, count=1
            ),
            MissionTypeRequirement(
                mission_type_id=mission_types['חפ"ק'].id, role_id=soldier.id, count=2
            ),
            MissionTypeRequirement(
                mission_type_id=mission_types["מתנדב מטבח"].id,
                role_id=soldier.id,
                count=2,
            ),
            MissionTypeRequirement(
                mission_type_id=mission_types["אימון"].id, role_id=soldier.id, count=8
            ),
            MissionTypeRequirement(
                mission_type_id=mission_types['חמ"ל'].id, role_id=commander.id, count=1
            ),
            MissionTypeRequirement(
                mission_type_id=mission_types['חמ"ל'].id, role_id=soldier.id, count=1
            ),
            MissionTypeRequirement(
                mission_type_id=mission_types["ליווי רכב"].id, role_id=soldier.id, count=2
            ),
        ]
    )

    role_by_key = {
        "soldier": soldier.id,
        "commander": commander.id,
        "nco": nco.id,
    }

    # Spread a few qualifications so scheduling has medics/radios
    qual_cycle = [
        [medic.id],
        [radio.id],
        [],
        [medic.id, radio.id],
        [marksman.id],
        [],
        [radio.id],
        [medic.id],
    ]

    people = []
    for idx, (name, role_key) in enumerate(ROSTER):
        p = Person(
            company_id=company.id,
            full_name=name,
            role_id=role_by_key[role_key],
        )
        db.add(p)
        db.flush()
        for qid in qual_cycle[idx % len(qual_cycle)]:
            db.add(PersonQualification(person_id=p.id, qualification_id=qid))
        people.append(p)

    # Descending starter workload so fairness is visible (until real published history accumulates)
    n = len(people)
    seed_loads = [max(4.0, round(180 - i * (160 / max(n - 1, 1)), 1)) for i in range(n)]

    snapshot = WorkloadSnapshot(
        company_id=company.id,
        taken_at=datetime.utcnow() - timedelta(days=1),
        note="מדד עומס התחלתי",
    )
    db.add(snapshot)
    db.flush()
    for person, load in zip(people, seed_loads):
        db.add(
            WorkloadSnapshotEntry(
                snapshot_id=snapshot.id, person_id=person.id, total_workload=float(load)
            )
        )

    hist = Schedule(
        company_id=company.id,
        window_start=datetime.utcnow() - timedelta(days=2),
        window_end=datetime.utcnow() - timedelta(days=1),
        status=ScheduleStatus.PUBLISHED,
        created_by_id=admin.id,
        approved_by_id=admin.id,
        published_at=datetime.utcnow() - timedelta(days=1),
        notes="שיבוץ היסטורי התחלתי (seed)",
    )
    db.add(hist)
    db.flush()
    hist_mission = Mission(
        company_id=company.id,
        mission_type_id=mission_types["סיור"].id,
        name="סיור היסטורי",
        start_at=hist.window_start,
        end_at=hist.window_start + timedelta(hours=8),
        difficulty_weight=1,
        personnel_count=1,
        schedule_id=hist.id,
    )
    db.add(hist_mission)
    db.flush()

    for person, load in zip(people, seed_loads):
        a = Assignment(
            schedule_id=hist.id,
            mission_id=hist_mission.id,
            person_id=person.id,
            is_manual=True,
            difficulty_at_assignment=1.0,
        )
        db.add(a)
        db.flush()
        db.add(
            WorkloadEvent(
                company_id=company.id,
                person_id=person.id,
                schedule_id=hist.id,
                assignment_id=a.id,
                mission_id=hist_mission.id,
                mission_type_id=mission_types["סיור"].id,
                difficulty_weight=1.0,
                delta=float(load),
            )
        )

    db.add_all(
        [
            KanimRule(
                company_id=company.id,
                kind=KanimRuleKind.WEEKDAY,
                min_count=12,
                notes="מינימום קנים בימי חול (א׳–ה׳)",
            ),
            KanimRule(
                company_id=company.id,
                kind=KanimRuleKind.WEEKEND,
                min_count=18,
                notes="מינימום קנים בסופ״ש (ו׳–ש׳)",
            ),
        ]
    )

    db.commit()


def normalize_role_display_names(db: Session) -> None:
    """Expand abbreviated role names in existing DBs (e.g. מש״ק → מפקד זוטר)."""
    abbreviated = ('מש"ק', "מש״ק", "מש\"ק")
    changed = False
    for role in db.query(Role).filter(Role.name.in_(abbreviated)).all():
        role.description = role.description or role.name
        role.name = "מפקד זוטר"
        changed = True
    if changed:
        db.commit()
