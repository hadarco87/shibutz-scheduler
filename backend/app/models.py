from __future__ import annotations

import enum
from datetime import date, datetime
from typing import List, Optional

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class UserRole(str, enum.Enum):
    COMMANDER = "commander"
    VIEWER = "viewer"


class ScheduleStatus(str, enum.Enum):
    DRAFT = "draft"
    PUBLISHED = "published"


class LeaveType(str, enum.Enum):
    LEAVE = "leave"
    HOME_LEAVE = "home_leave"
    TEMPORARY_ABSENCE = "temporary_absence"
    MEDICAL = "medical"
    OTHER = "other"


class RecurrenceKind(str, enum.Enum):
    DAILY = "daily"
    EVERY_N_DAYS = "every_n_days"
    WEEKLY = "weekly"


class KanimRuleKind(str, enum.Enum):
    """Minimum weapon-posts (קנים) staffing floor at the outpost."""

    WEEKDAY = "weekday"  # Sunday–Thursday
    WEEKEND = "weekend"  # Friday–Saturday
    SPECIFIC_DATE = "specific_date"


class RoutineRemainderPolicy(str, enum.Enum):
    """When shift duration does not divide 24 hours evenly."""

    INCLUDE_SHORT = "include_short"  # e.g. 10+10+4
    FULL_ONLY = "full_only"  # e.g. 10+10, leave a gap


class ConstraintSeverity(str, enum.Enum):
    HARD = "hard"
    SOFT = "soft"


class ConstraintType(str, enum.Enum):
    MINIMUM_REST = "minimum_rest"
    NO_OVERLAP = "no_overlap"
    AVAILABILITY = "availability"
    ROLE_COMPATIBILITY = "role_compatibility"
    QUALIFICATION = "qualification"
    AVOID_CONSECUTIVE_NIGHT = "avoid_consecutive_night"
    WORKLOAD_FAIRNESS = "workload_fairness"
    AVOID_REPEAT_MISSION = "avoid_repeat_mission"


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )


