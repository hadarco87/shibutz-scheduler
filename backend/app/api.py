from datetime import datetime, timedelta
from typing import List, Optional
import secrets

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.deps import get_current_user, require_commander
from app.models import (
    Assignment,
    AfterDraft,
    AfterGrant,
    Company,
    CompanyInvite,
    LeavePeriod,
    Mission,
    MissionRequirement,
    MissionType,
    MissionTypeRequirement,
    MissionTypeWindow,
    MissionTypeStaffingBand,
    MissionTypeBandRequirement,
    Person,
    PersonAllowedMissionType,
    PersonQualification,
    Qualification,
    RecurringRestriction,
    Restriction,
    Role,
    RoleCapability,
    Schedule,
    SchedulePlan,
    ScheduleStatus,
    SchedulingConstraint,
    SchedulingRule,
    SchedulingRuleBlockedType,
    SchedulingRuleQualification,
    SchedulingRuleRole,
    SchedulingRuleSourceType,
    SchedulingRuleKind,
    PresenceScope,
    User,
    UserRole,
    WorkloadEvent,
    WorkloadSnapshotEntry,
    KanimRule,
    KanimRuleKind,
)
from app.schemas import (
    AfterCandidateOut,
    AfterDraftOut,
    AfterDraftSaveIn,
    AfterPreviewOut,
    AssignmentOut,
    AssignmentReplace,
    ConstraintCreate,
    ConstraintOut,
    SchedulingRuleCreate,
    SchedulingRuleOut,
    SchedulingRuleUpdate,
    KanimRuleCreate,
    KanimRuleOut,
    KanimRuleUpdate,
    LeaveCreate,
    LeaveOut,
    LoginRequest,
    RegisterRequest,
    RegisterInviteRequest,
    InvitePreviewOut,
    CompanyInviteCreate,
    CompanyInviteOut,
    CompanyMemberOut,
    MissionCreate,
    MissionOut,
    MissionRequirementOut,
    MissionTypeCreate,
    MissionTypeOut,
    MissionTypeRequirementOut,
    MissionTypeUpdate,
    MissionTypeWindowOut,
    MissionTypeStaffingBandOut,
    MissionTypeBandRequirementOut,
    MissionUpdate,
    PersonCreate,
    PersonOut,
    PersonUpdate,
    PeopleImportPreviewOut,
    PeopleImportResultOut,
    PeopleImportRowOut,
    QualificationCreate,
    QualificationOut,
    QualificationUpdate,
    ReplacementCandidateOut,
    ReplacementOptionsOut,
    RestrictionCreate,
    RestrictionOut,
    RecurringRestrictionCreate,
    RecurringRestrictionOut,
    RoleCreate,
    RoleOut,
    RoleUpdate,
    ScheduleCreate,
    ScheduleDayOut,
    ScheduleOut,
    SchedulePlanCreate,
    SchedulePlanGenerateIn,
    SchedulePlanOut,
    SchedulingResultOut,
    Token,
    UserOut,
    ViolationOut,
    ConflictOut,
    WorkloadDashboardOut,
    HistorySummaryOut,
    HistoryPersonHoursOut,
    WorkloadPersonOut,
    CompanyWipeIn,
    CompanyWipeOut,
)
from app.security import authenticate_user, create_access_token, get_password_hash
from app.services.bootstrap import bootstrap_company
from app.services.company_wipe import wipe_company_data
from app.services.excel_import import apply_people_import, parse_people_workbook
from app.services.after import (
    after_count_map,
    build_after_preview,
    save_after_drafts,
)
from app.services.scheduling import (
    current_workload_map,
    generate_schedule,
    instantiate_active_mission_types,
    instantiate_recurring_missions,
    list_replacement_candidates,
    publish_schedule,
    replace_assignment,
    sync_mission_type_to_drafts,
)
from app.services.plans import (
    MAX_PLAN_DAYS,
    active_draft_plan,
    create_schedule_plan,
    generate_plan,
    load_plan,
    publish_plan,
)
from app.services.policy_rules import load_scheduling_rules
from app.services.validation import validate_schedule

router = APIRouter()


# ---------- helpers ----------

def role_out(role: Role) -> RoleOut:
    return RoleOut(
        id=role.id,
        company_id=role.company_id,
        name=role.name,
        description=role.description,
        is_active=role.is_active,
        can_fulfill_role_ids=[c.can_fulfill_role_id for c in role.can_fulfill],
    )


def person_out(
    person: Person,
    after_count_30d: int = 0,
    last_after_end: Optional[datetime] = None,
) -> PersonOut:
    return PersonOut(
        id=person.id,
        company_id=person.company_id,
        full_name=person.full_name,
        role_id=person.role_id,
        rank=person.rank,
        personal_number=person.personal_number,
        phone=person.phone,
        notes=person.notes,
        is_active=person.is_active,
        qualification_ids=[pq.qualification_id for pq in person.qualifications],
        allowed_mission_type_ids=[
            row.mission_type_id for row in person.allowed_mission_types
        ],
        role_name=person.role.name if person.role else None,
        after_count_30d=after_count_30d,
        last_after_end=last_after_end,
    )


def _assert_staffing_matches_requirements(
    personnel_count: int,
    requirements: list,
) -> None:
    """Requirement slot counts must equal the declared headcount."""
    if not requirements:
        return
    total = sum(r.count for r in requirements)
    if total != personnel_count:
        raise HTTPException(
            400,
            f"סכום הדרישות ({total}) חייב להיות שווה למספר האנשים ({personnel_count})",
        )


def _assert_routine_fields(
    recurring: bool,
    *,
    hours_mode: Optional[str],
    start_hour: Optional[int],
    remainder_policy: Optional[str],
    recurrence_kind: Optional[str],
    interval_days: Optional[int],
    weekdays: Optional[str],
    anchor_date,
    time_windows: Optional[list],
) -> None:
    if not recurring:
        return
    mode = (hours_mode or "uniform").strip().lower()
    if mode not in ("uniform", "custom"):
        raise HTTPException(400, "מצב שעות רוטיני לא חוקי")
    kind = (recurrence_kind or "daily").strip().lower()
    if kind not in ("daily", "every_n_days", "weekly"):
        raise HTTPException(400, "סוג תדירות לא חוקי")
    if kind == "every_n_days":
        interval = int(interval_days or 1)
        if interval < 2:
            raise HTTPException(400, "כל X ימים — X חייב להיות לפחות 2")
        if anchor_date is None:
            raise HTTPException(400, "כל X ימים — חובה לבחור תאריך עוגן")
    if kind == "weekly":
        raw = (weekdays or "").strip()
        if not raw:
            raise HTTPException(400, "בתדירות שבועית חובה לבחור לפחות יום אחד")
        try:
            days = {int(x.strip()) for x in raw.split(",") if x.strip() != ""}
        except ValueError as e:
            raise HTTPException(400, "ימי שבוע לא חוקיים") from e
        if not days or any(d < 0 or d > 6 for d in days):
            raise HTTPException(400, "ימי שבוע חייבים להיות בין 0 ל־6")
    if mode == "uniform":
        if start_hour is None:
            raise HTTPException(400, "למשימה רוטינית במחזור אחיד חובה לבחור שעת התחלה")
        if start_hour < 0 or start_hour > 23:
            raise HTTPException(400, "שעת התחלה חייבת להיות בין 0 ל־23")
        if remainder_policy is not None and remainder_policy not in (
            "include_short",
            "full_only",
        ):
            raise HTTPException(400, "מדיניות שארית לא חוקית")
    else:
        if not time_windows:
            raise HTTPException(
                400, "למשימה רוטינית עם משמרות מותאמות חובה להגדיר לפחות משמרת אחת"
            )
        _assert_time_windows(time_windows)


def _assert_time_windows(windows: list) -> None:
    if not windows:
        raise HTTPException(
            400, "למשימה שאינה רוטינית חובה להגדיר לפחות טווח שעות אחד"
        )
    for w in windows:
        sm = getattr(w, "start_minute", None)
        em = getattr(w, "end_minute", None)
        if sm is None or em is None:
            raise HTTPException(400, "טווח שעות חסר")
        if not (0 <= int(sm) <= 1439 and 0 <= int(em) <= 1439):
            raise HTTPException(400, "שעות בטווח חייבות להיות בין 00:00 ל־23:59")
        if int(sm) == int(em):
            raise HTTPException(400, "התחלת וסיום הטווח לא יכולים להיות זהים")


def _replace_time_windows(db: Session, mt_id: int, windows: list) -> None:
    db.query(MissionTypeWindow).filter(MissionTypeWindow.mission_type_id == mt_id).delete()
    for i, w in enumerate(windows):
        data = w.model_dump() if hasattr(w, "model_dump") else dict(w)
        db.add(
            MissionTypeWindow(
                mission_type_id=mt_id,
                start_minute=int(data["start_minute"]),
                end_minute=int(data["end_minute"]),
                sort_order=int(data.get("sort_order", i)),
            )
        )


def _assert_staffing_bands(bands: list) -> None:
    for b in bands:
        sm = int(getattr(b, "start_minute", -1))
        em = int(getattr(b, "end_minute", -1))
        if not (0 <= sm <= 1439 and 0 <= em <= 1439):
            raise HTTPException(400, "שעות ברצועת איוש חייבות להיות בין 00:00 ל־23:59")
        if sm == em:
            raise HTTPException(400, "רצועת איוש לא יכולה להתחיל ולהסתיים באותה שעה")
        pc = int(getattr(b, "personnel_count", 0) or 0)
        if pc < 1:
            raise HTTPException(400, "מספר אנשים ברצועה חייב להיות לפחות 1")
        reqs = getattr(b, "requirements", None) or []
        if reqs:
            total = sum(int(getattr(r, "count", 0) or 0) for r in reqs)
            if total != pc:
                raise HTTPException(
                    400,
                    f"ברצועת איוש סכום הדרישות ({total}) חייב להיות שווה למספר האנשים ({pc})",
                )


def _replace_staffing_bands(db: Session, mt_id: int, bands: list) -> None:
    existing = (
        db.query(MissionTypeStaffingBand)
        .filter(MissionTypeStaffingBand.mission_type_id == mt_id)
        .all()
    )
    for band in existing:
        db.query(MissionTypeBandRequirement).filter(
            MissionTypeBandRequirement.band_id == band.id
        ).delete()
    db.query(MissionTypeStaffingBand).filter(
        MissionTypeStaffingBand.mission_type_id == mt_id
    ).delete()
    for i, b in enumerate(bands):
        data = b.model_dump() if hasattr(b, "model_dump") else dict(b)
        reqs = data.pop("requirements", []) or []
        band = MissionTypeStaffingBand(
            mission_type_id=mt_id,
            label=data.get("label"),
            start_minute=int(data["start_minute"]),
            end_minute=int(data["end_minute"]),
            personnel_count=int(data.get("personnel_count", 1)),
            sort_order=int(data.get("sort_order", i)),
        )
        db.add(band)
        db.flush()
        for req in reqs:
            rd = req if isinstance(req, dict) else req.model_dump()
            db.add(
                MissionTypeBandRequirement(
                    band_id=band.id,
                    role_id=rd.get("role_id"),
                    qualification_id=rd.get("qualification_id"),
                    count=int(rd.get("count", 1)),
                    exact_role=bool(rd.get("exact_role", False)),
                    exact_qualification=bool(rd.get("exact_qualification", True)),
                )
            )


