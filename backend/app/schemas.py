from datetime import date, datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.models import (
    ConstraintSeverity,
    ConstraintType,
    KanimRuleKind,
    LeaveType,
    RecurrenceKind,
    ScheduleStatus,
    UserRole,
)


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# Auth
class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    full_name: str = Field(min_length=1, max_length=200)
    company_name: str = Field(min_length=1, max_length=200)


class UserOut(ORMModel):
    id: int
    email: EmailStr
    full_name: str
    role: UserRole
    company_id: int
    is_active: bool
    company_name: Optional[str] = None


# Roles
class RoleCapabilityIn(BaseModel):
    can_fulfill_role_id: int


class RoleCreate(BaseModel):
    name: str
    description: Optional[str] = None
    can_fulfill_role_ids: List[int] = Field(default_factory=list)


class RoleUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None
    can_fulfill_role_ids: Optional[List[int]] = None


class RoleOut(ORMModel):
    id: int
    company_id: int
    name: str
    description: Optional[str]
    is_active: bool
    can_fulfill_role_ids: List[int] = Field(default_factory=list)


# Qualifications
class QualificationCreate(BaseModel):
    name: str
    description: Optional[str] = None


class QualificationUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None


class QualificationOut(ORMModel):
    id: int
    company_id: int
    name: str
    description: Optional[str]
    is_active: bool


# People
class PersonCreate(BaseModel):
    full_name: str
    role_id: int
    rank: Optional[str] = None
    notes: Optional[str] = None
    qualification_ids: List[int] = Field(default_factory=list)
    allowed_mission_type_ids: List[int] = Field(default_factory=list)


class PersonUpdate(BaseModel):
    full_name: Optional[str] = None
    role_id: Optional[int] = None
    rank: Optional[str] = None
    notes: Optional[str] = None
    is_active: Optional[bool] = None
    qualification_ids: Optional[List[int]] = None
    allowed_mission_type_ids: Optional[List[int]] = None


class PersonOut(ORMModel):
    id: int
    company_id: int
    full_name: str
    role_id: int
    rank: Optional[str]
    notes: Optional[str]
    is_active: bool
    qualification_ids: List[int] = Field(default_factory=list)
    allowed_mission_type_ids: List[int] = Field(default_factory=list)
    role_name: Optional[str] = None
    after_count_30d: int = 0
    last_after_end: Optional[datetime] = None


# Mission types
class MissionTypeRequirementIn(BaseModel):
    role_id: Optional[int] = None
    qualification_id: Optional[int] = None
    count: int = 1


class MissionTypeWindowIn(BaseModel):
    start_minute: int
    end_minute: int
    sort_order: int = 0


class MissionTypeBandRequirementIn(BaseModel):
    role_id: Optional[int] = None
    qualification_id: Optional[int] = None
    count: int = 1


class MissionTypeStaffingBandIn(BaseModel):
    label: Optional[str] = None
    start_minute: int
    end_minute: int
    personnel_count: int = 1
    sort_order: int = 0
    requirements: List[MissionTypeBandRequirementIn] = Field(default_factory=list)


class MissionTypeCreate(BaseModel):
    name: str
    description: Optional[str] = None
    default_duration_hours: float = 8.0
    difficulty_weight: float = 1.0
    default_personnel_count: int = 1
    is_recurring_template: bool = False
    recurring_start_hour: Optional[int] = None
    recurring_end_hour: Optional[int] = None
    required_sleep_hours_before_after: float = 0.0
    routine_remainder_policy: str = "include_short"
    default_requirements: List[MissionTypeRequirementIn] = Field(default_factory=list)
    time_windows: List[MissionTypeWindowIn] = Field(default_factory=list)
    staffing_bands: List[MissionTypeStaffingBandIn] = Field(default_factory=list)


class MissionTypeUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    default_duration_hours: Optional[float] = None
    difficulty_weight: Optional[float] = None
    default_personnel_count: Optional[int] = None
    is_active: Optional[bool] = None
    is_recurring_template: Optional[bool] = None
    recurring_start_hour: Optional[int] = None
    recurring_end_hour: Optional[int] = None
    required_sleep_hours_before_after: Optional[float] = None
    routine_remainder_policy: Optional[str] = None
    default_requirements: Optional[List[MissionTypeRequirementIn]] = None
    time_windows: Optional[List[MissionTypeWindowIn]] = None
    staffing_bands: Optional[List[MissionTypeStaffingBandIn]] = None


class MissionTypeRequirementOut(ORMModel):
    id: int
    role_id: Optional[int]
    qualification_id: Optional[int]
    count: int


class MissionTypeWindowOut(ORMModel):
    id: int
    start_minute: int
    end_minute: int
    sort_order: int = 0