class Company(Base, TimestampMixin):
    __tablename__ = "companies"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    users: Mapped[List["User"]] = relationship(back_populates="company")
    people: Mapped[List["Person"]] = relationship(back_populates="company")
    roles: Mapped[List["Role"]] = relationship(back_populates="company")
    qualifications: Mapped[List["Qualification"]] = relationship(back_populates="company")
    mission_types: Mapped[List["MissionType"]] = relationship(back_populates="company")
    missions: Mapped[List["Mission"]] = relationship(back_populates="company")
    schedules: Mapped[List["Schedule"]] = relationship(back_populates="company")
    constraints: Mapped[List["SchedulingConstraint"]] = relationship(back_populates="company")


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), nullable=False)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    full_name: Mapped[str] = mapped_column(String(200), nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[UserRole] = mapped_column(Enum(UserRole), default=UserRole.COMMANDER)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    company: Mapped["Company"] = relationship(back_populates="users")


class CompanyInvite(Base, TimestampMixin):
    """Pending invitation to join an existing company with full permissions."""

    __tablename__ = "company_invites"
    __table_args__ = (
        UniqueConstraint("company_id", "email", name="uq_company_invite_email"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), nullable=False)
    email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    token: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    invited_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    accepted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    revoked_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    company: Mapped["Company"] = relationship()
    invited_by: Mapped["User"] = relationship(foreign_keys=[invited_by_id])


class Role(Base, TimestampMixin):
    __tablename__ = "roles"
    __table_args__ = (UniqueConstraint("company_id", "name", name="uq_role_company_name"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    company: Mapped["Company"] = relationship(back_populates="roles")
    can_fulfill: Mapped[List["RoleCapability"]] = relationship(
        back_populates="role",
        foreign_keys="RoleCapability.role_id",
        cascade="all, delete-orphan",
    )


class RoleCapability(Base):
    __tablename__ = "role_capabilities"
    __table_args__ = (
        UniqueConstraint("role_id", "can_fulfill_role_id", name="uq_role_capability"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    role_id: Mapped[int] = mapped_column(ForeignKey("roles.id"), nullable=False)
    can_fulfill_role_id: Mapped[int] = mapped_column(ForeignKey("roles.id"), nullable=False)

    role: Mapped["Role"] = relationship(
        back_populates="can_fulfill", foreign_keys=[role_id]
    )
    can_fulfill_role: Mapped["Role"] = relationship(foreign_keys=[can_fulfill_role_id])


class Qualification(Base, TimestampMixin):
    __tablename__ = "qualifications"
    __table_args__ = (
        UniqueConstraint("company_id", "name", name="uq_qualification_company_name"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    company: Mapped["Company"] = relationship(back_populates="qualifications")


class Person(Base, TimestampMixin):
    __tablename__ = "people"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), nullable=False)
    full_name: Mapped[str] = mapped_column(String(200), nullable=False)
    role_id: Mapped[int] = mapped_column(ForeignKey("roles.id"), nullable=False)
    rank: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    personal_number: Mapped[Optional[str]] = mapped_column(
        String(64), nullable=True, index=True
    )
    phone: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    company: Mapped["Company"] = relationship(back_populates="people")
    role: Mapped["Role"] = relationship()
    qualifications: Mapped[List["PersonQualification"]] = relationship(
        back_populates="person", cascade="all, delete-orphan"
    )
    leave_periods: Mapped[List["LeavePeriod"]] = relationship(
        back_populates="person", cascade="all, delete-orphan"
    )
    restrictions: Mapped[List["Restriction"]] = relationship(
        back_populates="person", cascade="all, delete-orphan"
    )
    recurring_restrictions: Mapped[List["RecurringRestriction"]] = relationship(
        back_populates="person", cascade="all, delete-orphan"
    )
    allowed_mission_types: Mapped[List["PersonAllowedMissionType"]] = relationship(
        back_populates="person", cascade="all, delete-orphan"
    )


class PersonQualification(Base):
    __tablename__ = "person_qualifications"
    __table_args__ = (
        UniqueConstraint("person_id", "qualification_id", name="uq_person_qualification"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    person_id: Mapped[int] = mapped_column(ForeignKey("people.id"), nullable=False)
    qualification_id: Mapped[int] = mapped_column(
        ForeignKey("qualifications.id"), nullable=False
    )

    person: Mapped["Person"] = relationship(back_populates="qualifications")
    qualification: Mapped["Qualification"] = relationship()


class PersonAllowedMissionType(Base):
    """Whitelist of mission types a person may perform.

    Empty list for a person means all mission types are allowed.
    Non-empty list means ONLY those mission types are allowed.
    """

    __tablename__ = "person_allowed_mission_types"
    __table_args__ = (
        UniqueConstraint(
            "person_id", "mission_type_id", name="uq_person_allowed_mission_type"
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    person_id: Mapped[int] = mapped_column(ForeignKey("people.id"), nullable=False)
    mission_type_id: Mapped[int] = mapped_column(
        ForeignKey("mission_types.id"), nullable=False
    )

    person: Mapped["Person"] = relationship(back_populates="allowed_mission_types")
    mission_type: Mapped["MissionType"] = relationship()


class MissionType(Base, TimestampMixin):
    __tablename__ = "mission_types"
    __table_args__ = (
        UniqueConstraint("company_id", "name", name="uq_mission_type_company_name"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    default_duration_hours: Mapped[float] = mapped_column(Float, default=8.0)
    difficulty_weight: Mapped[float] = mapped_column(Float, default=1.0)
    default_personnel_count: Mapped[int] = mapped_column(Integer, default=1)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_recurring_template: Mapped[bool] = mapped_column(Boolean, default=False)
    recurring_start_hour: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    recurring_end_hour: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    # Hours of sleep required after this mission before recommending after/home leave
    required_sleep_hours_before_after: Mapped[float] = mapped_column(Float, default=0.0)
    routine_remainder_policy: Mapped[str] = mapped_column(
        String(32), default=RoutineRemainderPolicy.INCLUDE_SHORT.value
    )

    company: Mapped["Company"] = relationship(back_populates="mission_types")
    default_requirements: Mapped[List["MissionTypeRequirement"]] = relationship(
        back_populates="mission_type", cascade="all, delete-orphan"
    )
    time_windows: Mapped[List["MissionTypeWindow"]] = relationship(
        back_populates="mission_type",
        cascade="all, delete-orphan",
        order_by="MissionTypeWindow.sort_order",
    )
    staffing_bands: Mapped[List["MissionTypeStaffingBand"]] = relationship(
        back_populates="mission_type",
        cascade="all, delete-orphan",
        order_by="MissionTypeStaffingBand.sort_order",
    )


class MissionTypeRequirement(Base):
    __tablename__ = "mission_type_requirements"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    mission_type_id: Mapped[int] = mapped_column(
        ForeignKey("mission_types.id"), nullable=False
    )
    role_id: Mapped[Optional[int]] = mapped_column(ForeignKey("roles.id"), nullable=True)
    qualification_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("qualifications.id"), nullable=True
    )
    count: Mapped[int] = mapped_column(Integer, default=1)

    mission_type: Mapped["MissionType"] = relationship(back_populates="default_requirements")
    role: Mapped[Optional["Role"]] = relationship()
    qualification: Mapped[Optional["Qualification"]] = relationship()


class MissionTypeWindow(Base):
    """Clock-time window for non-routine mission types (may cross midnight)."""

    __tablename__ = "mission_type_windows"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    mission_type_id: Mapped[int] = mapped_column(
        ForeignKey("mission_types.id"), nullable=False, index=True
    )
    start_minute: Mapped[int] = mapped_column(Integer, nullable=False)  # 0–1439
    end_minute: Mapped[int] = mapped_column(Integer, nullable=False)  # 0–1439
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    mission_type: Mapped["MissionType"] = relationship(back_populates="time_windows")


class MissionTypeStaffingBand(Base):
    """Routine staffing that varies by clock window (e.g. day 1 / night 2)."""

    __tablename__ = "mission_type_staffing_bands"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    mission_type_id: Mapped[int] = mapped_column(
        ForeignKey("mission_types.id"), nullable=False, index=True
    )
    label: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    start_minute: Mapped[int] = mapped_column(Integer, nullable=False)
    end_minute: Mapped[int] = mapped_column(Integer, nullable=False)
    personnel_count: Mapped[int] = mapped_column(Integer, default=1)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    mission_type: Mapped["MissionType"] = relationship(back_populates="staffing_bands")
    requirements: Mapped[List["MissionTypeBandRequirement"]] = relationship(
        back_populates="band", cascade="all, delete-orphan"
    )


class MissionTypeBandRequirement(Base):
    __tablename__ = "mission_type_band_requirements"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    band_id: Mapped[int] = mapped_column(
        ForeignKey("mission_type_staffing_bands.id"), nullable=False, index=True
    )
    role_id: Mapped[Optional[int]] = mapped_column(ForeignKey("roles.id"), nullable=True)
    qualification_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("qualifications.id"), nullable=True
    )
    count: Mapped[int] = mapped_column(Integer, default=1)

    band: Mapped["MissionTypeStaffingBand"] = relationship(back_populates="requirements")
    role: Mapped[Optional["Role"]] = relationship()
    qualification: Mapped[Optional["Qualification"]] = relationship()


class Mission(Base, TimestampMixin):
    __tablename__ = "missions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), nullable=False)
    mission_type_id: Mapped[int] = mapped_column(
        ForeignKey("mission_types.id"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    start_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    end_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    difficulty_weight: Mapped[float] = mapped_column(Float, nullable=False)
    personnel_count: Mapped[int] = mapped_column(Integer, nullable=False)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_adhoc: Mapped[bool] = mapped_column(Boolean, default=False)
    schedule_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("schedules.id"), nullable=True
    )

    company: Mapped["Company"] = relationship(back_populates="missions")
    mission_type: Mapped["MissionType"] = relationship()
    requirements: Mapped[List["MissionRequirement"]] = relationship(
        back_populates="mission", cascade="all, delete-orphan"
    )
    schedule: Mapped[Optional["Schedule"]] = relationship(back_populates="missions")


class MissionRequirement(Base):
    __tablename__ = "mission_requirements"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    mission_id: Mapped[int] = mapped_column(ForeignKey("missions.id"), nullable=False)
    role_id: Mapped[Optional[int]] = mapped_column(ForeignKey("roles.id"), nullable=True)
    qualification_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("qualifications.id"), nullable=True
    )
    count: Mapped[int] = mapped_column(Integer, default=1)
    label: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)

    mission: Mapped["Mission"] = relationship(back_populates="requirements")
    role: Mapped[Optional["Role"]] = relationship()
    qualification: Mapped[Optional["Qualification"]] = relationship()


class LeavePeriod(Base, TimestampMixin):
    __tablename__ = "leave_periods"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    person_id: Mapped[int] = mapped_column(ForeignKey("people.id"), nullable=False)
    leave_type: Mapped[LeaveType] = mapped_column(Enum(LeaveType), default=LeaveType.LEAVE)
    start_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    end_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    person: Mapped["Person"] = relationship(back_populates="leave_periods")


class Restriction(Base, TimestampMixin):
    __tablename__ = "restrictions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    person_id: Mapped[int] = mapped_column(ForeignKey("people.id"), nullable=False)
    start_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    end_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    restriction_type: Mapped[str] = mapped_column(String(100), nullable=False)
    mission_type_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("mission_types.id"), nullable=True
    )
    qualification_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("qualifications.id"), nullable=True
    )
    unavailable: Mapped[bool] = mapped_column(Boolean, default=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    person: Mapped["Person"] = relationship(back_populates="restrictions")
    mission_type: Mapped[Optional["MissionType"]] = relationship()
    qualification: Mapped[Optional["Qualification"]] = relationship()


class RecurringRestriction(Base, TimestampMixin):
    """Recurring unavailability windows, e.g. every 2 days / weekly / daily hours."""

    __tablename__ = "recurring_restrictions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    person_id: Mapped[int] = mapped_column(ForeignKey("people.id"), nullable=False)
    kind: Mapped[RecurrenceKind] = mapped_column(Enum(RecurrenceKind), nullable=False)
    interval_days: Mapped[int] = mapped_column(Integer, default=1)
    # Comma-separated Python weekdays: 0=Mon ... 6=Sun
    weekdays: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    time_start: Mapped[str] = mapped_column(String(5), default="00:00")  # HH:MM
    time_end: Mapped[str] = mapped_column(String(5), default="23:59")
    anchor_date: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    active_from: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    active_until: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    restriction_type: Mapped[str] = mapped_column(String(100), nullable=False)
    mission_type_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("mission_types.id"), nullable=True
    )
    qualification_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("qualifications.id"), nullable=True
    )
    unavailable: Mapped[bool] = mapped_column(Boolean, default=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    person: Mapped["Person"] = relationship(back_populates="recurring_restrictions")
    mission_type: Mapped[Optional["MissionType"]] = relationship()
    qualification: Mapped[Optional["Qualification"]] = relationship()


class SchedulingConstraint(Base, TimestampMixin):
    __tablename__ = "scheduling_constraints"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    constraint_type: Mapped[ConstraintType] = mapped_column(Enum(ConstraintType))
    severity: Mapped[ConstraintSeverity] = mapped_column(Enum(ConstraintSeverity))
    value: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    weight: Mapped[float] = mapped_column(Float, default=1.0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    company: Mapped["Company"] = relationship(back_populates="constraints")


class Schedule(Base, TimestampMixin):
    __tablename__ = "schedules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), nullable=False)
    window_start: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    window_end: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    status: Mapped[ScheduleStatus] = mapped_column(
        Enum(ScheduleStatus), default=ScheduleStatus.DRAFT
    )
    created_by_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    approved_by_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    published_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    share_token: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)

    company: Mapped["Company"] = relationship(back_populates="schedules")
    missions: Mapped[List["Mission"]] = relationship(back_populates="schedule")
    versions: Mapped[List["ScheduleVersion"]] = relationship(
        back_populates="schedule", cascade="all, delete-orphan"
    )
    assignments: Mapped[List["Assignment"]] = relationship(
        back_populates="schedule", cascade="all, delete-orphan"
    )
    after_drafts: Mapped[List["AfterDraft"]] = relationship(
        back_populates="schedule", cascade="all, delete-orphan"
    )


class ScheduleVersion(Base, TimestampMixin):
    __tablename__ = "schedule_versions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    schedule_id: Mapped[int] = mapped_column(ForeignKey("schedules.id"), nullable=False)
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    snapshot_json: Mapped[str] = mapped_column(Text, nullable=False)
    change_summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)

    schedule: Mapped["Schedule"] = relationship(back_populates="versions")


class Assignment(Base, TimestampMixin):
    __tablename__ = "assignments"
    __table_args__ = (
        UniqueConstraint("schedule_id", "mission_id", "person_id", name="uq_assignment"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    schedule_id: Mapped[int] = mapped_column(ForeignKey("schedules.id"), nullable=False)
    mission_id: Mapped[int] = mapped_column(ForeignKey("missions.id"), nullable=False)
    person_id: Mapped[int] = mapped_column(ForeignKey("people.id"), nullable=False)
    requirement_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("mission_requirements.id"), nullable=True
    )
    is_manual: Mapped[bool] = mapped_column(Boolean, default=False)
    override_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    difficulty_at_assignment: Mapped[float] = mapped_column(Float, nullable=False)

    schedule: Mapped["Schedule"] = relationship(back_populates="assignments")
    mission: Mapped["Mission"] = relationship()
    person: Mapped["Person"] = relationship()
    requirement: Mapped[Optional["MissionRequirement"]] = relationship()


class WorkloadSnapshot(Base, TimestampMixin):
    __tablename__ = "workload_snapshots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), nullable=False)
    schedule_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("schedules.id"), nullable=True
    )
    taken_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    entries: Mapped[List["WorkloadSnapshotEntry"]] = relationship(
        back_populates="snapshot", cascade="all, delete-orphan"
    )


class WorkloadSnapshotEntry(Base):
    __tablename__ = "workload_snapshot_entries"
    __table_args__ = (
        UniqueConstraint("snapshot_id", "person_id", name="uq_snapshot_person"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    snapshot_id: Mapped[int] = mapped_column(
        ForeignKey("workload_snapshots.id"), nullable=False
    )
    person_id: Mapped[int] = mapped_column(ForeignKey("people.id"), nullable=False)
    total_workload: Mapped[float] = mapped_column(Float, default=0.0)

    snapshot: Mapped["WorkloadSnapshot"] = relationship(back_populates="entries")
    person: Mapped["Person"] = relationship()


class WorkloadEvent(Base, TimestampMixin):
    """Immutable workload delta created ONLY on publish. GENERATE != COMMIT."""

    __tablename__ = "workload_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), nullable=False)
    person_id: Mapped[int] = mapped_column(ForeignKey("people.id"), nullable=False)
    schedule_id: Mapped[int] = mapped_column(ForeignKey("schedules.id"), nullable=False)
    assignment_id: Mapped[int] = mapped_column(ForeignKey("assignments.id"), nullable=False)
    mission_id: Mapped[int] = mapped_column(ForeignKey("missions.id"), nullable=False)
    mission_type_id: Mapped[int] = mapped_column(
        ForeignKey("mission_types.id"), nullable=False
    )
    difficulty_weight: Mapped[float] = mapped_column(Float, nullable=False)
    delta: Mapped[float] = mapped_column(Float, nullable=False)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    company_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("companies.id"), nullable=True
    )
    user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    action: Mapped[str] = mapped_column(String(100), nullable=False)
    entity_type: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    entity_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    details: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class KanimRule(Base, TimestampMixin):
    """Minimum soldiers that must remain at the outpost (קני נשק)."""

    __tablename__ = "kanim_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), nullable=False)
    kind: Mapped[KanimRuleKind] = mapped_column(Enum(KanimRuleKind), nullable=False)
    min_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    specific_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)


class AfterDraft(Base, TimestampMixin):
    """Commander after selections on a draft schedule. Committed only on publish."""

    __tablename__ = "after_drafts"
    __table_args__ = (
        UniqueConstraint("schedule_id", "person_id", name="uq_after_draft_schedule_person"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    schedule_id: Mapped[int] = mapped_column(ForeignKey("schedules.id"), nullable=False)
    person_id: Mapped[int] = mapped_column(ForeignKey("people.id"), nullable=False)
    start_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    end_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)

    schedule: Mapped["Schedule"] = relationship(back_populates="after_drafts")
    person: Mapped["Person"] = relationship()


class AfterGrant(Base, TimestampMixin):
    """Published after privilege — used for fairness over a rolling 30-day window."""

    __tablename__ = "after_grants"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), nullable=False)
    person_id: Mapped[int] = mapped_column(ForeignKey("people.id"), nullable=False, index=True)
    schedule_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("schedules.id"), nullable=True
    )
    start_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    end_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    granted_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    person: Mapped["Person"] = relationship()
