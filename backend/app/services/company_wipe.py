"""Company-scoped destructive wipe helpers (FK-safe delete order)."""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.models import (
    AfterDraft,
    AfterGrant,
    Assignment,
    AuditLog,
    KanimRule,
    LeavePeriod,
    Mission,
    MissionRequirement,
    MissionType,
    MissionTypeBandRequirement,
    MissionTypeRequirement,
    MissionTypeStaffingBand,
    MissionTypeWindow,
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
    ScheduleVersion,
    SchedulingConstraint,
    SchedulingRule,
    SchedulingRuleBlockedType,
    SchedulingRuleQualification,
    SchedulingRuleRole,
    SchedulingRuleSourceType,
    WorkloadEvent,
    WorkloadSnapshot,
    WorkloadSnapshotEntry,
)


@dataclass
class WipeResult:
    operational: bool
    catalog: bool
    people: bool
    deleted: dict


def _scalar_ids(rows) -> list[int]:
    return [r[0] for r in rows]


def wipe_operational(db: Session, company_id: int) -> dict:
    """Plans, schedules, missions, assignments, workload, after, leave/restrictions."""
    schedule_ids = _scalar_ids(
        db.query(Schedule.id).filter(Schedule.company_id == company_id).all()
    )
    plan_ids = _scalar_ids(
        db.query(SchedulePlan.id).filter(SchedulePlan.company_id == company_id).all()
    )
    mission_ids = _scalar_ids(
        db.query(Mission.id).filter(Mission.company_id == company_id).all()
    )
    person_ids = _scalar_ids(
        db.query(Person.id).filter(Person.company_id == company_id).all()
    )
    snapshot_ids = _scalar_ids(
        db.query(WorkloadSnapshot.id)
        .filter(WorkloadSnapshot.company_id == company_id)
        .all()
    )
    rule_ids = _scalar_ids(
        db.query(SchedulingRule.id)
        .filter(SchedulingRule.company_id == company_id)
        .all()
    )

    counts: dict = {}

    # Workload events/snapshots reference schedules, assignments, missions — delete first.
    if snapshot_ids:
        counts["workload_snapshot_entries"] = (
            db.query(WorkloadSnapshotEntry)
            .filter(WorkloadSnapshotEntry.snapshot_id.in_(snapshot_ids))
            .delete(synchronize_session=False)
        )
        counts["workload_snapshots"] = (
            db.query(WorkloadSnapshot)
            .filter(WorkloadSnapshot.id.in_(snapshot_ids))
            .delete(synchronize_session=False)
        )
    else:
        counts["workload_snapshot_entries"] = 0
        counts["workload_snapshots"] = 0

    counts["workload_events"] = (
        db.query(WorkloadEvent)
        .filter(WorkloadEvent.company_id == company_id)
        .delete(synchronize_session=False)
    )

    if schedule_ids:
        counts["after_drafts"] = (
            db.query(AfterDraft)
            .filter(AfterDraft.schedule_id.in_(schedule_ids))
            .delete(synchronize_session=False)
        )
    else:
        counts["after_drafts"] = 0

    counts["after_grants"] = (
        db.query(AfterGrant)
        .filter(AfterGrant.company_id == company_id)
        .delete(synchronize_session=False)
    )

    if schedule_ids:
        counts["assignments"] = (
            db.query(Assignment)
            .filter(Assignment.schedule_id.in_(schedule_ids))
            .delete(synchronize_session=False)
        )
    else:
        counts["assignments"] = 0

    if mission_ids:
        # Clear FK from any leftover assignments (should already be gone).
        db.query(Assignment).filter(Assignment.mission_id.in_(mission_ids)).delete(
            synchronize_session=False
        )
        counts["mission_requirements"] = (
            db.query(MissionRequirement)
            .filter(MissionRequirement.mission_id.in_(mission_ids))
            .delete(synchronize_session=False)
        )
        counts["missions"] = (
            db.query(Mission)
            .filter(Mission.id.in_(mission_ids))
            .delete(synchronize_session=False)
        )
    else:
        counts["mission_requirements"] = 0
        counts["missions"] = 0

    if schedule_ids:
        counts["schedule_versions"] = (
            db.query(ScheduleVersion)
            .filter(ScheduleVersion.schedule_id.in_(schedule_ids))
            .delete(synchronize_session=False)
        )
        counts["schedules"] = (
            db.query(Schedule)
            .filter(Schedule.id.in_(schedule_ids))
            .delete(synchronize_session=False)
        )
    else:
        counts["schedule_versions"] = 0
        counts["schedules"] = 0

    if plan_ids:
        counts["schedule_plans"] = (
            db.query(SchedulePlan)
            .filter(SchedulePlan.id.in_(plan_ids))
            .delete(synchronize_session=False)
        )
    else:
        counts["schedule_plans"] = 0

    if person_ids:
        counts["leave_periods"] = (
            db.query(LeavePeriod)
            .filter(LeavePeriod.person_id.in_(person_ids))
            .delete(synchronize_session=False)
        )
        counts["restrictions"] = (
            db.query(Restriction)
            .filter(Restriction.person_id.in_(person_ids))
            .delete(synchronize_session=False)
        )
        counts["recurring_restrictions"] = (
            db.query(RecurringRestriction)
            .filter(RecurringRestriction.person_id.in_(person_ids))
            .delete(synchronize_session=False)
        )
    else:
        counts["leave_periods"] = 0
        counts["restrictions"] = 0
        counts["recurring_restrictions"] = 0

    counts["audit_logs"] = (
        db.query(AuditLog)
        .filter(AuditLog.company_id == company_id)
        .delete(synchronize_session=False)
    )

    _ = rule_ids
    return counts