def _mt_load_options():
    return (
        joinedload(MissionType.default_requirements),
        joinedload(MissionType.time_windows),
        joinedload(MissionType.staffing_bands).joinedload(
            MissionTypeStaffingBand.requirements
        ),
    )


def mission_type_out(mt: MissionType) -> MissionTypeOut:
    windows = sorted(
        getattr(mt, "time_windows", None) or [],
        key=lambda w: (w.sort_order, w.id),
    )
    bands = sorted(
        getattr(mt, "staffing_bands", None) or [],
        key=lambda b: (b.sort_order, b.id),
    )
    return MissionTypeOut(
        id=mt.id,
        company_id=mt.company_id,
        name=mt.name,
        description=mt.description,
        default_duration_hours=mt.default_duration_hours,
        difficulty_weight=mt.difficulty_weight,
        default_personnel_count=mt.default_personnel_count,
        is_active=mt.is_active,
        is_recurring_template=mt.is_recurring_template,
        recurring_start_hour=mt.recurring_start_hour,
        recurring_end_hour=mt.recurring_end_hour,
        required_sleep_hours_before_after=getattr(
            mt, "required_sleep_hours_before_after", 0.0
        )
        or 0.0,
        routine_remainder_policy=getattr(mt, "routine_remainder_policy", None)
        or "include_short",
        recurrence_kind=getattr(mt, "recurrence_kind", None) or "daily",
        recurrence_interval_days=getattr(mt, "recurrence_interval_days", None) or 1,
        recurrence_weekdays=getattr(mt, "recurrence_weekdays", None),
        recurrence_anchor_date=getattr(mt, "recurrence_anchor_date", None),
        routine_hours_mode=getattr(mt, "routine_hours_mode", None) or "uniform",
        default_requirements=[
            MissionTypeRequirementOut(
                id=r.id,
                role_id=r.role_id,
                qualification_id=r.qualification_id,
                count=r.count,
                exact_role=bool(getattr(r, "exact_role", False)),
                exact_qualification=(
                    True
                    if getattr(r, "exact_qualification", None) is None
                    else bool(r.exact_qualification)
                ),
            )
            for r in mt.default_requirements
        ],
        time_windows=[
            MissionTypeWindowOut(
                id=w.id,
                start_minute=w.start_minute,
                end_minute=w.end_minute,
                sort_order=w.sort_order,
            )
            for w in windows
        ],
        staffing_bands=[
            MissionTypeStaffingBandOut(
                id=b.id,
                label=b.label,
                start_minute=b.start_minute,
                end_minute=b.end_minute,
                personnel_count=b.personnel_count,
                sort_order=b.sort_order,
                requirements=[
                    MissionTypeBandRequirementOut(
                        id=r.id,
                        role_id=r.role_id,
                        qualification_id=r.qualification_id,
                        count=r.count,
                        exact_role=bool(getattr(r, "exact_role", False)),
                        exact_qualification=(
                            True
                            if getattr(r, "exact_qualification", None) is None
                            else bool(r.exact_qualification)
                        ),
                    )
                    for r in (b.requirements or [])
                ],
            )
            for b in bands
        ],
    )


def mission_out(m: Mission) -> MissionOut:
    return MissionOut(
        id=m.id,
        company_id=m.company_id,
        mission_type_id=m.mission_type_id,
        name=m.name,
        start_at=m.start_at,
        end_at=m.end_at,
        difficulty_weight=m.difficulty_weight,
        personnel_count=m.personnel_count,
        notes=m.notes,
        is_adhoc=m.is_adhoc,
        schedule_id=m.schedule_id,
        requirements=[
            MissionRequirementOut(
                id=r.id,
                role_id=r.role_id,
                qualification_id=r.qualification_id,
                count=r.count,
                label=r.label,
                exact_role=bool(getattr(r, "exact_role", False)),
                exact_qualification=(
                    True
                    if getattr(r, "exact_qualification", None) is None
                    else bool(r.exact_qualification)
                ),
            )
            for r in m.requirements
        ],
        mission_type_name=m.mission_type.name if m.mission_type else None,
    )


def assignment_out(a: Assignment) -> AssignmentOut:
    person = a.person
    role_name = None
    qual_names: list[str] = []
    if person is not None:
        role_name = person.role.name if person.role else None
        qual_names = sorted(
            {
                pq.qualification.name
                for pq in (person.qualifications or [])
                if pq.qualification and pq.qualification.name
            }
        )
    req = a.requirement
    slot_role = None
    slot_qual = None
    if req is not None:
        if req.role_id and getattr(req, "role", None):
            slot_role = req.role.name
        elif req.role_id:
            slot_role = None
        if req.qualification_id and getattr(req, "qualification", None):
            slot_qual = req.qualification.name
    return AssignmentOut(
        id=a.id,
        schedule_id=a.schedule_id,
        mission_id=a.mission_id,
        person_id=a.person_id,
        requirement_id=a.requirement_id,
        is_manual=a.is_manual,
        override_reason=a.override_reason,
        difficulty_at_assignment=a.difficulty_at_assignment,
        person_name=person.full_name if person else None,
        mission_name=a.mission.name if a.mission else None,
        person_role_name=role_name,
        person_qualification_names=qual_names,
        slot_role_name=slot_role,
        slot_qualification_name=slot_qual,
    )


def schedule_out(db: Session, schedule: Schedule) -> ScheduleOut:
    schedule = (
        db.query(Schedule)
        .options(
            joinedload(Schedule.assignments)
            .joinedload(Assignment.person)
            .joinedload(Person.role),
            joinedload(Schedule.assignments)
            .joinedload(Assignment.person)
            .joinedload(Person.qualifications)
            .joinedload(PersonQualification.qualification),
            joinedload(Schedule.assignments).joinedload(Assignment.mission),
            joinedload(Schedule.assignments)
            .joinedload(Assignment.requirement)
            .joinedload(MissionRequirement.role),
            joinedload(Schedule.assignments)
            .joinedload(Assignment.requirement)
            .joinedload(MissionRequirement.qualification),
            joinedload(Schedule.missions).joinedload(Mission.requirements),
            joinedload(Schedule.missions).joinedload(Mission.mission_type),
        )
        .filter(Schedule.id == schedule.id)
        .one()
    )
    return ScheduleOut(
        id=schedule.id,
        company_id=schedule.company_id,
        plan_id=getattr(schedule, "plan_id", None),
        day_index=getattr(schedule, "day_index", 0) or 0,
        window_start=schedule.window_start,
        window_end=schedule.window_end,
        status=schedule.status,
        created_by_id=schedule.created_by_id,
        approved_by_id=schedule.approved_by_id,
        published_at=schedule.published_at,
        notes=schedule.notes,
        share_token=schedule.share_token,
        assignments=[assignment_out(a) for a in schedule.assignments],
        missions=[mission_out(m) for m in schedule.missions],
    )


def schedule_day_out(s: Schedule) -> ScheduleDayOut:
    missions = list(s.missions or [])
    assignments = list(s.assignments or [])
    assigned_by_mission: dict[int, int] = {}
    for a in assignments:
        assigned_by_mission[a.mission_id] = assigned_by_mission.get(a.mission_id, 0) + 1
    staffing_needed = sum(int(m.personnel_count or 0) for m in missions)
    staffing_filled = sum(
        min(int(m.personnel_count or 0), assigned_by_mission.get(m.id, 0))
        for m in missions
    )
    return ScheduleDayOut(
        id=s.id,
        plan_id=getattr(s, "plan_id", None),
        day_index=getattr(s, "day_index", 0) or 0,
        window_start=s.window_start,
        window_end=s.window_end,
        status=s.status,
        published_at=s.published_at,
        assignment_count=len(assignments),
        mission_count=len(missions),
        staffing_needed=staffing_needed,
        staffing_filled=staffing_filled,
    )


def schedule_plan_out(db: Session, plan: SchedulePlan) -> SchedulePlanOut:
    plan = (
        db.query(SchedulePlan)
        .options(
            joinedload(SchedulePlan.schedules).joinedload(Schedule.assignments),
            joinedload(SchedulePlan.schedules).joinedload(Schedule.missions),
        )
        .filter(SchedulePlan.id == plan.id)
        .one()
    )
    days = sorted(plan.schedules or [], key=lambda s: s.window_start)
    return SchedulePlanOut(
        id=plan.id,
        company_id=plan.company_id,
        start_date=plan.start_date,
        days_count=plan.days_count,
        status=plan.status,
        created_by_id=plan.created_by_id,
        published_at=plan.published_at,
        notes=plan.notes,
        days=[schedule_day_out(s) for s in days],
    )


# ---------- auth ----------

@router.post("/auth/login", response_model=Token)
def login_form(
    form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)
):
    user = authenticate_user(db, form_data.username, form_data.password)
    if not user:
        raise HTTPException(status_code=400, detail="אימייל או סיסמה שגויים")
    return Token(access_token=create_access_token(user.email))


@router.post("/auth/login-json", response_model=Token)
def login_json(body: LoginRequest, db: Session = Depends(get_db)):
    user = authenticate_user(db, body.email, body.password)
    if not user:
        raise HTTPException(status_code=400, detail="אימייל או סיסמה שגויים")
    return Token(access_token=create_access_token(user.email))


@router.post("/auth/register", response_model=Token)
def register(body: RegisterRequest, db: Session = Depends(get_db)):
    email = body.email.strip().lower()
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(status_code=400, detail="האימייל כבר רשום במערכת")
    company_name = body.company_name.strip()
    full_name = body.full_name.strip()
    if not company_name or not full_name:
        raise HTTPException(status_code=400, detail="שם מלא ושם פלוגה נדרשים")
    user = bootstrap_company(
        db,
        company_name=company_name,
        email=email,
        password=body.password,
        full_name=full_name,
    )
    db.commit()
    return Token(access_token=create_access_token(user.email))


