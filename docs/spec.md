# Military Company Scheduling & Workload Management System
## Scope of Work & Product Requirements Specification — V1.0

### 1. Project Overview

The objective is to build a **Hebrew-first web application for automatically scheduling soldiers and commanders into operational duties for the next 24 hours**.

Today, this scheduling process is performed manually by a person appointed by the company commander. A new schedule is generally prepared and published every day around noon, showing every soldier and commander what duties they are assigned to during the following 24 hours.

The application will replace most of this manual process with an intelligent scheduling engine.

The system must consider:

* Personnel availability.
* Military roles and hierarchy.
* Professional qualifications / `פק"ל`.
* Leave and absence periods.
* Temporary restrictions and exemptions.
* Mandatory rest requirements.
* Mission requirements.
* Mission difficulty.
* Hard scheduling constraints.
* Soft scheduling preferences.
* Previous assignments.
* Accumulated workload and fairness.
* Manual commander decisions and overrides.

The central user action will be:

**"שבץ אותי" — Generate Schedule**

The application generates a proposed schedule automatically.

The commander can then inspect it, resolve conflicts, manually modify assignments, regenerate the schedule if necessary, and finally press:

**"מאושר לפרסום" — Approve & Publish**

Only the **approved schedule** becomes historical data and affects future workload calculations.


# 2. Core Product Principles

The system should follow five fundamental principles.

**Safety and operational rules come first.** Hard constraints must never be silently violated.

**The commander remains in control.** The algorithm assists decision-making but does not replace command authority.

**Fairness is historical, not merely daily.** The system should consider accumulated workload from previous approved schedules rather than simply trying to give everyone the same number of duties today.

**The application must be highly configurable.** Different companies, periods and operational environments may have different personnel structures, mission types and constraints.

**The UI must remain extremely simple.** A commander should not need technical knowledge to configure or operate the system.

# 3. Users & Permissions

The primary application user is the **company scheduling officer / authorized commander**.

V1 should support multiple authorized users if necessary, but soldiers themselves do not need editing access.

### Authorized Commander

Can:

* Create/edit personnel.
* Configure roles.
* Configure qualifications.
* Configure mission types.
* Create daily missions.
* Define mission requirements.
* Configure difficulty levels.
* Configure hard constraints.
* Configure soft preferences.
* Enter leave.
* Enter temporary restrictions.
* Generate schedules.
* Resolve conflicts.
* Manually change assignments.
* Approve schedules.
* Publish schedules.
* View historical schedules.
* View workload statistics.

### Soldier / Viewer

For V1, soldiers may either have read-only access or receive the published schedule through a shareable view.

They must not be able to modify scheduling information.

A more sophisticated soldier account system can be added later.


# 4. Personnel Management

The application must maintain a company roster. Each person should have a persistent profile.

Example:
```
Name: Yossi Cohen
Role: Soldier
Qualifications: Medic, Marksman
Status: Available
Leave: 15/09 08:00 → 18/09 08:00
```

The data model should support at minimum: ID, Full Name, Military Role, Rank (optional), Qualifications, Active/Inactive, Availability, Leave periods, Temporary restrictions, Permanent restrictions, Notes.

Roles must be configurable (Soldier, Commander, NCO, Officer, ...). The architecture should NOT hard-code the exact Israeli military role structure.

# 5. Role Hierarchy

Roles may have hierarchical capabilities, e.g. Commander → may perform Commander duties AND Soldier duties; Soldier → CANNOT perform Commander duties.

This hierarchy should be configurable rather than implemented as scattered hard-coded conditions — conceptually a role has a "can fulfill" list of role types. This allows the system to evolve without rewriting the scheduling engine.

# 6. Qualifications / Pakal Management

Personnel may possess one or more operational qualifications (`פק"לים`), e.g. Medic, Grenadier, Marksman, Radio Operator. The commander must be able to create new qualification types.