def wipe_catalog(db: Session, company_id: int, *, delete_roles: bool) -> dict:
    """Mission types, rules, kanim, qualifications; roles only if delete_roles."""
    mt_ids = _scalar_ids(
        db.query(MissionType.id).filter(MissionType.company_id == company_id).all()
    )
    rule_ids = _scalar_ids(
        db.query(SchedulingRule.id)
        .filter(SchedulingRule.company_id == company_id)
        .all()
    )
    band_ids = _scalar_ids(
        db.query(MissionTypeStaffingBand.id)
        .filter(MissionTypeStaffingBand.mission_type_id.in_(mt_ids))
        .all()
    ) if mt_ids else []
    role_ids = _scalar_ids(
        db.query(Role.id).filter(Role.company_id == company_id).all()
    )
    qual_ids = _scalar_ids(
        db.query(Qualification.id)
        .filter(Qualification.company_id == company_id)
        .all()
    )

    counts: dict = {}

    if rule_ids:
        counts["scheduling_rule_source_types"] = (
            db.query(SchedulingRuleSourceType)
            .filter(SchedulingRuleSourceType.rule_id.in_(rule_ids))
            .delete(synchronize_session=False)
        )
        counts["scheduling_rule_blocked_types"] = (
            db.query(SchedulingRuleBlockedType)
            .filter(SchedulingRuleBlockedType.rule_id.in_(rule_ids))
            .delete(synchronize_session=False)
        )
        counts["scheduling_rule_roles"] = (
            db.query(SchedulingRuleRole)
            .filter(SchedulingRuleRole.rule_id.in_(rule_ids))
            .delete(synchronize_session=False)
        )
        counts["scheduling_rule_qualifications"] = (
            db.query(SchedulingRuleQualification)
            .filter(SchedulingRuleQualification.rule_id.in_(rule_ids))
            .delete(synchronize_session=False)
        )
        counts["scheduling_rules"] = (
            db.query(SchedulingRule)
            .filter(SchedulingRule.id.in_(rule_ids))
            .delete(synchronize_session=False)
        )
    else:
        counts["scheduling_rule_source_types"] = 0
        counts["scheduling_rule_blocked_types"] = 0
        counts["scheduling_rule_roles"] = 0
        counts["scheduling_rule_qualifications"] = 0
        counts["scheduling_rules"] = 0

    counts["scheduling_constraints"] = (
        db.query(SchedulingConstraint)
        .filter(SchedulingConstraint.company_id == company_id)
        .delete(synchronize_session=False)
    )
    counts["kanim_rules"] = (
        db.query(KanimRule)
        .filter(KanimRule.company_id == company_id)
        .delete(synchronize_session=False)
    )

    # Detach people from mission types / qualifications before deleting catalog rows.
    if mt_ids:
        counts["person_allowed_mission_types"] = (
            db.query(PersonAllowedMissionType)
            .filter(PersonAllowedMissionType.mission_type_id.in_(mt_ids))
            .delete(synchronize_session=False)
        )
    else:
        counts["person_allowed_mission_types"] = 0

    if qual_ids:
        counts["person_qualifications"] = (
            db.query(PersonQualification)
            .filter(PersonQualification.qualification_id.in_(qual_ids))
            .delete(synchronize_session=False)
        )
    else:
        counts["person_qualifications"] = 0

    if band_ids:
        counts["mission_type_band_requirements"] = (
            db.query(MissionTypeBandRequirement)
            .filter(MissionTypeBandRequirement.band_id.in_(band_ids))
            .delete(synchronize_session=False)
        )
        counts["mission_type_staffing_bands"] = (
            db.query(MissionTypeStaffingBand)
            .filter(MissionTypeStaffingBand.id.in_(band_ids))
            .delete(synchronize_session=False)
        )
    else:
        counts["mission_type_band_requirements"] = 0
        counts["mission_type_staffing_bands"] = 0

    if mt_ids:
        counts["mission_type_windows"] = (
            db.query(MissionTypeWindow)
            .filter(MissionTypeWindow.mission_type_id.in_(mt_ids))
            .delete(synchronize_session=False)
        )
        counts["mission_type_requirements"] = (
            db.query(MissionTypeRequirement)
            .filter(MissionTypeRequirement.mission_type_id.in_(mt_ids))
            .delete(synchronize_session=False)
        )
        counts["mission_types"] = (
            db.query(MissionType)
            .filter(MissionType.id.in_(mt_ids))
            .delete(synchronize_session=False)
        )
    else:
        counts["mission_type_windows"] = 0
        counts["mission_type_requirements"] = 0
        counts["mission_types"] = 0

    if qual_ids:
        counts["qualifications"] = (
            db.query(Qualification)
            .filter(Qualification.id.in_(qual_ids))
            .delete(synchronize_session=False)
        )
    else:
        counts["qualifications"] = 0

    if delete_roles and role_ids:
        counts["role_capabilities"] = (
            db.query(RoleCapability)
            .filter(
                (RoleCapability.role_id.in_(role_ids))
                | (RoleCapability.can_fulfill_role_id.in_(role_ids))
            )
            .delete(synchronize_session=False)
        )
        counts["roles"] = (
            db.query(Role)
            .filter(Role.id.in_(role_ids))
            .delete(synchronize_session=False)
        )
    else:
        counts["role_capabilities"] = 0
        counts["roles"] = 0

    return counts