@router.get("/auth/me", response_model=UserOut)
def me(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    company = db.query(Company).filter(Company.id == user.company_id).first()
    return UserOut(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        role=user.role,
        company_id=user.company_id,
        is_active=user.is_active,
        company_name=company.name if company else None,
    )


def _invite_out(invite: CompanyInvite) -> CompanyInviteOut:
    return CompanyInviteOut(
        id=invite.id,
        email=invite.email,
        token=invite.token,
        created_at=invite.created_at,
        accepted_at=invite.accepted_at,
        invited_by_name=invite.invited_by.full_name if invite.invited_by else None,
    )


def _active_invite_by_token(db: Session, token: str) -> CompanyInvite:
    invite = (
        db.query(CompanyInvite)
        .options(joinedload(CompanyInvite.company), joinedload(CompanyInvite.invited_by))
        .filter(CompanyInvite.token == token)
        .first()
    )
    if not invite or invite.revoked_at is not None:
        raise HTTPException(404, "ההזמנה לא נמצאה או בוטלה")
    if invite.accepted_at is not None:
        raise HTTPException(400, "ההזמנה כבר מומשה")
    return invite


@router.get("/auth/invite/{token}", response_model=InvitePreviewOut)
def preview_invite(token: str, db: Session = Depends(get_db)):
    invite = _active_invite_by_token(db, token)
    return InvitePreviewOut(
        company_name=invite.company.name if invite.company else "",
        email=invite.email,
        invited_by_name=invite.invited_by.full_name if invite.invited_by else None,
    )


@router.post("/auth/register-invite", response_model=Token)
def register_with_invite(body: RegisterInviteRequest, db: Session = Depends(get_db)):
    invite = _active_invite_by_token(db, body.token.strip())
    email = body.email.strip().lower()
    if email != invite.email.strip().lower():
        raise HTTPException(400, "יש להירשם עם כתובת האימייל שאליה נשלחה ההזמנה")
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(400, "האימייל כבר רשום במערכת — התחברו במקום להירשם")
    full_name = body.full_name.strip()
    if not full_name:
        raise HTTPException(400, "שם מלא נדרש")

    user = User(
        company_id=invite.company_id,
        email=email,
        full_name=full_name,
        hashed_password=get_password_hash(body.password),
        role=UserRole.COMMANDER,
    )
    db.add(user)
    invite.accepted_at = datetime.utcnow()
    db.commit()
    return Token(access_token=create_access_token(user.email))


@router.get("/company/members", response_model=List[CompanyMemberOut])
def list_company_members(
    db: Session = Depends(get_db), user: User = Depends(require_commander)
):
    members = (
        db.query(User)
        .filter(User.company_id == user.company_id)
        .order_by(User.full_name.asc())
        .all()
    )
    return [
        CompanyMemberOut(
            id=m.id,
            email=m.email,
            full_name=m.full_name,
            role=m.role,
            is_active=m.is_active,
        )
        for m in members
    ]


@router.get("/company/invites", response_model=List[CompanyInviteOut])
def list_company_invites(
    db: Session = Depends(get_db), user: User = Depends(require_commander)
):
    invites = (
        db.query(CompanyInvite)
        .options(joinedload(CompanyInvite.invited_by))
        .filter(
            CompanyInvite.company_id == user.company_id,
            CompanyInvite.accepted_at.is_(None),
            CompanyInvite.revoked_at.is_(None),
        )
        .order_by(CompanyInvite.created_at.desc())
        .all()
    )
    return [_invite_out(i) for i in invites]


@router.post("/company/invites", response_model=CompanyInviteOut)
def create_company_invite(
    body: CompanyInviteCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_commander),
):
    email = body.email.strip().lower()
    existing_user = db.query(User).filter(User.email == email).first()
    if existing_user:
        if existing_user.company_id == user.company_id:
            raise HTTPException(400, "המשתמש כבר חבר בפלוגה")
        raise HTTPException(
            400,
            "האימייל כבר רשום בפלוגה אחרת. הזמנה אפשרית רק למייל שעדיין לא רשום.",
        )

    pending = (
        db.query(CompanyInvite)
        .filter(
            CompanyInvite.company_id == user.company_id,
            CompanyInvite.email == email,
            CompanyInvite.accepted_at.is_(None),
            CompanyInvite.revoked_at.is_(None),
        )
        .first()
    )
    if pending:
        return _invite_out(pending)

    # Re-open a previously revoked invite for same email
    prior = (
        db.query(CompanyInvite)
        .filter(CompanyInvite.company_id == user.company_id, CompanyInvite.email == email)
        .first()
    )
    if prior and prior.accepted_at is None:
        prior.revoked_at = None
        prior.token = secrets.token_urlsafe(24)
        prior.invited_by_id = user.id
        db.commit()
        db.refresh(prior)
        prior = (
            db.query(CompanyInvite)
            .options(joinedload(CompanyInvite.invited_by))
            .filter(CompanyInvite.id == prior.id)
            .one()
        )
        return _invite_out(prior)

    invite = CompanyInvite(
        company_id=user.company_id,
        email=email,
        token=secrets.token_urlsafe(24),
        invited_by_id=user.id,
    )
    db.add(invite)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(400, "לא ניתן ליצור הזמנה — נסו שוב")
    invite = (
        db.query(CompanyInvite)
        .options(joinedload(CompanyInvite.invited_by))
        .filter(CompanyInvite.id == invite.id)
        .one()
    )
    return _invite_out(invite)


@router.delete("/company/invites/{invite_id}")
def revoke_company_invite(
    invite_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_commander),
):
    invite = (
        db.query(CompanyInvite)
        .filter(CompanyInvite.id == invite_id, CompanyInvite.company_id == user.company_id)
        .first()
    )
    if not invite:
        raise HTTPException(404, "הזמנה לא נמצאה")
    if invite.accepted_at is not None:
        raise HTTPException(400, "ההזמנה כבר מומשה")
    invite.revoked_at = datetime.utcnow()
    db.commit()
    return {"ok": True}


@router.post("/company/wipe", response_model=CompanyWipeOut)
def wipe_company(
    body: CompanyWipeIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_commander),
):
    """Destructively wipe selected company data layers. Never deletes system users."""
    if not (body.operational or body.catalog or body.people):
        raise HTTPException(400, "יש לבחור לפחות שכבת מחיקה אחת")

    try:
        result = wipe_company_data(
            db,
            user.company_id,
            operational=body.operational,
            catalog=body.catalog,
            people=body.people,
        )
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            409,
            "המחיקה נכשלה בגלל תלויות במסד הנתונים. נסו שוב או בחרו שכבות נוספות.",
        )

    return CompanyWipeOut(
        ok=True,
        operational=result.operational,
        catalog=result.catalog,
        people=result.people,
        deleted=result.deleted,
    )


# ---------- roles ----------

@router.get("/roles", response_model=List[RoleOut])
def list_roles(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    roles = (
        db.query(Role)
        .options(joinedload(Role.can_fulfill))
        .filter(Role.company_id == user.company_id)
        .all()
    )
    return [role_out(r) for r in roles]


@router.post("/roles", response_model=RoleOut)
def create_role(
    body: RoleCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_commander),
):
    role = Role(company_id=user.company_id, name=body.name, description=body.description)
    db.add(role)
    db.flush()
    fulfill_ids = set(body.can_fulfill_role_ids) | {role.id}
    for rid in fulfill_ids:
        db.add(RoleCapability(role_id=role.id, can_fulfill_role_id=rid))
    db.commit()
    db.refresh(role)
    role = db.query(Role).options(joinedload(Role.can_fulfill)).filter(Role.id == role.id).one()
    return role_out(role)


@router.put("/roles/{role_id}", response_model=RoleOut)
def update_role(
    role_id: int,
    body: RoleUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_commander),
):
    role = (
        db.query(Role)
        .options(joinedload(Role.can_fulfill))
        .filter(Role.id == role_id, Role.company_id == user.company_id)
        .first()
    )
    if not role:
        raise HTTPException(404, "תפקיד לא נמצא")
    if body.name is not None:
        role.name = body.name
    if body.description is not None:
        role.description = body.description
    if body.is_active is not None:
        role.is_active = body.is_active
    if body.can_fulfill_role_ids is not None:
        db.query(RoleCapability).filter(RoleCapability.role_id == role.id).delete()
        for rid in set(body.can_fulfill_role_ids) | {role.id}:
            db.add(RoleCapability(role_id=role.id, can_fulfill_role_id=rid))
    db.commit()
    role = db.query(Role).options(joinedload(Role.can_fulfill)).filter(Role.id == role.id).one()
    return role_out(role)


@router.delete("/roles/{role_id}")
def delete_role(
    role_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_commander),
):
    role = (
        db.query(Role)
        .filter(Role.id == role_id, Role.company_id == user.company_id)
        .first()
    )
    if not role:
        raise HTTPException(404, "תפקיד לא נמצא")
    in_use = (
        db.query(Person)
        .filter(Person.company_id == user.company_id, Person.role_id == role.id)
        .count()
    )
    if in_use:
        raise HTTPException(
            400,
            f"לא ניתן למחוק — {in_use} אנשים משובצים לתפקיד זה. העבירו אותם לתפקיד אחר קודם.",
        )
    db.query(RoleCapability).filter(
        (RoleCapability.role_id == role.id)
        | (RoleCapability.can_fulfill_role_id == role.id)
    ).delete(synchronize_session=False)
    db.query(MissionTypeRequirement).filter(
        MissionTypeRequirement.role_id == role.id
    ).update({MissionTypeRequirement.role_id: None}, synchronize_session=False)
    db.query(MissionRequirement).filter(MissionRequirement.role_id == role.id).update(
        {MissionRequirement.role_id: None}, synchronize_session=False
    )
    db.delete(role)
    db.commit()
    return {"ok": True}


# ---------- qualifications ----------

@router.get("/qualifications", response_model=List[QualificationOut])
def list_qualifications(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return (
        db.query(Qualification)
        .filter(Qualification.company_id == user.company_id)
        .all()
    )


@router.post("/qualifications", response_model=QualificationOut)
def create_qualification(
    body: QualificationCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_commander),
):
    q = Qualification(company_id=user.company_id, name=body.name, description=body.description)
    db.add(q)
    db.commit()
    db.refresh(q)
    return q


@router.put("/qualifications/{qid}", response_model=QualificationOut)
def update_qualification(
    qid: int,
    body: QualificationUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_commander),
):
    q = (
        db.query(Qualification)
        .filter(Qualification.id == qid, Qualification.company_id == user.company_id)
        .first()
    )
    if not q:
        raise HTTPException(404, "פק\"ל לא נמצא")
    if body.name is not None:
        q.name = body.name
    if body.description is not None:
        q.description = body.description
    if body.is_active is not None:
        q.is_active = body.is_active
    db.commit()
    db.refresh(q)
    return q


@router.delete("/qualifications/{qid}")
def delete_qualification(
    qid: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_commander),
):
    q = (
        db.query(Qualification)
        .filter(Qualification.id == qid, Qualification.company_id == user.company_id)
        .first()
    )
    if not q:
        raise HTTPException(404, "פק\"ל לא נמצא")
    db.query(PersonQualification).filter(
        PersonQualification.qualification_id == q.id
    ).delete(synchronize_session=False)
    db.query(MissionTypeRequirement).filter(
        MissionTypeRequirement.qualification_id == q.id
    ).update(
        {MissionTypeRequirement.qualification_id: None}, synchronize_session=False
    )
    db.query(MissionRequirement).filter(
        MissionRequirement.qualification_id == q.id
    ).update({MissionRequirement.qualification_id: None}, synchronize_session=False)
    db.query(Restriction).filter(Restriction.qualification_id == q.id).update(
        {Restriction.qualification_id: None}, synchronize_session=False
    )
    db.query(RecurringRestriction).filter(
        RecurringRestriction.qualification_id == q.id
    ).update(
        {RecurringRestriction.qualification_id: None}, synchronize_session=False
    )
    db.delete(q)
    db.commit()
    return {"ok": True}


# ---------- people ----------

