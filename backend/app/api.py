from datetime import datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.deps import get_current_user, require_commander
from app.models import (
    Assignment,
    AfterDraft,
    AfterGrant,
    Company,
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
    ScheduleStatus,
    SchedulingConstraint,
    User,
    WorkloadEvent,
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
    KanimRuleCreate,
    KanimRuleOut,
    KanimRuleUpdate,
    LeaveCreate,
    LeaveOut,
    LoginRequest,
    RegisterRequest,
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
    QualificationCreate,
    QualificationOut,
    QualificationUpdate,
    ReplacementCandidateOut,
    RestrictionCreate,
    RestrictionOut,
    RecurringRestrictionCreate,
    RecurringRestrictionOut,
    RoleCreate,
    RoleOut,
    RoleUpdate,
    ScheduleCreate,
    ScheduleOut,
    SchedulingResultOut,
    Token,
    UserOut,
    ViolationOut,
    ConflictOut,
    WorkloadDashboardOut,
    HistorySummaryOut,
    HistoryPersonHoursOut,
    WorkloadPersonOut,
)
from app.security import authenticate_user, create_access_token
from app.services.bootstrap import bootstrap_company
from app.services.after import (
    after_count_map,
    build_after_preview,
    save_after_drafts,
)
from app.services.scheduling import (
    current_workload_map,
    generate_schedule,
    instantiate_recurring_missions,
    list_replacement_candidates,
    publish_schedule,
    replace_assignment,
)
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
    start_hour: Optional[int],
    remainder_policy: Optional[str],
) -> None:
    if not recurring:
        return
    if start_hour is None:
        raise HTTPException(400, "למשימה רוטינית חובה לבחור שעת התחלה (0–23)")
    if start_hour < 0 or start_hour > 23:
        raise HTTPException(400, "שעת התחלה חייבת להיות בין 0 ל־23")
    if remainder_policy is not None and remainder_policy not in (
        "include_short",
        "full_only",
    ):
        raise HTTPException(400, "מדיניות שארית לא חוקית")


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
        default_requirements=[
            MissionTypeRequirementOut(
                id=r.id,
                role_id=r.role_id,
                qualification_id=r.qualification_id,
                count=r.count,
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
            )
            for r in m.requirements
        ],
        mission_type_name=m.mission_type.name if m.mission_type else None,
    )


def assignment_out(a: Assignment) -> AssignmentOut:
    return AssignmentOut(
        id=a.id,
        schedule_id=a.schedule_id,
        mission_id=a.mission_id,
        person_id=a.person_id,
        requirement_id=a.requirement_id,
        is_manual=a.is_manual,
        override_reason=a.override_reason,
        difficulty_at_assignment=a.difficulty_at_assignment,
        person_name=a.person.full_name if a.person else None,
        mission_name=a.mission.name if a.mission else None,
    )


def schedule_out(db: Session, schedule: Schedule) -> ScheduleOut:
    schedule = (
        db.query(Schedule)
        .options(
            joinedload(Schedule.assignments).joinedload(Assignment.person),
            joinedload(Schedule.assignments).joinedload(Assignment.mission),
            joinedload(Schedule.missions).joinedload(Mission.requirements),
            joinedload(Schedule.missions).joinedload(Mission.mission_type),
        )
        .filter(Schedule.id == schedule.id)
        .one()
    )
    return ScheduleOut(
        id=schedule.id,
        company_id=schedule.company_id,
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
        rank=body.rank,
        notes=body.notes,
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
    for field in ("full_name", "role_id", "rank", "notes", "is_active"):
        val = getattr(body, field)
        if val is not None:
            setattr(person, field, val)
    if body.qualification_ids is not None:
        db.query(PersonQualification).filter(PersonQualification.person_id == person.id).delete()
        for qid in body.qualification_ids:
            db.add(PersonQualification(person_id=person.id, qualification_id=qid))
    if body.allowed_mission_type_ids is not None:
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
        _assert_routine_fields(
            True, body.recurring_start_hour, body.routine_remainder_policy
        )
    else:
        data["recurring_start_hour"] = None
        if body.time_windows:
            _assert_time_windows(body.time_windows)
    mt = MissionType(company_id=user.company_id, **data)
    db.add(mt)
    db.flush()
    for req in body.default_requirements:
        db.add(MissionTypeRequirement(mission_type_id=mt.id, **req.model_dump()))
    if body.is_recurring_template:
        _replace_time_windows(db, mt.id, [])
        _replace_staffing_bands(db, mt.id, body.staffing_bands)
    else:
        _replace_time_windows(db, mt.id, body.time_windows)
        _replace_staffing_bands(db, mt.id, [])
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
        _assert_routine_fields(True, start_hour, policy)
    else:
        data["recurring_start_hour"] = None
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
        _replace_time_windows(db, mt.id, [])
        if body.staffing_bands is not None:
            _replace_staffing_bands(db, mt.id, body.staffing_bands)
    else:
        if body.time_windows is not None:
            _replace_time_windows(db, mt.id, body.time_windows)
        _replace_staffing_bands(db, mt.id, [])
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
        StaffingReq(r.role_id, r.qualification_id, r.count)
        for r in mt.default_requirements
    ]
    bands = [
        (
            b.start_minute,
            b.end_minute,
            b.personnel_count,
            b.label,
            [
                StaffingReq(r.role_id, r.qualification_id, r.count)
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


# ---------- schedules ----------

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
        instantiate_recurring_missions(db, schedule)
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
    response_model=List[ReplacementCandidateOut],
)
def list_replacements(
    schedule_id: int,
    assignment_id: int,
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
        candidates = list_replacement_candidates(db, schedule, assignment_id)
    except ValueError as e:
        raise HTTPException(404, str(e))
    return [
        ReplacementCandidateOut(
            person_id=person.id,
            person_name=person.full_name,
            role_name=person.role.name if person.role else None,
            soft_warnings=[v.message for v in result.soft_violations],
        )
        for person, result in candidates
    ]


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
        .filter(Person.company_id == user.company_id, Person.is_active.is_(True))
        .all()
    )
    events = (
        db.query(WorkloadEvent)
        .filter(WorkloadEvent.company_id == user.company_id)
        .all()
    )
    mission_types = {
        mt.id: mt.name
        for mt in db.query(MissionType).filter(MissionType.company_id == user.company_id)
    }
    by_person = {p.id: {"total": 0.0, "by_type": {}} for p in people}
    for e in events:
        if e.person_id not in by_person:
            by_person[e.person_id] = {"total": 0.0, "by_type": {}}
        by_person[e.person_id]["total"] += e.delta
        name = mission_types.get(e.mission_type_id, "אחר")
        by_person[e.person_id]["by_type"][name] = (
            by_person[e.person_id]["by_type"].get(name, 0.0) + e.delta
        )
    name_by_id = {p.id: p.full_name for p in people}
    rows = [
        WorkloadPersonOut(
            person_id=pid,
            person_name=name_by_id.get(pid, f"#{pid}"),
            total=data["total"],
            by_mission_type=data["by_type"],
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