def wipe_people(db: Session, company_id: int) -> dict:
    """Hard-delete all people and person-owned rows. Does not delete system users."""
    person_ids = _scalar_ids(
        db.query(Person.id).filter(Person.company_id == company_id).all()
    )
    counts: dict = {"people": 0}
    if not person_ids:
        return counts

    # Person-linked operational leftovers (if operational wipe was not selected).
    db.query(WorkloadEvent).filter(WorkloadEvent.person_id.in_(person_ids)).delete(
        synchronize_session=False
    )
    db.query(WorkloadSnapshotEntry).filter(
        WorkloadSnapshotEntry.person_id.in_(person_ids)
    ).delete(synchronize_session=False)
    db.query(AfterDraft).filter(AfterDraft.person_id.in_(person_ids)).delete(
        synchronize_session=False
    )
    db.query(AfterGrant).filter(AfterGrant.person_id.in_(person_ids)).delete(
        synchronize_session=False
    )
    db.query(Assignment).filter(Assignment.person_id.in_(person_ids)).delete(
        synchronize_session=False
    )
    db.query(PersonQualification).filter(
        PersonQualification.person_id.in_(person_ids)
    ).delete(synchronize_session=False)
    db.query(PersonAllowedMissionType).filter(
        PersonAllowedMissionType.person_id.in_(person_ids)
    ).delete(synchronize_session=False)
    db.query(LeavePeriod).filter(LeavePeriod.person_id.in_(person_ids)).delete(
        synchronize_session=False
    )
    db.query(Restriction).filter(Restriction.person_id.in_(person_ids)).delete(
        synchronize_session=False
    )
    db.query(RecurringRestriction).filter(
        RecurringRestriction.person_id.in_(person_ids)
    ).delete(synchronize_session=False)

    counts["people"] = (
        db.query(Person)
        .filter(Person.id.in_(person_ids))
        .delete(synchronize_session=False)
    )
    return counts


def wipe_company_data(
    db: Session,
    company_id: int,
    *,
    operational: bool,
    catalog: bool,
    people: bool,
) -> WipeResult:
    deleted: dict = {}

    # Catalog rows FK into missions → wipe operational first when catalog is selected.
    if operational or catalog:
        deleted["operational"] = wipe_operational(db, company_id)

    if people:
        deleted["people"] = wipe_people(db, company_id)

    if catalog:
        deleted["catalog"] = wipe_catalog(
            db, company_id, delete_roles=people
        )

    return WipeResult(
        operational=operational or catalog,
        catalog=catalog,
        people=people,
        deleted=deleted,
    )