class MissionTypeBandRequirementOut(ORMModel):
    id: int
    role_id: Optional[int]
    qualification_id: Optional[int]
    count: int


class MissionTypeStaffingBandOut(ORMModel):
    id: int
    label: Optional[str] = None
    start_minute: int
    end_minute: int
    personnel_count: int
    sort_order: int = 0
    requirements: List[MissionTypeBandRequirementOut] = Field(default_factory=list)


class MissionTypeOut(ORMModel):
    id: int
    company_id: int
    name: str
    description: Optional[str]
    default_duration_hours: float
    difficulty_weight: float
    default_personnel_count: int
    is_active: bool
    is_recurring_template: bool
    recurring_start_hour: Optional[int]
    recurring_end_hour: Optional[int]
    required_sleep_hours_before_after: float = 0.0
    routine_remainder_policy: str = "include_short"
    default_requirements: List[MissionTypeRequirementOut] = Field(default_factory=list)
    time_windows: List[MissionTypeWindowOut] = Field(default_factory=list)
    staffing_bands: List[MissionTypeStaffingBandOut] = Field(default_factory=list)


# Leave / restrictions
class LeaveCreate(BaseModel):
    person_id: int
    leave_type: LeaveType = LeaveType.LEAVE
    start_at: datetime
    end_at: datetime
    notes: Optional[str] = None


class LeaveOut(ORMModel):
    id: int
    person_id: int
    leave_type: LeaveType
    start_at: datetime
    end_at: datetime
    notes: Optional[str]


class RestrictionCreate(BaseModel):
    person_id: int
    start_at: datetime
    end_at: datetime
    restriction_type: str
    mission_type_id: Optional[int] = None
    qualification_id: Optional[int] = None
    unavailable: bool = True
    notes: Optional[str] = None


class RestrictionOut(ORMModel):
    id: int
    person_id: int
    start_at: datetime
    end_at: datetime
    restriction_type: str
    mission_type_id: Optional[int]
    qualification_id: Optional[int]
    unavailable: bool
    notes: Optional[str]


class RecurringRestrictionCreate(BaseModel):
    person_id: int
    kind: RecurrenceKind
    interval_days: int = 1
    weekdays: Optional[str] = None  # "0,2,4" Mon=0
    time_start: str = "00:00"
    time_end: str = "23:59"
    anchor_date: Optional[datetime] = None
    active_from: Optional[datetime] = None
    active_until: Optional[datetime] = None
    restriction_type: str
    mission_type_id: Optional[int] = None
    qualification_id: Optional[int] = None
    unavailable: bool = True
    notes: Optional[str] = None


class RecurringRestrictionOut(ORMModel):
    id: int
    person_id: int
    kind: RecurrenceKind
    interval_days: int
    weekdays: Optional[str]
    time_start: str
    time_end: str
    anchor_date: Optional[datetime]
    active_from: Optional[datetime]
    active_until: Optional[datetime]
    restriction_type: str
    mission_type_id: Optional[int]
    qualification_id: Optional[int]
    unavailable: bool
    is_active: bool
    notes: Optional[str]


# Missions
class MissionRequirementIn(BaseModel):
    role_id: Optional[int] = None
    qualification_id: Optional[int] = None
    count: int = 1
    label: Optional[str] = None


class MissionCreate(BaseModel):
    mission_type_id: int
    name: str
    start_at: datetime
    end_at: datetime
    difficulty_weight: Optional[float] = None
    personnel_count: Optional[int] = None
    notes: Optional[str] = None
    is_adhoc: bool = False
    schedule_id: Optional[int] = None
    requirements: List[MissionRequirementIn] = Field(default_factory=list)


class MissionUpdate(BaseModel):
    name: Optional[str] = None
    start_at: Optional[datetime] = None
    end_at: Optional[datetime] = None
    difficulty_weight: Optional[float] = None
    personnel_count: Optional[int] = None
    notes: Optional[str] = None
    is_adhoc: Optional[bool] = None
    requirements: Optional[List[MissionRequirementIn]] = None


class MissionRequirementOut(ORMModel):
    id: int
    role_id: Optional[int]
    qualification_id: Optional[int]
    count: int
    label: Optional[str]


class MissionOut(ORMModel):
    id: int
    company_id: int
    mission_type_id: int
    name: str
    start_at: datetime
    end_at: datetime
    difficulty_weight: float
    personnel_count: int
    notes: Optional[str]
    is_adhoc: bool
    schedule_id: Optional[int]
    requirements: List[MissionRequirementOut] = Field(default_factory=list)
    mission_type_name: Optional[str] = None


