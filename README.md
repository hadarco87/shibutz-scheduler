# Shibutz Scheduler (שיבוץ)

Hebrew-first web app for automatically scheduling soldiers and commanders
into operational duties for the next 24 hours.

## Quick start

### Backend (FastAPI + SQLite)

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
PYTHONPATH=. uvicorn app.main:app --reload --port 8000
```

Demo login (seeded automatically in development only):
- Email: `admin@example.com`
- Password: `admin123`

Or register a new platoon at http://localhost:3000/login?register=1

API docs: http://localhost:8000/docs (disabled when `ENVIRONMENT=production`)

### Frontend (Next.js, RTL Hebrew)

```bash
cd frontend
npm install
npm run dev
```

Open: http://localhost:3000

## Soft launch (pilot)

1. Deploy UI (e.g. Vercel) + API/Postgres (e.g. Railway) — see `docker-compose.yml` / `backend/.env.example`
2. Set `NEXT_PUBLIC_APP_URL` to your public URL
3. Share WhatsApp text (also available in-app via **שתפו בוואטסאפ**):

> היי, בניתי כלי קטן לשיבוץ משימות בפלוגה (פיילוט).
> נרשמים באימייל, כל פלוגה בחשבון נפרד, שיבוץ אוטומטי ל־24 השעות הקרובות.
> להרשמה: `https://YOUR_DOMAIN/login?register=1`

4. Aim for 5–10 pilot platoons; collect feedback after one week before wider sharing

## Core actions

- **שבץ אותי** — generate a proposed schedule (draft, never touches history)
- **מאושר לפרסום** — approve & publish (the only action that commits historical workload)

## Architecture rule

`GENERATE != COMMIT`

Draft generation, regeneration, manual edits, and conflict resolution must never
alter historical workload. Only a successful publish creates `WorkloadEvent` rows.

## Stack

- Frontend: Next.js + TypeScript, RTL Hebrew UI
- Backend: Python + FastAPI
- DB: SQLite by default (`DATABASE_URL` can point to PostgreSQL)
- Scheduling: isolated service with shared validation engine
- Auth: self-serve register → one `Company` (platoon) per account

## Production notes

- `ENVIRONMENT=production` → no demo seed, API docs off
- Set a strong `SECRET_KEY` and real `CORS_ORIGINS`
- Prefer PostgreSQL over SQLite for any public deploy

```bash
docker compose up --build
```

## Tests

```bash
cd backend
source .venv/bin/activate
PYTHONPATH=. pytest tests/ -q
```

## Docs

Full product & technical spec: [`docs/spec.md`](docs/spec.md)