@router.get("/people", response_model=List[PersonOut])
def list_people(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    people = (
        db.query(Person)
        .options(
            joinedload(Person.qualifications),
            joinedload(Person.allowed_mission_types),
            joinedload(Person.role),
        )
        .filter(Person.company_id == user.company_id)
        .order_by(Person.full_name)
        .all()
    )
    counts = after_count_map(db, user.company_id)
    last_ends: dict[int, datetime] = {}
    grants = (
        db.query(AfterGrant)
        .filter(AfterGrant.company_id == user.company_id)
        .order_by(AfterGrant.end_at.desc())
        .all()
    )
    for g in grants:
        if g.person_id not in last_ends:
            last_ends[g.person_id] = g.end_at
    return [
        person_out(p, counts.get(p.id, 0), last_ends.get(p.id)) for p in people
    ]


@router.post("/people/import/preview", response_model=PeopleImportPreviewOut)
async def preview_people_import(
    file: UploadFile = File(...),
    sheet: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    user: User = Depends(require_commander),
):
    raw = await file.read()
    if not raw:
        raise HTTPException(400, "הקובץ ריק")
    name = (file.filename or "").lower()
    if not (name.endswith(".xlsx") or name.endswith(".xlsm")):
        raise HTTPException(400, "נא להעלות קובץ Excel ‏(.xlsx / .xlsm)")
    try:
        parsed = parse_people_workbook(raw, preferred_sheet=sheet or None)
        rows, created, updated, skipped, _, _ = apply_people_import(
            db, user.company_id, parsed, commit=False
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(400, f"לא ניתן לקרוא את הקובץ: {e}")
    return PeopleImportPreviewOut(
        sheet_name=parsed.sheet_name,
        sheet_options=parsed.sheet_options,
        column_mapping=parsed.column_mapping,
        rows=[PeopleImportRowOut(**r) for r in rows],
        create_count=created,
        update_count=updated,
        skip_count=skipped,
    )


@router.post("/people/import", response_model=PeopleImportResultOut)
async def commit_people_import(
    file: UploadFile = File(...),
    sheet: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    user: User = Depends(require_commander),
):
    raw = await file.read()
    if not raw:
        raise HTTPException(400, "הקובץ ריק")
    name = (file.filename or "").lower()
    if not (name.endswith(".xlsx") or name.endswith(".xlsm")):
        raise HTTPException(400, "נא להעלות קובץ Excel ‏(.xlsx / .xlsm)")
    try:
        parsed = parse_people_workbook(raw, preferred_sheet=sheet or None)
        _, created, updated, skipped, quals_created, warnings = apply_people_import(
            db, user.company_id, parsed, commit=True
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(400, f"לא ניתן לייבא את הקובץ: {e}")
    return PeopleImportResultOut(
        created=created,
        updated=updated,
        skipped=skipped,
        qualifications_created=quals_created,
        sheet_name=parsed.sheet_name,
        warnings=warnings,
    )


@router.post("/people", response_model=PersonOut)
def create_person(
    body: PersonCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_commander),
):
    person = Person(
        company_id=user.company_id,
        full_name=body.full_name,
        role_id=body.role_id,
        rank=(body.rank or "").strip() or None,
        personal_number=(body.personal_number or "").strip() or None,
        phone=(body.phone or "").strip() or None,
        notes=(body.notes or "").strip() or None,
    )
    db.add(person)
    db.flush()
    for qid in body.qualification_ids:
        db.add(PersonQualification(person_id=person.id, qualification_id=qid))
    for mt_id in body.allowed_mission_type_ids:
        db.add(
            PersonAllowedMissionType(person_id=person.id, mission_type_id=mt_id)
        )
    db.commit()
    person = (
        db.query(Person)
        .options(
            joinedload(Person.qualifications),
            joinedload(Person.allowed_mission_types),
            joinedload(Person.role),
        )
        .filter(Person.id == person.id)
        .one()
    )
    return person_out(person)


@router.put("/people/{person_id}", response_model=PersonOut)
def update_person(
    person_id: int,
    body: PersonUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_commander),
):
    person = (
        db.query(Person)
        .options(
            joinedload(Person.qualifications),
            joinedload(Person.allowed_mission_types),
            joinedload(Person.role),
        )
        .filter(Person.id == person_id, Person.company_id == user.company_id)
        .first()
    )
    if not person:
        raise HTTPException(404, "חייל לא נמצא")
    data = body.model_dump(exclude_unset=True)
    for field in (
        "full_name",
        "role_id",
        "rank",
        "personal_number",
        "phone",
        "notes",
        "is_active",
    ):
        if field not in data:
            continue
        val = data[field]
        if field in ("personal_number", "phone", "notes", "rank") and val == "":
            val = None
        setattr(person, field, val)
    if "qualification_ids" in data and body.qualification_ids is not None:
        db.query(PersonQualification).filter(PersonQualification.person_id == person.id).delete()
        for qid in body.qualification_ids:
            db.add(PersonQualification(person_id=person.id, qualification_id=qid))
    if "allowed_mission_type_ids" in data and body.allowed_mission_type_ids is not None:
        db.query(PersonAllowedMissionType).filter(
            PersonAllowedMissionType.person_id == person.id
        ).delete()
        for mt_id in body.allowed_mission_type_ids:
            db.add(
                PersonAllowedMissionType(person_id=person.id, mission_type_id=mt_id)
            )
    db.commit()
    person = (
        db.query(Person)
        .options(
            joinedload(Person.qualifications),
            joinedload(Person.allowed_mission_types),
            joinedload(Person.role),
        )
        .filter(Person.id == person.id)
        .one()
    )
    return person_out(person)


@router.delete("/people/{person_id}")
def delete_person(
    person_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_commander),
):
    """Hard-delete a person and dependent records (assignments, workload, leave, etc.)."""
    person = (
        db.query(Person)
        .filter(Person.id == person_id, Person.company_id == user.company_id)
        .first()
    )
    if not person:
        raise HTTPException(404, "אדם לא נמצא")

    db.query(Assignment).filter(Assignment.person_id == person.id).delete(
        synchronize_session=False
    )
    db.query(WorkloadEvent).filter(WorkloadEvent.person_id == person.id).delete(
        synchronize_session=False
    )
    db.query(WorkloadSnapshotEntry).filter(
        WorkloadSnapshotEntry.person_id == person.id
    ).delete(synchronize_session=False)
    db.query(AfterDraft).filter(AfterDraft.person_id == person.id).delete(
        synchronize_session=False
    )
    db.query(AfterGrant).filter(AfterGrant.person_id == person.id).delete(
        synchronize_session=False
    )
    db.query(PersonQualification).filter(
        PersonQualification.person_id == person.id
    ).delete(synchronize_session=False)
    db.query(PersonAllowedMissionType).filter(
        PersonAllowedMissionType.person_id == person.id
    ).delete(synchronize_session=False)
    db.query(LeavePeriod).filter(LeavePeriod.person_id == person.id).delete(
        synchronize_session=False
    )
    db.query(Restriction).filter(Restriction.person_id == person.id).delete(
        synchronize_session=False
    )
    db.query(RecurringRestriction).filter(
        RecurringRestriction.person_id == person.id
    ).delete(synchronize_session=False)

    db.delete(person)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            409,
            "לא ניתן למחוק — יש רשומות מקושרות שלא נוקו. נסו שוב או השתמשו בהשהייה.",
        )
    return {"ok": True}


# ---------- leave / restrictions ----------

@router.get("/leave", response_model=List[LeaveOut])
def list_leave(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return (
        db.query(LeavePeriod)
        .join(Person)
        .filter(Person.company_id == user.company_id)
        .all()
    )


@router.post("/leave", response_model=LeaveOut)
def create_leave(
    body: LeaveCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_commander),
):
    person = (
        db.query(Person)
        .filter(Person.id == body.person_id, Person.company_id == user.company_id)
        .first()
    )
    if not person:
        raise HTTPException(404, "חייל לא נמצא")
    leave = LeavePeriod(**body.model_dump())
    db.add(leave)
    db.commit()
    db.refresh(leave)
    return leave


@router.delete("/leave/{leave_id}")
def delete_leave(
    leave_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_commander),
):
    leave = (
        db.query(LeavePeriod)
        .join(Person)
        .filter(LeavePeriod.id == leave_id, Person.company_id == user.company_id)
        .first()
    )
    if not leave:
        raise HTTPException(404, "חופשה לא נמצאה")
    db.delete(leave)
    db.commit()
    return {"ok": True}


@router.get("/restrictions", response_model=List[RestrictionOut])
def list_restrictions(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return (
        db.query(Restriction)
        .join(Person)
        .filter(Person.company_id == user.company_id)
        .all()
    )


@router.post("/restrictions", response_model=RestrictionOut)
def create_restriction(
    body: RestrictionCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_commander),
):
    person = (
        db.query(Person)
        .filter(Person.id == body.person_id, Person.company_id == user.company_id)
        .first()
    )
    if not person:
        raise HTTPException(404, "חייל לא נמצא")
    r = Restriction(**body.model_dump())
    db.add(r)
    db.commit()
    db.refresh(r)
    return r


@router.delete("/restrictions/{rid}")
def delete_restriction(
    rid: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_commander),
):
    r = (
        db.query(Restriction)
        .join(Person)
        .filter(Restriction.id == rid, Person.company_id == user.company_id)
        .first()
    )
    if not r:
        raise HTTPException(404, "מגבלה לא נמצאה")
    db.delete(r)
    db.commit()
    return {"ok": True}


@router.get("/recurring-restrictions", response_model=List[RecurringRestrictionOut])
def list_recurring_restrictions(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    return (
        db.query(RecurringRestriction)
        .join(Person)
        .filter(Person.company_id == user.company_id)
        .all()
    )


@router.post("/recurring-restrictions", response_model=RecurringRestrictionOut)
def create_recurring_restriction(
    body: RecurringRestrictionCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_commander),
):
    person = (
        db.query(Person)
        .filter(Person.id == body.person_id, Person.company_id == user.company_id)
        .first()
    )
    if not person:
        raise HTTPException(404, "חייל לא נמצא")
    if body.kind.value == "every_n_days" and body.interval_days < 1:
        raise HTTPException(400, "מרווח ימים חייב להיות לפחות 1")
    if body.kind.value == "weekly" and not (body.weekdays or "").strip():
        raise HTTPException(400, "יש לבחור לפחות יום אחד בשבוע")
    r = RecurringRestriction(**body.model_dump())
    db.add(r)
    db.commit()
    db.refresh(r)
    return r


@router.delete("/recurring-restrictions/{rid}")
def delete_recurring_restriction(
    rid: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_commander),
):
    r = (
        db.query(RecurringRestriction)
        .join(Person)
        .filter(RecurringRestriction.id == rid, Person.company_id == user.company_id)
        .first()
    )
    if not r:
        raise HTTPException(404, "מגבלה רוטינית לא נמצאה")
    db.delete(r)
    db.commit()
    return {"ok": True}


# ---------- mission types ----------

@router.get("/mission-types", response_model=List[MissionTypeOut])
def list_mission_types(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    items = (
        db.query(MissionType)
        .options(*_mt_load_options())
        .filter(MissionType.company_id == user.company_id)
        .all()
    )
    return [mission_type_out(m) for m in items]


@router.post("/mission-types", response_model=MissionTypeOut)
def create_mission_type(
    body: MissionTypeCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_commander),
):
    if body.staffing_bands:
        _assert_staffing_bands(body.staffing_bands)
    else:
        _assert_staffing_matches_requirements(
            body.default_personnel_count, body.default_requirements
        )
    data = body.model_dump(
        exclude={"default_requirements", "time_windows", "staffing_bands"}
    )
    data["recurring_end_hour"] = None
    if body.is_recurring_template:
        hours_mode = body.routine_hours_mode or "uniform"
        _assert_routine_fields(
            True,
            hours_mode=hours_mode,
            start_hour=body.recurring_start_hour,
            remainder_policy=body.routine_remainder_policy,
            recurrence_kind=body.recurrence_kind,
            interval_days=body.recurrence_interval_days,
            weekdays=body.recurrence_weekdays,
            anchor_date=body.recurrence_anchor_date,
            time_windows=body.time_windows,
        )
        if hours_mode == "uniform":
            data["time_windows"] = []  # ignored below
        else:
            data["recurring_start_hour"] = None
    else:
        data["recurring_start_hour"] = None
        data["recurrence_kind"] = "daily"
        data["recurrence_interval_days"] = 1
        data["recurrence_weekdays"] = None
        data["recurrence_anchor_date"] = None
        data["routine_hours_mode"] = "uniform"
        if body.time_windows:
            _assert_time_windows(body.time_windows)
    mt = MissionType(company_id=user.company_id, is_active=True, **{
        k: v for k, v in data.items() if k != "time_windows"
    })
    db.add(mt)
    db.flush()
    for req in body.default_requirements:
        db.add(MissionTypeRequirement(mission_type_id=mt.id, **req.model_dump()))
    if body.is_recurring_template:
        if (body.routine_hours_mode or "uniform") == "custom":
            _replace_time_windows(db, mt.id, body.time_windows)
        else:
            _replace_time_windows(db, mt.id, [])
        if body.staffing_bands:
            _replace_staffing_bands(db, mt.id, body.staffing_bands)
    else:
        _replace_time_windows(db, mt.id, body.time_windows)
        _replace_staffing_bands(db, mt.id, [])
    db.flush()
    mt = (
        db.query(MissionType)
        .options(*_mt_load_options())
        .filter(MissionType.id == mt.id)
        .one()
    )
    sync_mission_type_to_drafts(db, mt)
    db.commit()
    mt = (
        db.query(MissionType)
        .options(*_mt_load_options())
        .filter(MissionType.id == mt.id)
        .one()
    )
    return mission_type_out(mt)