# Constraints
class ConstraintCreate(BaseModel):
    name: str
    constraint_type: ConstraintType
    severity: ConstraintSeverity
    value: Optional[float] = None
    weight: float = 1.0
    description: Optional[str] = None


class ConstraintOut(ORMModel):
    id: int
    company_id: int
    name: str
    constraint_type: ConstraintType
    severity: ConstraintSeverity
    value: Optional[float]
    weight: float
    is_active: bool
    description: Optional[str]


# Schedule
class ScheduleCreate(BaseModel):
    window_start: datetime
    window_end: datetime
    instantiate_recurring: bool = True
    notes: Optional[str] = None


class AssignmentOut(ORMModel):
    id: int
    schedule_id: int
    mission_id: int
    person_id: int
    requirement_id: Optional[int]
    is_manual: bool
    override_reason: Optional[str]
    difficulty_at_assignment: float
    person_name: Optional[str] = None
    mission_name: Optional[str] = None


class AssignmentReplace(BaseModel):
    person_id: int
    override_reason: Optional[str] = None


class ReplacementCandidateOut(BaseModel):
    person_id: int
    person_name: str
    role_name: Optional[str] = None
    soft_warnings: List[str] = Field(default_factory=list)


class ScheduleOut(ORMModel):
    id: int
    company_id: int
    window_start: datetime
    window_end: datetime
    status: ScheduleStatus
    created_by_id: Optional[int]
    approved_by_id: Optional[int]
    published_at: Optional[datetime]
    notes: Optional[str]
    share_token: Optional[str] = None
    assignments: List[AssignmentOut] = Field(default_factory=list)
    missions: List[MissionOut] = Field(default_factory=list)


class ViolationOut(BaseModel):
    severity: str
    code: str
    message: str
    mission_id: Optional[int] = None
    person_id: Optional[int] = None
    details: Optional[dict] = None


class ConflictOut(BaseModel):
    mission_id: int
    mission_name: str
    message: str
    missing_role_id: Optional[int] = None
    missing_qualification_id: Optional[int] = None
    suggested_person_ids: List[int] = Field(default_factory=list)


class SchedulingResultOut(BaseModel):
    status: str  # success | success_with_warnings | infeasible
    schedule: ScheduleOut
    warnings: List[ViolationOut] = Field(default_factory=list)
    conflicts: List[ConflictOut] = Field(default_factory=list)
    explanations: List[str] = Field(default_factory=list)


class WorkloadPersonOut(BaseModel):
    person_id: int
    person_name: str
    total: float
    by_mission_type: dict


class WorkloadDashboardOut(BaseModel):
    people: List[WorkloadPersonOut]
    snapshot_at: Optional[datetime] = None


class HistoryPersonHoursOut(BaseModel):
    person_id: int
    person_name: str
    total_hours: float
    by_mission_type: dict  # name -> hours


class HistorySummaryOut(BaseModel):
    people: List[HistoryPersonHoursOut]
    mission_types: List[str] = Field(default_factory=list)
    from_at: Optional[datetime] = None
    to_at: Optional[datetime] = None
    published_schedules: int = 0


# Kanim (minimum outpost staffing) + After
class KanimRuleCreate(BaseModel):
    kind: KanimRuleKind
    min_count: int = Field(ge=0)
    specific_date: Optional[date] = None
    notes: Optional[str] = None


class KanimRuleUpdate(BaseModel):
    kind: Optional[KanimRuleKind] = None
    min_count: Optional[int] = Field(default=None, ge=0)
    specific_date: Optional[date] = None
    notes: Optional[str] = None


class KanimRuleOut(ORMModel):
    id: int
    company_id: int
    kind: KanimRuleKind
    min_count: int
    specific_date: Optional[date]
    notes: Optional[str]


class AfterDraftItemIn(BaseModel):
    person_id: int
    start_at: datetime
    end_at: datetime


class AfterDraftSaveIn(BaseModel):
    items: List[AfterDraftItemIn] = Field(default_factory=list)


class AfterDraftOut(ORMModel):
    id: int
    schedule_id: int
    person_id: int
    start_at: datetime
    end_at: datetime
    person_name: Optional[str] = None


class AfterCandidateOut(BaseModel):
    person_id: int
    person_name: str
    after_count_30d: int
    sleep_warning: bool = False
    sleep_warning_message: Optional[str] = None
    recommended_rank: int = 0


class AfterPreviewOut(BaseModel):
    total_active: int
    min_kanim: int
    after_quota: int
    candidates: List[AfterCandidateOut] = Field(default_factory=list)
    drafts: List[AfterDraftOut] = Field(default_factory=list)


class AfterGrantOut(ORMModel):
    id: int
    person_id: int
    start_at: datetime
    end_at: datetime
    granted_at: datetime
    person_name: Optional[str] = None