A mission may require specific qualifications, e.g. Patrol 08:00–16:00 requires 4 personnel: 1 commander, 1 medic, 1 radio operator.

A person may satisfy multiple qualifications simultaneously if operational rules allow it — this behavior should eventually be configurable.

# 7. Leave & Availability

Each soldier must have an availability calendar (Start/End). During this interval the person is unavailable for assignment. Leave must be treated as a **hard constraint**.

Supported leave types: Leave, Home leave, Temporary absence, Medical absence, Other unavailable period. The exact reason should not affect the scheduler unless configured otherwise.

# 8. Temporary Restrictions

The commander must be able to temporarily modify a person's availability, e.g. injured (unavailable 24h), must leave base (available until 18:00), medical restriction (no patrol until tomorrow), qualification restriction (cannot serve as driver for 48h).

Restrictions should support: Start datetime, End datetime, Restriction type, Optional mission restriction, Optional qualification restriction, Notes.


# 9. Mission Type Configuration

Mission types must be configurable, e.g. Patrol (סיור), Gate Guard (ש"ג), Standby (כוננות), Carmel (כרמל), Initiative (יזומה). A commander must be able to create new mission types without developer involvement.

Each mission type should contain: ID, Name, Description, Default duration, Difficulty weight, Default personnel requirement, Default role requirements, Default qualification requirements, Default constraints, Active/inactive.

# 10. Mission Difficulty

Every mission type must have a commander-defined **difficulty / workload weight** (e.g. Standby=1, Gate Guard=2, Patrol=4, Initiative=5). The scale is configurable.

This number does not restrict who can perform a mission — it represents how much workload the mission contributes to a person's historical workload. Example: Soldier A with 2×Patrol + 1×Gate Guard + 1×Standby → workload = 2(4)+2+1 = 11.

# 11. Recurring Missions

Some missions occur every day at predefined times (e.g. Patrol A 08:00–16:00, Patrol B 08:00–16:00, Gate Guard 08:00–12:00, Standby 00:00–08:00). The commander should be able to define recurring mission templates; the system can automatically instantiate them into the next scheduling window.

# 12. Ad-Hoc Missions / "Initiatives"

The system must also support unpredictable missions received from battalion/brigade command (e.g. Night Observation, 14/09 23:00–04:00, 6 personnel, requiring 1 Commander/1 Medic/1 Radio Operator, difficulty 5). These missions participate in scheduling exactly like recurring missions once created.

# 13. Hard Constraints

Hard constraints are rules that **must never be silently violated**: person unavailable, on leave, injured, insufficient rest, overlapping assignments, missing required role/qualification, soldier assigned to commander-only position.

One known initial rule: a person must receive at least 6 hours of required rest before a mission.

The implementation must avoid baking every rule directly into the scheduler — instead support a configurable constraint system (Type, Value, Severity: HARD). Hard constraints should be evaluated before and during schedule generation.

# 14. Soft Constraints

Soft constraints represent preferences, attempted only after all hard constraints are satisfied — e.g. avoid consecutive night duties, avoid stacking difficult missions on high-workload people, prefer spreading difficult missions, avoid repeated identical missions, prefer certain personnel for certain missions.

Soft constraints should be weighted internally. V1 does **not** need to show meaningless UI values like "this schedule is 87% optimal" — the commander needs a good schedule, not an arbitrary optimization percentage.


# 15. Historical Workload Engine

The system must maintain an accumulated **Workload Index** per person: `WorkloadIndex(person) = Σ approved assignments × mission difficulty`.

Only **approved and published schedules** affect this value. Generating a schedule must NOT modify historical workload. Editing a draft must NOT modify historical workload. Regenerating a schedule must NOT modify historical workload. Only **מאושר לפרסום** commits the assignments.

# 16. Workload Snapshot

After publication, the system creates a new immutable workload snapshot (e.g. before: Avi 31, Yossi 28, Daniel 34, Moshe 20; approved assignments: Avi +2, Yossi +5, Daniel +1, Moshe +4; new snapshot: Avi 33, Yossi 33, Daniel 35, Moshe 24). The next scheduling run uses this updated state. This provides an auditable historical record and prevents draft schedules from corrupting workload statistics.

# 17. Fairness Objective

The scheduler should not simply minimize the number of missions — it should minimize unfairness in **weighted accumulated workload**. Someone who completed three difficult patrols should generally have lower priority for another difficult patrol than someone who recently completed only standby missions.

Simplified objective: `minimize(workload_variance + soft_constraint_penalties + repetitive_assignment_penalties)` subject to `ALL hard constraints = satisfied`. The exact optimization strategy should be isolated behind a scheduling engine interface so it can evolve independently from the rest of the application.

# 18. "שבץ אותי" — Generate Schedule

This is the application's primary action. The user prepares Personnel, Availability, Leave, Restrictions, Mission requirements, Roles, Qualifications, Constraints, and presses **שבץ אותי**.

The backend then: loads the scheduling window → loads all missions → loads available personnel → loads roles and qualifications → loads leave and restrictions → loads hard constraints → loads soft constraints → loads current workload snapshot → builds candidate assignments → removes invalid candidates → optimizes remaining assignments → generates the proposed schedule → validates the complete schedule → returns the draft.

# 19. Scheduling Results

The scheduler should return one of three broad outcomes:

- **Successful** — all missions covered, hard constraints satisfied.
- **Successful With Warnings** — valid schedule exists but the commander should review particular conditions or soft-preference violations.
- **Unresolved / Infeasible** — a complete valid schedule cannot be produced; the system must explain why (e.g. "Cannot staff Patrol 02:00–08:00. Required: 1 Commander, 1 Medic, 2 Soldiers. Problem: the only available medic has not received 6 hours of rest.") — far more useful than "Scheduling failed."

# 20. Conflict Resolution

When conflicts exist, the system should present them clearly with concrete options (e.g. replace soldier X with Y, move someone from Standby to Patrol, modify mission requirements, manual resolution). The commander chooses. The system should never silently weaken a hard constraint to produce a schedule.


# 21. Manual Editing

After automatic generation, the commander must be able to modify the schedule manually (select-and-replace, or drag-and-drop). Every manual change should trigger immediate revalidation (e.g. "Cannot assign Cohen — only 3h40m rest before this mission, minimum required 6h").

Depending on final policy, V1 should either block hard-constraint violations entirely or require an explicit exceptional override with a recorded reason — it must never allow them accidentally.

# 22. Draft vs Published State

The system must explicitly distinguish DRAFT and PUBLISHED. Workflow: Configure → שבץ אותי → Draft Schedule → Review → Resolve conflicts → Manual modifications → Validation → מאושר לפרסום → Published Schedule → Update workload snapshot.

This state transition should be transactional. If publication fails midway, workload data must not be partially updated.

# 23. Publication

Pressing **מאושר לפרסום** performs one atomic backend operation: validate the schedule again, freeze the approved version, create assignment history, create/update workload snapshot, record who approved it, record publication timestamp, change status to PUBLISHED, expose schedule to soldiers/viewers.

Published schedules should not be silently modified — corrections should create a revision so history remains auditable.

# 24. Main Scheduling Screen

The primary screen should be optimized for rapid operational use: header with schedule window, personnel available count, mission count, unresolved conflicts count; a prominent **שבץ אותי** button; a timeline/schedule view per time slot and mission; a conflicts banner; and a prominent **מאושר לפרסום** button. The product should be designed **RTL-first**.

# 25. Workload Dashboard

The system should visualize each person's stacked workload contributions by mission type (e.g. a table of Person / Patrol / Guard / Standby / Initiative / Total), so the commander can see who is overloaded/underloaded, which mission types caused it, how balanced the company is, and how workload has changed over time. The dashboard is informational; the actual scheduler uses the underlying workload values.

# 26. History & Audit Log

For every published schedule, retain: scheduling period, original generated draft, final approved schedule, assignments, mission difficulty at publication, approving commander, publication timestamp, manual changes, conflict resolutions. Where practical, workload history should be reconstructable from immutable assignment records rather than relying solely on a mutable number, to protect against corrupted workload state.


# 27. Recommended Data Model

A relational database (PostgreSQL) is recommended. Core entities: User, Company, Person, Role, Qualification, PersonQualification, MissionType, Mission, MissionRequirement, LeavePeriod, Restriction, Constraint, Preference, Schedule, ScheduleVersion, Assignment, WorkloadEvent, WorkloadSnapshot, Conflict, ConflictResolution, AuditLog.

Relationships should be scoped by `company_id` even if the first deployment contains only one company, to avoid major architectural changes later.

# 28. Important Backend Principle

The scheduler must be separated from CRUD/business APIs. Recommended architecture: Frontend → Application API → Scheduling Service → Constraint Engine → Optimization Engine → Database.

Do not place scheduling logic inside frontend code or spread scheduling rules across controllers. A clean interface should conceptually exist: `generate_schedule(input) -> SchedulingResult`, making the engine testable independently.

# 29. Scheduling Engine Strategy

For the MVP, developers should first determine whether a constraint solver is preferable to a custom heuristic algorithm. The problem is naturally Constraint Satisfaction + Optimization: satisfy all hard constraints, then optimize soft objectives.

Conceptual objective: `minimize(workload_imbalance + preference_penalties + repetitive_assignment_penalties)` subject to availability, rest, role, qualification, mission staffing, time overlap, and other hard constraints. The implementation must be deterministic or reproducible where practical, so the same inputs can be debugged.

# 30. Explainability

The scheduling engine must be **explainable** — the commander should understand why a person was or was not selected (e.g. "David was excluded: rest before mission 4h20m, required minimum 6h" / "Moshe was selected: qualified, available, all hard constraints satisfied, lower accumulated workload than other valid candidates"). This matters for commander trust and debugging.

# 31. Validation Engine

The same validation logic must be used for automatic scheduling, manual changes, and pre-publication validation — conceptually `validate_assignment()`, `validate_mission()`, `validate_schedule()`. There must NOT be three independent implementations of the same rules, to avoid discrepancies between automatic and manual scheduling.

# 32. Hebrew UX Requirements

The application itself should be Hebrew-first: RTL layout, Hebrew labels, Hebrew dates, 24-hour clock, simple terminology, large operational controls, clear warnings, minimal unnecessary text. Key action labels: שבץ אותי, מאושר לפרסום, פתור קונפליקט, החלף חייל, הוסף משימה, הוסף חייל, חופשות, מגבלות, מדד עומס, היסטוריית שיבוצים.

Internally, code, database schemas, APIs and developer documentation should remain in English.


# 33. Suggested Technology Stack

Frontend: React / Next.js, TypeScript. Backend: Python, FastAPI. Database: PostgreSQL. Scheduling: Python optimization / constraint solver. Deployment: Docker. Python is particularly appropriate for the scheduling service given its mature optimization ecosystem and easy separation of scheduling logic from the application API.

# 34. Security Requirements

Because this app deals with military personnel and operational scheduling, security should be designed in from the start: authentication, role-based authorization, HTTPS, secure password handling / SSO where available, server-side permission validation, audit logging, session expiration, input validation, database backups, no secrets in frontend code, environment-based secret management.

Operational information should not be exposed publicly or embedded into client-side assets. The deployment environment and data-classification requirements should be explicitly approved before any real operational data is entered.

# 35. MVP Scope

Personnel management; Roles; Qualifications/Pakal; Leave management; Temporary restrictions; Mission type configuration; Mission difficulty; Recurring missions; Ad-hoc missions; Mission staffing requirements; Hard constraints incl. minimum rest; Basic soft preferences; Historical workload calculation; שבץ אותי (generation, conflict detection/explanation, manual editing); מאושר לפרסום (published schedule, workload snapshot, historical schedules); Basic workload dashboard; Authentication; Permissions; Audit log.

# 36. Features Explicitly Deferred From MVP

Native iOS/Android apps; complex soldier accounts; push notifications; WhatsApp integration; AI/LLM scheduling; predictive staffing; advanced analytics; automatic integration with military systems; complex multi-company hierarchy.

The first objective is: **produce a reliable, explainable and fair 24-hour schedule significantly faster than the current manual process.**

# 37. Development Phases

Build incrementally, not all at once:

1. **Foundation** — project structure, database, auth, company model, personnel, roles, qualifications, mission types. No scheduling algorithm yet.
2. **Operational Data** — leave, availability, restrictions, mission instances, recurring missions, requirements, difficulty.
3. **Constraint Engine** — availability, overlap, role compatibility, qualification requirements, rest, mission staffing (unit-tested).
4. **Scheduling Engine** — candidate generation, hard constraint filtering, workload-aware optimization, soft constraints, schedule generation, failure explanations.
5. **Scheduling Workspace** — 24-hour timeline, שבץ אותי, draft state, warnings, conflict UI, manual replacements, live validation.
6. **Publication** — מאושר לפרסום, transactional publication, immutable assignment history, workload events, workload snapshots, schedule revisions.
7. **Analytics** — workload dashboard, historical assignments, mission breakdown, workload comparison.
8. **Production Hardening** — security review, permissions, audit testing, backup/restore, performance testing, scheduling edge-case testing, deployment, monitoring.


# 38. Testing Requirements

The scheduling engine requires extensive automated tests — do not rely primarily on UI testing. Examples: soldier on leave cannot be scheduled; soldier cannot occupy commander-required slot; commander can occupy soldier slot; medic-required mission receives a medic; person cannot have overlapping assignments; person cannot be scheduled without required rest; temporary restriction is respected; higher historical workload influences optimization; draft generation does not change workload; regeneration does not change workload; manual draft editing does not change workload; publication changes workload exactly once; publishing twice cannot duplicate workload; impossible mission returns explanation; manual edit triggers constraint validation.

Create larger simulation tests with ~50 personnel, 20–30 missions, multiple qualifications, multiple leave periods, multiple constraints, 24-hour scheduling window. The result should always satisfy every hard constraint.

# 39. Critical Data Integrity Rule

**GENERATE != COMMIT.** Pressing שבץ אותי creates a proposal. Pressing מאושר לפרסום creates operational history. Therefore generate / regenerate / edit / resolve conflict must NEVER alter historical workload. Only successful publication creates workload events. This should be enforced by backend architecture, not merely UI behavior.

# 40. Definition of Done for V1

V1 is operational when an authorized commander can: configure personnel; define roles and qualifications; enter leave and restrictions; configure mission types and difficulty; define recurring and ad-hoc missions; define staffing requirements; open the next 24-hour scheduling period; press שבץ אותי; receive a valid proposed schedule; understand unresolved conflicts; modify assignments manually with automatic validation; press מאושר לפרסום; publish the final schedule; have historical workload updated exactly once; view the published schedule and historical schedules; view accumulated workload by soldier and mission type.

Most importantly: **no published schedule may silently violate a configured hard constraint.**

# 41. Final Product Vision

The application should evolve into an operational scheduling assistant, not a digital spreadsheet. Its job is to continuously answer: given the missions that must be completed, the personnel currently available, their roles, qualifications, rest, leave and restrictions, and the workload they've already carried — what is the fairest valid schedule for the next 24 hours?

The system proposes the answer. The commander reviews it and retains final authority. Only after the commander presses מאושר לפרסום does that decision become part of the company's historical workload state.

That separation between **constraints, optimization, human command decision, and immutable published history** should be the foundation of the entire architecture.