@router.put("/mission-types/{mt_id}", response_model=MissionTypeOut)
def update_mission_type(
    mt_id: int,
    body: MissionTypeUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_commander),
):
    mt = (
        db.query(MissionType)
        .options(*_mt_load_options())
        .filter(MissionType.id == mt_id, MissionType.company_id == user.company_id)
        .first()
    )
    if not mt:
        raise HTTPException(404, "סוג משימה לא נמצא")
    data = body.model_dump(
        exclude_unset=True,
        exclude={"default_requirements", "time_windows", "staffing_bands"},
    )
    personnel = (
        body.default_personnel_count
        if body.default_personnel_count is not None
        else mt.default_personnel_count
    )
    bands_for_check = (
        body.staffing_bands
        if body.staffing_bands is not None
        else list(getattr(mt, "staffing_bands", []) or [])
    )
    if body.staffing_bands is not None:
        _assert_staffing_bands(body.staffing_bands)
    if not bands_for_check:
        if body.default_requirements is not None:
            _assert_staffing_matches_requirements(personnel, body.default_requirements)
        else:
            _assert_staffing_matches_requirements(
                personnel, list(mt.default_requirements)
            )
    recurring = (
        body.is_recurring_template
        if body.is_recurring_template is not None
        else mt.is_recurring_template
    )
    data["recurring_end_hour"] = None
    if recurring:
        hours_mode = (
            data["routine_hours_mode"]
            if "routine_hours_mode" in data
            else getattr(mt, "routine_hours_mode", None) or "uniform"
        )
        start_hour = (
            data["recurring_start_hour"]
            if "recurring_start_hour" in data
            else mt.recurring_start_hour
        )
        policy = (
            data["routine_remainder_policy"]
            if "routine_remainder_policy" in data
            else getattr(mt, "routine_remainder_policy", None)
        )
        kind = (
            data["recurrence_kind"]
            if "recurrence_kind" in data
            else getattr(mt, "recurrence_kind", None) or "daily"
        )
        interval = (
            data["recurrence_interval_days"]
            if "recurrence_interval_days" in data
            else getattr(mt, "recurrence_interval_days", None) or 1
        )
        weekdays = (
            data["recurrence_weekdays"]
            if "recurrence_weekdays" in data
            else getattr(mt, "recurrence_weekdays", None)
        )
        anchor = (
            data["recurrence_anchor_date"]
            if "recurrence_anchor_date" in data
            else getattr(mt, "recurrence_anchor_date", None)
        )
        windows_for_check = (
            body.time_windows
            if body.time_windows is not None
            else list(getattr(mt, "time_windows", []) or [])
        )
        _assert_routine_fields(
            True,
            hours_mode=hours_mode,
            start_hour=start_hour,
            remainder_policy=policy,
            recurrence_kind=kind,
            interval_days=interval,
            weekdays=weekdays,
            anchor_date=anchor,
            time_windows=windows_for_check,
        )
        if hours_mode == "custom":
            data["recurring_start_hour"] = None
    else:
        data["recurring_start_hour"] = None
        data["recurrence_kind"] = "daily"
        data["recurrence_interval_days"] = 1
        data["recurrence_weekdays"] = None
        data["recurrence_anchor_date"] = None
        data["routine_hours_mode"] = "uniform"
        if body.time_windows is not None:
            _assert_time_windows(body.time_windows)
        elif body.is_recurring_template is False:
            _assert_time_windows(list(mt.time_windows))
    for k, v in data.items():
        setattr(mt, k, v)
    if body.default_requirements is not None:
        db.query(MissionTypeRequirement).filter(
            MissionTypeRequirement.mission_type_id == mt.id
        ).delete()
        for req in body.default_requirements:
            db.add(MissionTypeRequirement(mission_type_id=mt.id, **req.model_dump()))
    if recurring:
        hours_mode = getattr(mt, "routine_hours_mode", None) or "uniform"
        if hours_mode == "custom":
            if body.time_windows is not None:
                _replace_time_windows(db, mt.id, body.time_windows)
        else:
            _replace_time_windows(db, mt.id, [])
        if body.staffing_bands is not None:
            _replace_staffing_bands(db, mt.id, body.staffing_bands)
    else:
        if body.time_windows is not None:
            _replace_time_windows(db, mt.id, body.time_windows)
        _replace_staffing_bands(db, mt.id, [])
    db.flush()
    mt = (
        db.query(MissionType)
        .options(*_mt_load_options())
        .filter(MissionType.id == mt.id)
        .one()
    )
    sync_mission_type_to_drafts(db, mt)
    db.commit()
    mt = (
        db.query(MissionType)
        .options(*_mt_load_options())
        .filter(MissionType.id == mt.id)
        .one()
    )
    return mission_type_out(mt)


@router.delete("/mission-types/{mt_id}")
def delete_mission_type(
    mt_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_commander),
):
    mt = (
        db.query(MissionType)
        .filter(MissionType.id == mt_id, MissionType.company_id == user.company_id)
        .first()
    )
    if not mt:
        raise HTTPException(404, "סוג משימה לא נמצא")
    mission_count = (
        db.query(Mission)
        .filter(Mission.company_id == user.company_id, Mission.mission_type_id == mt.id)
        .count()
    )
    if mission_count:
        raise HTTPException(
            400,
            f"לא ניתן למחוק — יש {mission_count} משימות מסוג זה בחלון שיבוץ. הסירו אותן קודם.",
        )
    event_count = (
        db.query(WorkloadEvent)
        .filter(
            WorkloadEvent.company_id == user.company_id,
            WorkloadEvent.mission_type_id == mt.id,
        )
        .count()
    )
    if event_count:
        raise HTTPException(
            400,
            "לא ניתן למחוק — יש היסטוריית עומס לסוג משימה זה. ניתן להסיר מסימון «בשיבוץ» במקום.",
        )
    db.query(PersonAllowedMissionType).filter(
        PersonAllowedMissionType.mission_type_id == mt.id
    ).delete(synchronize_session=False)
    db.query(MissionTypeRequirement).filter(
        MissionTypeRequirement.mission_type_id == mt.id
    ).delete(synchronize_session=False)
    db.query(Restriction).filter(Restriction.mission_type_id == mt.id).update(
        {Restriction.mission_type_id: None}, synchronize_session=False
    )
    db.query(RecurringRestriction).filter(
        RecurringRestriction.mission_type_id == mt.id
    ).update({RecurringRestriction.mission_type_id: None}, synchronize_session=False)
    db.delete(mt)
    db.commit()
    return {"ok": True}


# ---------- missions ----------

@router.get("/missions", response_model=List[MissionOut])
def list_missions(
    schedule_id: Optional[int] = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    q = (
        db.query(Mission)
        .options(joinedload(Mission.requirements), joinedload(Mission.mission_type))
        .filter(Mission.company_id == user.company_id)
    )
    if schedule_id is not None:
        q = q.filter(Mission.schedule_id == schedule_id)
    return [mission_out(m) for m in q.order_by(Mission.start_at).all()]


@router.post("/missions", response_model=MissionOut)
def create_mission(
    body: MissionCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_commander),
):
    from app.services.staffing import StaffingReq, resolve_staffing_for_start

    mt = (
        db.query(MissionType)
        .options(
            joinedload(MissionType.default_requirements),
            joinedload(MissionType.staffing_bands).joinedload(
                MissionTypeStaffingBand.requirements
            ),
        )
        .filter(MissionType.id == body.mission_type_id, MissionType.company_id == user.company_id)
        .first()
    )
    if not mt:
        raise HTTPException(404, "סוג משימה לא נמצא")

    default_reqs = [
        StaffingReq(
            r.role_id,
            r.qualification_id,
            r.count,
            bool(getattr(r, "exact_role", False)),
            True
            if getattr(r, "exact_qualification", None) is None
            else bool(r.exact_qualification),
        )
        for r in mt.default_requirements
    ]
    bands = [
        (
            b.start_minute,
            b.end_minute,
            b.personnel_count,
            b.label,
            [
                StaffingReq(
                    r.role_id,
                    r.qualification_id,
                    r.count,
                    bool(getattr(r, "exact_role", False)),
                    True
                    if getattr(r, "exact_qualification", None) is None
                    else bool(r.exact_qualification),
                )
                for r in (b.requirements or [])
            ],
        )
        for b in sorted(
            getattr(mt, "staffing_bands", None) or [],
            key=lambda x: (x.sort_order, x.id),
        )
    ]
    resolved = resolve_staffing_for_start(
        body.start_at,
        default_personnel=mt.default_personnel_count,
        default_requirements=default_reqs,
        bands=bands,
    )
    personnel = (
        body.personnel_count
        if body.personnel_count is not None
        else resolved.personnel_count
    )
    mission = Mission(
        company_id=user.company_id,
        mission_type_id=mt.id,
        name=body.name,
        start_at=body.start_at,
        end_at=body.end_at,
        difficulty_weight=body.difficulty_weight if body.difficulty_weight is not None else mt.difficulty_weight,
        personnel_count=personnel,
        notes=body.notes,
        is_adhoc=body.is_adhoc,
        schedule_id=body.schedule_id,
    )
    if body.schedule_id:
        schedule = (
            db.query(Schedule)
            .filter(
                Schedule.id == body.schedule_id,
                Schedule.company_id == user.company_id,
            )
            .first()
        )
        if not schedule:
            raise HTTPException(404, "שיבוץ לא נמצא")
        if schedule.status == ScheduleStatus.PUBLISHED:
            raise HTTPException(400, "לא ניתן להוסיף משימה לשיבוץ שפורסם")
    db.add(mission)
    db.flush()
    reqs = [r.model_dump() for r in body.requirements]
    if not reqs:
        if resolved.requirements:
            reqs = [
                {
                    "role_id": r.role_id,
                    "qualification_id": r.qualification_id,
                    "count": r.count,
                    "label": None,
                    "exact_role": bool(r.exact_role),
                    "exact_qualification": bool(r.exact_qualification),
                }
                for r in resolved.requirements
            ]
        elif mt.default_requirements:
            reqs = [
                {
                    "role_id": r.role_id,
                    "qualification_id": r.qualification_id,
                    "count": r.count,
                    "label": None,
                    "exact_role": bool(getattr(r, "exact_role", False)),
                    "exact_qualification": (
                        True
                        if getattr(r, "exact_qualification", None) is None
                        else bool(r.exact_qualification)
                    ),
                }
                for r in mt.default_requirements
            ]
    for payload in reqs:
        db.add(MissionRequirement(mission_id=mission.id, **payload))
    if not reqs:
        for _ in range(mission.personnel_count):
            db.add(MissionRequirement(mission_id=mission.id, count=1, label="חייל"))
    db.commit()
    mission = (
        db.query(Mission)
        .options(joinedload(Mission.requirements), joinedload(Mission.mission_type))
        .filter(Mission.id == mission.id)
        .one()
    )
    return mission_out(mission)


