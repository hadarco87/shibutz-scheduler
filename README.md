# Shibutz Scheduler (שיבוץ)

Hebrew-first web app for automatically scheduling soldiers and commanders
into operational duties for the next 24 hours.

Core actions:
- **שבץ אותי** — generate a proposed schedule (draft, never touches history)
- **מאושר לפרסום** — approve & publish (the only action that commits to
  historical workload)

## Stack (proposed)
- Frontend: React / Next.js + TypeScript, RTL-first UI
- Backend: Python + FastAPI
- DB: PostgreSQL
- Scheduling engine: isolated service (constraint satisfaction + optimization),
  called via `generate_schedule(input) -> SchedulingResult`
- Deployment: Docker

## Key architectural rule
`GENERATE != COMMIT`. Draft generation, regeneration, manual edits, and
conflict resolution must never alter historical workload. Only a successful
publish (`מאושר לפרסום`) creates workload events.

## Docs
Full product & technical spec: [`docs/spec.md`](docs/spec.md)

## Build order
See "Development Phases" in the spec — build Foundation → Operational Data →
Constraint Engine → Scheduling Engine → Scheduling Workspace → Publication →
Analytics → Production Hardening, in that order. Do not attempt the whole
app in one shot.