@router.put("/missions/{mission_id}", response_model=MissionOut)
def update_mission(
    mission_id: int,
    body: MissionUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_commander),
):
    mission = (
        db.query(Mission)
        .options(joinedload(Mission.requirements), joinedload(Mission.mission_type))
        .filter(Mission.id == mission_id, Mission.company_id == user.company_id)
        .first()
    )
    if not mission:
        raise HTTPException(404, "משימה לא נמצאה")
    if mission.schedule_id:
        schedule = db.query(Schedule).filter(Schedule.id == mission.schedule_id).first()
        if schedule and schedule.status == ScheduleStatus.PUBLISHED:
            raise HTTPException(400, "לא ניתן לערוך משימה משיבוץ שפורסם")
    data = body.model_dump(exclude_unset=True, exclude={"requirements"})
    for k, v in data.items():
        setattr(mission, k, v)
    if body.requirements is not None:
        old_req_ids = [r.id for r in mission.requirements]
        if old_req_ids:
            db.query(Assignment).filter(Assignment.requirement_id.in_(old_req_ids)).update(
                {"requirement_id": None}, synchronize_session=False
            )
        db.query(MissionRequirement).filter(MissionRequirement.mission_id == mission.id).delete()
        for req in body.requirements:
            db.add(MissionRequirement(mission_id=mission.id, **req.model_dump()))
    db.commit()
    mission = (
        db.query(Mission)
        .options(joinedload(Mission.requirements), joinedload(Mission.mission_type))
        .filter(Mission.id == mission.id)
        .one()
    )
    return mission_out(mission)


@router.delete("/missions/{mission_id}")
def delete_mission(
    mission_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_commander),
):
    mission = (
        db.query(Mission)
        .filter(Mission.id == mission_id, Mission.company_id == user.company_id)
        .first()
    )
    if not mission:
        raise HTTPException(404, "משימה לא נמצאה")
    if mission.schedule_id:
        schedule = db.query(Schedule).filter(Schedule.id == mission.schedule_id).first()
        if schedule and schedule.status == ScheduleStatus.PUBLISHED:
            raise HTTPException(400, "לא ניתן למחוק משימה משיבוץ שפורסם")
    db.query(Assignment).filter(Assignment.mission_id == mission_id).delete(
        synchronize_session=False
    )
    db.delete(mission)
    db.commit()
    return {"ok": True}


# ---------- constraints ----------

@router.get("/constraints", response_model=List[ConstraintOut])
def list_constraints(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return (
        db.query(SchedulingConstraint)
        .filter(SchedulingConstraint.company_id == user.company_id)
        .all()
    )


@router.post("/constraints", response_model=ConstraintOut)
def create_constraint(
    body: ConstraintCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_commander),
):
    c = SchedulingConstraint(company_id=user.company_id, **body.model_dump())
    db.add(c)
    db.commit()
    db.refresh(c)
    return c


def scheduling_rule_out(rule: SchedulingRule) -> SchedulingRuleOut:
    source_rows = sorted(rule.source_types, key=lambda r: r.mission_type_id)
    blocked_rows = sorted(rule.blocked_types, key=lambda r: r.mission_type_id)
    role_rows = sorted(rule.roles, key=lambda r: r.role_id)
    qual_rows = sorted(rule.qualifications, key=lambda r: r.qualification_id)
    kind = getattr(rule, "rule_kind", None) or SchedulingRuleKind.TRANSITION
    scope = getattr(rule, "presence_scope", None) or PresenceScope.NOT_AT_HOME
    return SchedulingRuleOut(
        id=rule.id,
        company_id=rule.company_id,
        name=rule.name,
        rule_kind=kind,
        source_mission_type_ids=[r.mission_type_id for r in source_rows],
        blocked_mission_type_ids=[r.mission_type_id for r in blocked_rows],
        source_mission_type_names=[
            r.mission_type.name if r.mission_type else str(r.mission_type_id)
            for r in source_rows
        ],
        blocked_mission_type_names=[
            r.mission_type.name if r.mission_type else str(r.mission_type_id)
            for r in blocked_rows
        ],
        min_source_hours=rule.min_source_hours,
        cooldown_hours=rule.cooldown_hours,
        min_count=getattr(rule, "min_count", 1) or 1,
        presence_scope=scope,
        severity=rule.severity,
        applies_to_all_roles=rule.applies_to_all_roles,
        role_ids=[r.role_id for r in role_rows],
        role_names=[r.role.name if r.role else str(r.role_id) for r in role_rows],
        qualification_ids=[r.qualification_id for r in qual_rows],
        qualification_names=[
            r.qualification.name if r.qualification else str(r.qualification_id)
            for r in qual_rows
        ],
        is_active=rule.is_active,
    )


def _set_rule_links(
    db: Session,
    rule: SchedulingRule,
    *,
    kind: SchedulingRuleKind,
    source_ids: List[int],
    blocked_ids: List[int],
    role_ids: List[int],
    qualification_ids: List[int],
    applies_to_all: bool,
    company_id: int,
    presence_scope: PresenceScope,
) -> None:
    rule.source_types.clear()
    rule.blocked_types.clear()
    rule.roles.clear()
    rule.qualifications.clear()
    db.flush()

    type_ids = list(source_ids) + list(blocked_ids)
    if type_ids:
        types = {
            t.id: t
            for t in db.query(MissionType)
            .filter(MissionType.company_id == company_id, MissionType.id.in_(type_ids))
            .all()
        }
        missing = [i for i in type_ids if i not in types]
        if missing:
            raise HTTPException(400, "סוג משימה לא נמצא בכלל")

    if kind == SchedulingRuleKind.TRANSITION:
        if not source_ids or not blocked_ids:
            raise HTTPException(400, "יש לבחור לפחות סוג מקור אחד וסוג חסום אחד")
        for mid in sorted(set(source_ids)):
            rule.source_types.append(SchedulingRuleSourceType(mission_type_id=mid))
        for mid in sorted(set(blocked_ids)):
            rule.blocked_types.append(SchedulingRuleBlockedType(mission_type_id=mid))
        if not applies_to_all:
            if not role_ids:
                raise HTTPException(400, "בחרו תפקידים או סמנו «כל כוח האדם»")
            roles = {
                r.id: r
                for r in db.query(Role)
                .filter(Role.company_id == company_id, Role.id.in_(role_ids))
                .all()
            }
            if any(i not in roles for i in role_ids):
                raise HTTPException(400, "תפקיד לא נמצא בכלל")
            for rid in sorted(set(role_ids)):
                rule.roles.append(SchedulingRuleRole(role_id=rid))
        return

    if kind == SchedulingRuleKind.SLEEP_BEFORE_AFTER:
        if not source_ids:
            raise HTTPException(400, "בחרו לפחות סוג משימה אחד שדורש שינה לפני אפטר")
        for mid in sorted(set(source_ids)):
            rule.source_types.append(SchedulingRuleSourceType(mission_type_id=mid))
        if not applies_to_all:
            if not role_ids:
                raise HTTPException(400, "בחרו תפקידים או סמנו «כל כוח האדם»")
            roles = {
                r.id: r
                for r in db.query(Role)
                .filter(Role.company_id == company_id, Role.id.in_(role_ids))
                .all()
            }
            if any(i not in roles for i in role_ids):
                raise HTTPException(400, "תפקיד לא נמצא בכלל")
            for rid in sorted(set(role_ids)):
                rule.roles.append(SchedulingRuleRole(role_id=rid))
        return

    # min_presence
    if not role_ids and not qualification_ids:
        raise HTTPException(400, "בחרו לפחות תפקיד אחד או פק״ל אחד לנוכחות")
    if presence_scope == PresenceScope.ON_MISSION_TYPES and not source_ids:
        raise HTTPException(400, "בחרו סוגי משימה שנחשבים «במוצב»")
    if role_ids:
        roles = {
            r.id: r
            for r in db.query(Role)
            .filter(Role.company_id == company_id, Role.id.in_(role_ids))
            .all()
        }
        if any(i not in roles for i in role_ids):
            raise HTTPException(400, "תפקיד לא נמצא בכלל")
        for rid in sorted(set(role_ids)):
            rule.roles.append(SchedulingRuleRole(role_id=rid))
    if qualification_ids:
        from app.models import Qualification

        quals = {
            q.id: q
            for q in db.query(Qualification)
            .filter(
                Qualification.company_id == company_id,
                Qualification.id.in_(qualification_ids),
            )
            .all()
        }
        if any(i not in quals for i in qualification_ids):
            raise HTTPException(400, "פק״ל לא נמצא בכלל")
        for qid in sorted(set(qualification_ids)):
            rule.qualifications.append(
                SchedulingRuleQualification(qualification_id=qid)
            )
    if presence_scope == PresenceScope.ON_MISSION_TYPES:
        for mid in sorted(set(source_ids)):
            rule.source_types.append(SchedulingRuleSourceType(mission_type_id=mid))


@router.get("/scheduling-rules", response_model=List[SchedulingRuleOut])
def list_scheduling_rules(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    return [scheduling_rule_out(r) for r in load_scheduling_rules(db, user.company_id)]


@router.post("/scheduling-rules", response_model=SchedulingRuleOut)
def create_scheduling_rule(
    body: SchedulingRuleCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_commander),
):
    rule = SchedulingRule(
        company_id=user.company_id,
        name=(body.name or "").strip() or None,
        rule_kind=body.rule_kind,
        min_source_hours=body.min_source_hours,
        cooldown_hours=body.cooldown_hours,
        min_count=body.min_count,
        presence_scope=body.presence_scope,
        severity=body.severity,
        applies_to_all_roles=(
            True
            if body.rule_kind == SchedulingRuleKind.MIN_PRESENCE
            else body.applies_to_all_roles
        ),
        is_active=body.is_active,
    )
    db.add(rule)
    db.flush()
    try:
        _set_rule_links(
            db,
            rule,
            kind=body.rule_kind,
            source_ids=body.source_mission_type_ids,
            blocked_ids=body.blocked_mission_type_ids,
            role_ids=body.role_ids,
            qualification_ids=body.qualification_ids,
            applies_to_all=rule.applies_to_all_roles,
            company_id=user.company_id,
            presence_scope=body.presence_scope,
        )
    except HTTPException:
        db.rollback()
        raise
    db.commit()
    rules = load_scheduling_rules(db, user.company_id)
    created = next(r for r in rules if r.id == rule.id)
    return scheduling_rule_out(created)


@router.put("/scheduling-rules/{rule_id}", response_model=SchedulingRuleOut)
def update_scheduling_rule(
    rule_id: int,
    body: SchedulingRuleUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_commander),
):
    rule = (
        db.query(SchedulingRule)
        .options(
            joinedload(SchedulingRule.source_types),
            joinedload(SchedulingRule.blocked_types),
            joinedload(SchedulingRule.roles),
            joinedload(SchedulingRule.qualifications),
        )
        .filter(SchedulingRule.id == rule_id, SchedulingRule.company_id == user.company_id)
        .first()
    )
    if not rule:
        raise HTTPException(404, "כלל לא נמצא")
    data = body.model_dump(exclude_unset=True)
    if "name" in data:
        rule.name = (data["name"] or "").strip() or None
    if "rule_kind" in data and data["rule_kind"] is not None:
        rule.rule_kind = data["rule_kind"]
    if "min_source_hours" in data and data["min_source_hours"] is not None:
        rule.min_source_hours = data["min_source_hours"]
    if "cooldown_hours" in data and data["cooldown_hours"] is not None:
        rule.cooldown_hours = data["cooldown_hours"]
    if "min_count" in data and data["min_count"] is not None:
        rule.min_count = data["min_count"]
    if "presence_scope" in data and data["presence_scope"] is not None:
        rule.presence_scope = data["presence_scope"]
    if "severity" in data and data["severity"] is not None:
        rule.severity = data["severity"]
    if "is_active" in data and data["is_active"] is not None:
        rule.is_active = data["is_active"]
    if "applies_to_all_roles" in data and data["applies_to_all_roles"] is not None:
        rule.applies_to_all_roles = data["applies_to_all_roles"]

    kind = rule.rule_kind or SchedulingRuleKind.TRANSITION
    _set_rule_links(
        db,
        rule,
        kind=kind,
        source_ids=data.get("source_mission_type_ids")
        if "source_mission_type_ids" in data
        else [r.mission_type_id for r in rule.source_types],
        blocked_ids=data.get("blocked_mission_type_ids")
        if "blocked_mission_type_ids" in data
        else [r.mission_type_id for r in rule.blocked_types],
        role_ids=data.get("role_ids")
        if "role_ids" in data
        else [r.role_id for r in rule.roles],
        qualification_ids=data.get("qualification_ids")
        if "qualification_ids" in data
        else [r.qualification_id for r in rule.qualifications],
        applies_to_all=rule.applies_to_all_roles,
        company_id=user.company_id,
        presence_scope=rule.presence_scope or PresenceScope.NOT_AT_HOME,
    )
    db.commit()
    rules = load_scheduling_rules(db, user.company_id)
    updated = next(r for r in rules if r.id == rule_id)
    return scheduling_rule_out(updated)


@router.delete("/scheduling-rules/{rule_id}")
def delete_scheduling_rule(
    rule_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_commander),
):
    rule = (
        db.query(SchedulingRule)
        .filter(SchedulingRule.id == rule_id, SchedulingRule.company_id == user.company_id)
        .first()
    )
    if not rule:
        raise HTTPException(404, "כלל לא נמצא")
    db.delete(rule)
    db.commit()
    return {"ok": True}


# ---------- schedules ----------

@router.get("/schedule-plans/active", response_model=Optional[SchedulePlanOut])
def get_active_schedule_plan(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    plan = active_draft_plan(db, user.company_id)
    if not plan:
        return None
    return schedule_plan_out(db, plan)


@router.get("/schedule-plans/{plan_id}", response_model=SchedulePlanOut)
def get_schedule_plan(
    plan_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    plan = load_plan(db, plan_id, user.company_id)
    if not plan:
        raise HTTPException(404, "תוכנית שיבוץ לא נמצאה")
    return schedule_plan_out(db, plan)


@router.post("/schedule-plans", response_model=SchedulePlanOut)
def create_plan(
    body: SchedulePlanCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_commander),
):
    if body.days_count < 1 or body.days_count > MAX_PLAN_DAYS:
        raise HTTPException(400, f"מספר ימים חייב להיות בין 1 ל־{MAX_PLAN_DAYS}")

    today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0).date()
    kind = (body.start_kind or "tomorrow").strip().lower()
    if kind == "today":
        start = today
    elif kind == "tomorrow":
        start = today + timedelta(days=1)
    elif kind == "date":
        if not body.start_date:
            raise HTTPException(400, "חסר תאריך התחלה")
        start = body.start_date
    else:
        raise HTTPException(400, "סוג התחלה לא חוקי")

    plan = create_schedule_plan(
        db,
        company_id=user.company_id,
        user_id=user.id,
        start_date=start,
        days_count=body.days_count,
        instantiate=body.instantiate_recurring,
        notes=body.notes,
    )
    db.commit()
    plan = load_plan(db, plan.id, user.company_id)
    assert plan is not None
    if body.generate:
        try:
            generate_plan(db, plan, user_id=user.id, scope="all_draft")
        except ValueError as e:
            raise HTTPException(400, str(e))
    plan = load_plan(db, plan.id, user.company_id)
    assert plan is not None
    return schedule_plan_out(db, plan)


@router.post("/schedule-plans/{plan_id}/generate", response_model=SchedulePlanOut)
def generate_schedule_plan(
    plan_id: int,
    body: SchedulePlanGenerateIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_commander),
):
    plan = load_plan(db, plan_id, user.company_id)
    if not plan:
        raise HTTPException(404, "תוכנית שיבוץ לא נמצאה")
    scope = (body.scope or "all_draft").strip().lower()
    if scope not in ("all_draft", "day"):
        raise HTTPException(400, "scope חייב להיות all_draft או day")
    try:
        generate_plan(
            db,
            plan,
            user_id=user.id,
            scope=scope,
            day_schedule_id=body.day_schedule_id,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    plan = load_plan(db, plan.id, user.company_id)
    assert plan is not None
    return schedule_plan_out(db, plan)


@router.post("/schedule-plans/{plan_id}/publish", response_model=SchedulePlanOut)
def publish_schedule_plan(
    plan_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_commander),
):
    plan = load_plan(db, plan_id, user.company_id)
    if not plan:
        raise HTTPException(404, "תוכנית שיבוץ לא נמצאה")
    try:
        plan = publish_plan(db, plan, user.id)
    except ValueError as e:
        raise HTTPException(400, str(e))
    plan = load_plan(db, plan.id, user.company_id)
    assert plan is not None
    return schedule_plan_out(db, plan)


@router.get("/schedules", response_model=List[ScheduleOut])
def list_schedules(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    schedules = (
        db.query(Schedule)
        .filter(Schedule.company_id == user.company_id)
        .order_by(Schedule.window_start.desc())
        .all()
    )
    return [schedule_out(db, s) for s in schedules]


@router.get("/schedules/{schedule_id}", response_model=ScheduleOut)
def get_schedule(
    schedule_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    schedule = (
        db.query(Schedule)
        .filter(Schedule.id == schedule_id, Schedule.company_id == user.company_id)
        .first()
    )
    if not schedule:
        raise HTTPException(404, "שיבוץ לא נמצא")
    return schedule_out(db, schedule)


@router.post("/schedules", response_model=ScheduleOut)
def create_schedule(
    body: ScheduleCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_commander),
):
    if body.window_end <= body.window_start:
        raise HTTPException(400, "חלון השיבוץ אינו תקין")
    schedule = Schedule(
        company_id=user.company_id,
        window_start=body.window_start,
        window_end=body.window_end,
        status=ScheduleStatus.DRAFT,
        created_by_id=user.id,
        notes=body.notes,
    )
    db.add(schedule)
    db.flush()
    if body.instantiate_recurring:
        instantiate_active_mission_types(db, schedule)
    # Attach orphan ad-hoc missions in window
    orphans = (
        db.query(Mission)
        .filter(
            Mission.company_id == user.company_id,
            Mission.schedule_id.is_(None),
            Mission.start_at >= body.window_start,
            Mission.start_at < body.window_end,
        )
        .all()
    )
    for m in orphans:
        m.schedule_id = schedule.id
    db.commit()
    return schedule_out(db, schedule)


@router.post("/schedules/{schedule_id}/sync-missions", response_model=ScheduleOut)
def sync_schedule_missions(
    schedule_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_commander),
):
    """Pull any missing active mission types into this draft schedule."""
    schedule = (
        db.query(Schedule)
        .filter(Schedule.id == schedule_id, Schedule.company_id == user.company_id)
        .first()
    )
    if not schedule:
        raise HTTPException(404, "שיבוץ לא נמצא")
    if schedule.status != ScheduleStatus.DRAFT:
        raise HTTPException(400, "ניתן לסנכרן משימות רק בטיוטה")
    instantiate_active_mission_types(db, schedule)
    db.commit()
    return schedule_out(db, schedule)


@router.post("/schedules/{schedule_id}/generate", response_model=SchedulingResultOut)
def generate(
    schedule_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_commander),
):
    schedule = (
        db.query(Schedule)
        .filter(Schedule.id == schedule_id, Schedule.company_id == user.company_id)
        .first()
    )
    if not schedule:
        raise HTTPException(404, "שיבוץ לא נמצא")
    try:
        result = generate_schedule(db, schedule, user_id=user.id)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return SchedulingResultOut(
        status=result.status,
        schedule=schedule_out(db, result.schedule),
        warnings=[
            ViolationOut(
                severity=v.severity,
                code=v.code,
                message=v.message,
                mission_id=v.mission_id,
                person_id=v.person_id,
                details=v.details,
            )
            for v in result.warnings
        ],
        conflicts=[
            ConflictOut(
                mission_id=c.mission_id,
                mission_name=c.mission_name,
                message=c.message,
                missing_role_id=c.missing_role_id,
                missing_qualification_id=c.missing_qualification_id,
                suggested_person_ids=c.suggested_person_ids,
            )
            for c in result.conflicts
        ],
        explanations=result.explanations,
    )


@router.get(
    "/schedules/{schedule_id}/assignments/{assignment_id}/replacements",
    response_model=ReplacementOptionsOut,
)
def list_replacements(
    schedule_id: int,
    assignment_id: int,
    mode: str = Query("matching", pattern="^(matching|all)$"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    schedule = (
        db.query(Schedule)
        .filter(Schedule.id == schedule_id, Schedule.company_id == user.company_id)
        .first()
    )
    if not schedule:
        raise HTTPException(404, "שיבוץ לא נמצא")
    try:
        options = list_replacement_candidates(
            db, schedule, assignment_id, mode=mode
        )
    except ValueError as e:
        raise HTTPException(404, str(e))
    return ReplacementOptionsOut(
        mode=options.mode,
        slot_label=options.slot_label,
        required_role_name=options.required_role_name,
        required_qualification_name=options.required_qualification_name,
        empty_message=options.empty_message,
        candidates=[
            ReplacementCandidateOut(
                person_id=c.person.id,
                person_name=c.person.full_name,
                role_name=c.person.role.name if c.person.role else None,
                soft_warnings=[v.message for v in c.result.soft_violations],
                requires_override=c.requires_override,
            )
            for c in options.candidates
        ],
    )


@router.post("/schedules/{schedule_id}/assignments/{assignment_id}/replace", response_model=AssignmentOut)
def replace(
    schedule_id: int,
    assignment_id: int,
    body: AssignmentReplace,
    db: Session = Depends(get_db),
    user: User = Depends(require_commander),
):
    schedule = (
        db.query(Schedule)
        .filter(Schedule.id == schedule_id, Schedule.company_id == user.company_id)
        .first()
    )
    if not schedule:
        raise HTTPException(404, "שיבוץ לא נמצא")
    try:
        assignment = replace_assignment(
            db, schedule, assignment_id, body.person_id, body.override_reason
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    assignment = (
        db.query(Assignment)
        .options(joinedload(Assignment.person), joinedload(Assignment.mission))
        .filter(Assignment.id == assignment.id)
        .one()
    )
    return assignment_out(assignment)


@router.post("/schedules/{schedule_id}/validate")
def validate(
    schedule_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    schedule = (
        db.query(Schedule)
        .filter(Schedule.id == schedule_id, Schedule.company_id == user.company_id)
        .first()
    )
    if not schedule:
        raise HTTPException(404, "שיבוץ לא נמצא")
    result = validate_schedule(db, schedule)
    return {
        "ok": result.ok,
        "violations": [
            {
                "severity": v.severity,
                "code": v.code,
                "message": v.message,
                "mission_id": v.mission_id,
                "person_id": v.person_id,
                "details": v.details,
            }
            for v in result.violations
        ],
    }


@router.post("/schedules/{schedule_id}/publish", response_model=ScheduleOut)
def publish(
    schedule_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_commander),
):
    schedule = (
        db.query(Schedule)
        .filter(Schedule.id == schedule_id, Schedule.company_id == user.company_id)
        .first()
    )
    if not schedule:
        raise HTTPException(404, "שיבוץ לא נמצא")
    try:
        schedule = publish_schedule(db, schedule, user.id)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return schedule_out(db, schedule)


# ---------- kanim + after ----------

@router.get("/kanim-rules", response_model=List[KanimRuleOut])
def list_kanim_rules(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return (
        db.query(KanimRule)
        .filter(KanimRule.company_id == user.company_id)
        .order_by(KanimRule.kind, KanimRule.specific_date)
        .all()
    )


@router.post("/kanim-rules", response_model=KanimRuleOut)
def create_kanim_rule(
    body: KanimRuleCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_commander),
):
    if body.kind == KanimRuleKind.SPECIFIC_DATE and not body.specific_date:
        raise HTTPException(400, "יש לציין תאריך לכלל תאריך ספציפי")
    if body.kind != KanimRuleKind.SPECIFIC_DATE:
        body = body.model_copy(update={"specific_date": None})
    # One rule per weekday/weekend kind
    if body.kind in (KanimRuleKind.WEEKDAY, KanimRuleKind.WEEKEND):
        existing = (
            db.query(KanimRule)
            .filter(KanimRule.company_id == user.company_id, KanimRule.kind == body.kind)
            .first()
        )
        if existing:
            existing.min_count = body.min_count
            existing.notes = body.notes
            db.commit()
            db.refresh(existing)
            return existing
    row = KanimRule(
        company_id=user.company_id,
        kind=body.kind,
        min_count=body.min_count,
        specific_date=body.specific_date,
        notes=body.notes,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.put("/kanim-rules/{rule_id}", response_model=KanimRuleOut)
def update_kanim_rule(
    rule_id: int,
    body: KanimRuleUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_commander),
):
    row = (
        db.query(KanimRule)
        .filter(KanimRule.id == rule_id, KanimRule.company_id == user.company_id)
        .first()
    )
    if not row:
        raise HTTPException(404, "כלל קנים לא נמצא")
    data = body.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(row, k, v)
    if row.kind == KanimRuleKind.SPECIFIC_DATE and not row.specific_date:
        raise HTTPException(400, "יש לציין תאריך לכלל תאריך ספציפי")
    if row.kind != KanimRuleKind.SPECIFIC_DATE:
        row.specific_date = None
    db.commit()
    db.refresh(row)
    return row


@router.delete("/kanim-rules/{rule_id}")
def delete_kanim_rule(
    rule_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_commander),
):
    row = (
        db.query(KanimRule)
        .filter(KanimRule.id == rule_id, KanimRule.company_id == user.company_id)
        .first()
    )
    if not row:
        raise HTTPException(404, "כלל קנים לא נמצא")
    db.delete(row)
    db.commit()
    return {"ok": True}


@router.get("/schedules/{schedule_id}/after", response_model=AfterPreviewOut)
def get_after_preview(
    schedule_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    schedule = (
        db.query(Schedule)
        .filter(Schedule.id == schedule_id, Schedule.company_id == user.company_id)
        .first()
    )
    if not schedule:
        raise HTTPException(404, "שיבוץ לא נמצא")
    preview = build_after_preview(db, schedule)
    people_names = {
        p.id: p.full_name
        for p in db.query(Person).filter(Person.company_id == user.company_id).all()
    }
    return AfterPreviewOut(
        total_active=preview.total_active,
        min_kanim=preview.min_kanim,
        after_quota=preview.after_quota,
        candidates=[
            AfterCandidateOut(
                person_id=c.person_id,
                person_name=c.person_name,
                after_count_30d=c.after_count_30d,
                sleep_warning=c.sleep_warning,
                sleep_warning_message=c.sleep_warning_message,
                recommended_rank=c.recommended_rank,
            )
            for c in preview.candidates
        ],
        drafts=[
            AfterDraftOut(
                id=d.id,
                schedule_id=d.schedule_id,
                person_id=d.person_id,
                start_at=d.start_at,
                end_at=d.end_at,
                person_name=people_names.get(d.person_id),
            )
            for d in preview.drafts
        ],
    )


@router.put("/schedules/{schedule_id}/after", response_model=AfterPreviewOut)
def put_after_drafts(
    schedule_id: int,
    body: AfterDraftSaveIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_commander),
):
    schedule = (
        db.query(Schedule)
        .filter(Schedule.id == schedule_id, Schedule.company_id == user.company_id)
        .first()
    )
    if not schedule:
        raise HTTPException(404, "שיבוץ לא נמצא")
    try:
        save_after_drafts(
            db,
            schedule,
            [(i.person_id, i.start_at, i.end_at) for i in body.items],
        )
        db.commit()
    except ValueError as e:
        db.rollback()
        raise HTTPException(400, str(e))
    preview = build_after_preview(db, schedule)
    people_names = {
        p.id: p.full_name
        for p in db.query(Person).filter(Person.company_id == user.company_id).all()
    }
    return AfterPreviewOut(
        total_active=preview.total_active,
        min_kanim=preview.min_kanim,
        after_quota=preview.after_quota,
        candidates=[
            AfterCandidateOut(
                person_id=c.person_id,
                person_name=c.person_name,
                after_count_30d=c.after_count_30d,
                sleep_warning=c.sleep_warning,
                sleep_warning_message=c.sleep_warning_message,
                recommended_rank=c.recommended_rank,
            )
            for c in preview.candidates
        ],
        drafts=[
            AfterDraftOut(
                id=d.id,
                schedule_id=d.schedule_id,
                person_id=d.person_id,
                start_at=d.start_at,
                end_at=d.end_at,
                person_name=people_names.get(d.person_id),
            )
            for d in preview.drafts
        ],
    )


# ---------- workload ----------

@router.get("/workload", response_model=WorkloadDashboardOut)
def workload_dashboard(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    people = (
        db.query(Person)
        .filter(Person.company_id == user.company_id)
        .all()
    )
    active_ids = {p.id for p in people if p.is_active}
    events = (
        db.query(WorkloadEvent)
        .filter(WorkloadEvent.company_id == user.company_id)
        .all()
    )
    mission_types = {
        mt.id: mt.name
        for mt in db.query(MissionType).filter(MissionType.company_id == user.company_id)
    }
    # Start with active people so zeros appear; inactive with history are added below.
    by_person = {
        p.id: {"total": 0.0, "by_type": {}} for p in people if p.is_active
    }
    for e in events:
        if e.person_id not in by_person:
            by_person[e.person_id] = {"total": 0.0, "by_type": {}}
        by_person[e.person_id]["total"] += e.delta
        name = mission_types.get(e.mission_type_id, "אחר")
        by_person[e.person_id]["by_type"][name] = (
            by_person[e.person_id]["by_type"].get(name, 0.0) + e.delta
        )
    name_by_id = {p.id: p.full_name for p in people}

    def _display_name(pid: int) -> str:
        name = name_by_id.get(pid)
        if name:
            return name
        return f"חייל #{pid}"

    rows = [
        WorkloadPersonOut(
            person_id=pid,
            person_name=_display_name(pid),
            total=data["total"],
            by_mission_type=data["by_type"],
            is_active=pid in active_ids,
        )
        for pid, data in by_person.items()
    ]
    rows.sort(key=lambda r: r.total, reverse=True)
    return WorkloadDashboardOut(people=rows, snapshot_at=datetime.utcnow())


@router.get("/history/summary", response_model=HistorySummaryOut)
def history_summary(
    days: Optional[int] = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Published assignment hours by person × mission type (not difficulty-weighted)."""
    from datetime import timedelta as td

    to_at = datetime.utcnow()
    from_at = None
    if days is not None and days > 0:
        from_at = to_at - td(days=days)

    q = (
        db.query(Assignment, Mission, MissionType, Person, Schedule)
        .join(Mission, Mission.id == Assignment.mission_id)
        .join(MissionType, MissionType.id == Mission.mission_type_id)
        .join(Person, Person.id == Assignment.person_id)
        .join(Schedule, Schedule.id == Assignment.schedule_id)
        .filter(
            Schedule.company_id == user.company_id,
            Schedule.status == ScheduleStatus.PUBLISHED,
        )
    )
    if from_at is not None:
        q = q.filter(Mission.start_at >= from_at)

    rows_raw = q.all()
    by_person: dict = {}
    type_totals: dict = {}
    schedule_ids = set()

    for assignment, mission, mt, person, schedule in rows_raw:
        schedule_ids.add(schedule.id)
        hours = max(
            0.0, (mission.end_at - mission.start_at).total_seconds() / 3600.0
        )
        if person.id not in by_person:
            by_person[person.id] = {
                "name": person.full_name,
                "total": 0.0,
                "by_type": {},
            }
        by_person[person.id]["total"] += hours
        by_person[person.id]["by_type"][mt.name] = (
            by_person[person.id]["by_type"].get(mt.name, 0.0) + hours
        )
        type_totals[mt.name] = type_totals.get(mt.name, 0.0) + hours

    # Stable order: most total hours across company first
    mission_types = sorted(type_totals.keys(), key=lambda n: (-type_totals[n], n))
    people = [
        HistoryPersonHoursOut(
            person_id=pid,
            person_name=data["name"],
            total_hours=round(data["total"], 2),
            by_mission_type={
                k: round(v, 2) for k, v in data["by_type"].items()
            },
        )
        for pid, data in by_person.items()
    ]
    people.sort(key=lambda r: r.total_hours, reverse=True)
    return HistorySummaryOut(
        people=people,
        mission_types=mission_types,
        from_at=from_at,
        to_at=to_at,
        published_schedules=len(schedule_ids),
    )


@router.get("/schedules/public/{schedule_id}", response_model=ScheduleOut)
def public_schedule(
    schedule_id: int,
    t: str = Query(..., min_length=8, description="Share token from publication"),
    db: Session = Depends(get_db),
):
    """Read-only published schedule. Requires unguessable share token (not id alone)."""
    schedule = (
        db.query(Schedule)
        .filter(
            Schedule.id == schedule_id,
            Schedule.status == ScheduleStatus.PUBLISHED,
            Schedule.share_token == t,
        )
        .first()
    )
    if not schedule:
        raise HTTPException(404, "שיבוץ מפורסם לא נמצא")
    return schedule_out(db, schedule)
