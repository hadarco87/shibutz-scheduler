"use client";

import { FormEvent, useEffect, useState } from "react";
import { AfterGrantsAccordion } from "@/components/AfterGrantsAccordion";
import { AppShell } from "@/components/AppShell";
import { useConfirm } from "@/components/ConfirmDialog";
import { SettingsAccordion } from "@/components/SettingsAccordion";
import { useAuth } from "@/lib/auth";
import { api, Leave, Person, RecurringRestriction, Restriction } from "@/lib/api";

const WEEKDAYS = [
  { id: 0, label: "ב׳" },
  { id: 1, label: "ג׳" },
  { id: 2, label: "ד׳" },
  { id: 3, label: "ה׳" },
  { id: 4, label: "ו׳" },
  { id: 5, label: "ש׳" },
  { id: 6, label: "א׳" },
];

function kindLabel(kind: string, interval: number, weekdays?: string | null) {
  if (kind === "daily") return "כל יום";
  if (kind === "every_n_days") return `כל ${interval} ימים`;
  if (kind === "weekly") {
    const set = new Set((weekdays || "").split(",").filter(Boolean).map(Number));
    const names = WEEKDAYS.filter((d) => set.has(d.id)).map((d) => d.label);
    return `שבועי (${names.join(", ") || "—"})`;
  }
  return kind;
}

function isPastEnd(endAt: string | null | undefined) {
  if (!endAt) return false;
  const t = new Date(endAt).getTime();
  return Number.isFinite(t) && t < Date.now();
}

function ExpiredMark() {
  return <span className="expired-watermark" aria-hidden>לא רלוונטי</span>;
}

export default function AvailabilityPage() {
  const { token } = useAuth();
  const confirm = useConfirm();
  const [people, setPeople] = useState<Person[]>([]);
  const [leave, setLeave] = useState<Leave[]>([]);
  const [restrictions, setRestrictions] = useState<Restriction[]>([]);
  const [recurring, setRecurring] = useState<RecurringRestriction[]>([]);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  const [personId, setPersonId] = useState<number | "">("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [notes, setNotes] = useState("");
  const [restrictionType, setRestrictionType] = useState("פציעה");

  const [recKind, setRecKind] = useState<"daily" | "every_n_days" | "weekly">("daily");
  const [intervalDays, setIntervalDays] = useState(2);
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [timeStart, setTimeStart] = useState("08:00");
  const [timeEnd, setTimeEnd] = useState("16:00");
  const [anchorDate, setAnchorDate] = useState("");
  const [activeFrom, setActiveFrom] = useState("");
  const [activeUntil, setActiveUntil] = useState("");
  const [recType, setRecType] = useState("מגבלה רוטינית");
  const [recNotes, setRecNotes] = useState("");

  async function refresh() {
    if (!token) return;
    const [p, l, r, rr] = await Promise.all([
      api.people(token),
      api.leave(token),
      api.restrictions(token),
      api.recurringRestrictions(token),
    ]);
    setPeople(p);
    setLeave(l);
    setRestrictions(r);
    setRecurring(rr);
    if (!personId && p[0]) setPersonId(p[0].id);
  }

  useEffect(() => {
    refresh().catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  function nameOf(id: number) {
    return people.find((p) => p.id === id)?.full_name || `#${id}`;
  }

  async function addLeave(e: FormEvent) {
    e.preventDefault();
    if (!token || !personId) return;
    setError("");
    try {
      await api.createLeave(token, {
        person_id: Number(personId),
        leave_type: "leave",
        start_at: new Date(start).toISOString(),
        end_at: new Date(end).toISOString(),
        notes,
      });
      setNotes("");
      setOk("חופשה נוספה");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה");
    }
  }

  async function addRestriction(e: FormEvent) {
    e.preventDefault();
    if (!token || !personId) return;
    setError("");
    try {
      await api.createRestriction(token, {
        person_id: Number(personId),
        start_at: new Date(start).toISOString(),
        end_at: new Date(end).toISOString(),
        restriction_type: restrictionType,
        unavailable: true,
        notes,
      });
      setNotes("");
      setOk("מגבלה חד־פעמית נוספה");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה");
    }
  }

  async function addRecurring(e: FormEvent) {
    e.preventDefault();
    if (!token || !personId) return;
    setError("");
    setOk("");
    try {
      await api.createRecurringRestriction(token, {
        person_id: Number(personId),
        kind: recKind,
        interval_days: recKind === "every_n_days" ? intervalDays : 1,
        weekdays:
          recKind === "weekly" ? weekdays.slice().sort((a, b) => a - b).join(",") : null,
        time_start: timeStart,
        time_end: timeEnd,
        anchor_date: anchorDate ? new Date(anchorDate).toISOString() : null,
        active_from: activeFrom ? new Date(activeFrom).toISOString() : null,
        active_until: activeUntil ? new Date(activeUntil).toISOString() : null,
        restriction_type: recType,
        unavailable: true,
        notes: recNotes || null,
      });
      setOk("מגבלה רוטינית נוספה");
      setRecNotes("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה");
    }
  }

  function toggleWeekday(id: number) {
    setWeekdays((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  return (
    <AppShell>
      <header className="page-intro">
        <h1>חופשות ומגבלות</h1>
        <p>
          מגבלות חד־פעמיות לפי טווח תאריכים, מגבלות רוטיניות, ופרגון אפטר לטיוטת
          השיבוץ.
        </p>
        {error ? <div className="alert alert-danger">{error}</div> : null}
        {ok ? <div className="alert alert-ok">{ok}</div> : null}
      </header>

      <section className="page-section">
        <AfterGrantsAccordion />

        <SettingsAccordion
          title="חופשה / מגבלה חד־פעמית"
          badge="הוספה"
          hint="טווח תאריכים חד־פעמי לחייל"
        >
          <div className="form-grid" style={{ maxWidth: 560 }}>
            <label>
              חייל
              <select
                value={personId}
                onChange={(e) => setPersonId(Number(e.target.value))}
              >
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              התחלה
              <input
                type="datetime-local"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                required
              />
            </label>
            <label>
              סיום
              <input
                type="datetime-local"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                required
              />
            </label>
            <label>
              הערות
              <input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <button className="btn btn-primary" type="button" onClick={addLeave}>
                הוסף חופשה
              </button>
              <input
                value={restrictionType}
                onChange={(e) => setRestrictionType(e.target.value)}
                style={{ maxWidth: 160 }}
                placeholder="סוג מגבלה"
              />
              <button
                className="btn btn-accent"
                type="button"
                onClick={addRestriction}
              >
                הוסף מגבלה חד־פעמית
              </button>
            </div>
          </div>
        </SettingsAccordion>

        <SettingsAccordion
          title="מגבלה רוטינית"
          badge="הוספה"
          hint="חוזרת לפי יום / שבוע / מחזור"
        >
        <form className="form-grid" onSubmit={addRecurring} style={{ maxWidth: 560 }}>
          <label>
            חייל
            <select
              value={personId}
              onChange={(e) => setPersonId(Number(e.target.value))}
            >
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
            </select>
          </label>

          <div>
            <div style={{ marginBottom: "0.4rem", color: "var(--ink-soft)" }}>תדירות</div>
            <div className="people-chips">
              {(
                [
                  ["daily", "כל יום"],
                  ["every_n_days", "כל N ימים"],
                  ["weekly", "ימים בשבוע"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  className={`chip ${recKind === k ? "manual" : ""}`}
                  onClick={() => setRecKind(k)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {recKind === "every_n_days" ? (
            <label>
              כל כמה ימים
              <input
                type="number"
                min={1}
                value={intervalDays}
                onChange={(e) => setIntervalDays(Number(e.target.value))}
              />
            </label>
          ) : null}

          {recKind === "every_n_days" ? (
            <label>
              תאריך עוגן (יום ראשון במחזור)
              <input
                type="date"
                value={anchorDate}
                onChange={(e) => setAnchorDate(e.target.value)}
              />
            </label>
          ) : null}

          {recKind === "weekly" ? (
            <div>
              <div style={{ marginBottom: "0.4rem", color: "var(--ink-soft)" }}>
                ימים בשבוע
              </div>
              <div className="people-chips">
                {WEEKDAYS.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    className={`chip ${weekdays.includes(d.id) ? "manual" : ""}`}
                    onClick={() => toggleWeekday(d.id)}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <label>
            משעה
            <input
              type="time"
              value={timeStart}
              onChange={(e) => setTimeStart(e.target.value)}
              required
            />
          </label>
          <label>
            עד שעה
            <input
              type="time"
              value={timeEnd}
              onChange={(e) => setTimeEnd(e.target.value)}
              required
            />
          </label>
          <label>
            תקף מ־ (אופציונלי)
            <input
              type="date"
              value={activeFrom}
              onChange={(e) => setActiveFrom(e.target.value)}
            />
          </label>
          <label>
            תקף עד (אופציונלי)
            <input
              type="date"
              value={activeUntil}
              onChange={(e) => setActiveUntil(e.target.value)}
            />
          </label>
          <label>
            סיבת מגבלה
            <input
              value={recType}
              onChange={(e) => setRecType(e.target.value)}
              required
            />
          </label>
          <label>
            הערות
            <input value={recNotes} onChange={(e) => setRecNotes(e.target.value)} />
          </label>
          <button className="btn btn-primary" type="submit">
            הוסף מגבלה רוטינית
          </button>
        </form>
      </SettingsAccordion>
      </section>

      <section className="page-section">
      <section className="panel panel-list">
        <h2 style={{ marginTop: 0 }}>חופשות</h2>
        <table className="table">
          <thead>
            <tr>
              <th>חייל</th>
              <th>התחלה</th>
              <th>סיום</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {leave.map((l) => {
              const expired = isPastEnd(l.end_at);
              return (
              <tr key={l.id} className={expired ? "table-row-expired" : undefined}>
                <td>
                  {nameOf(l.person_id)}
                  {expired ? <ExpiredMark /> : null}
                </td>
                <td>{new Date(l.start_at).toLocaleString("he-IL")}</td>
                <td>{new Date(l.end_at).toLocaleString("he-IL")}</td>
                <td>
                  <button
                    className="btn btn-ghost btn-small"
                    type="button"
                    onClick={async () => {
                      if (!token) return;
                      const ok = await confirm({
                        title: "מחיקת חופשה",
                        message: `למחוק חופשה של ${nameOf(l.person_id)}?`,
                        confirmLabel: "מחק",
                        tone: "danger",
                      });
                      if (!ok) return;
                      await api.deleteLeave(token, l.id);
                      await refresh();
                    }}
                  >
                    מחק
                  </button>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="panel panel-list">
        <h2 style={{ marginTop: 0 }}>מגבלות חד־פעמיות</h2>
        <table className="table">
          <thead>
            <tr>
              <th>חייל</th>
              <th>סוג</th>
              <th>התחלה</th>
              <th>סיום</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {restrictions.map((r) => {
              const expired = isPastEnd(r.end_at);
              return (
              <tr key={r.id} className={expired ? "table-row-expired" : undefined}>
                <td>
                  {nameOf(r.person_id)}
                  {expired ? <ExpiredMark /> : null}
                </td>
                <td>{r.restriction_type}</td>
                <td>{new Date(r.start_at).toLocaleString("he-IL")}</td>
                <td>{new Date(r.end_at).toLocaleString("he-IL")}</td>
                <td>
                  <button
                    className="btn btn-ghost btn-small"
                    type="button"
                    onClick={async () => {
                      if (!token) return;
                      const ok = await confirm({
                        title: "מחיקת מגבלה",
                        message: `למחוק מגבלה של ${nameOf(r.person_id)} (${r.restriction_type})?`,
                        confirmLabel: "מחק",
                        tone: "danger",
                      });
                      if (!ok) return;
                      await api.deleteRestriction(token, r.id);
                      await refresh();
                    }}
                  >
                    מחק
                  </button>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="panel panel-list">
        <h2 style={{ marginTop: 0 }}>מגבלות רוטיניות</h2>
        <table className="table">
          <thead>
            <tr>
              <th>חייל</th>
              <th>סוג</th>
              <th>תדירות</th>
              <th>שעות</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {recurring.map((r) => {
              const expired = isPastEnd(r.active_until);
              return (
              <tr key={r.id} className={expired ? "table-row-expired" : undefined}>
                <td>
                  {nameOf(r.person_id)}
                  {expired ? <ExpiredMark /> : null}
                </td>
                <td>{r.restriction_type}</td>
                <td>{kindLabel(r.kind, r.interval_days, r.weekdays)}</td>
                <td>
                  {r.time_start}–{r.time_end}
                  {r.active_until
                    ? ` · עד ${new Date(r.active_until).toLocaleDateString("he-IL")}`
                    : ""}
                </td>
                <td>
                  <button
                    className="btn btn-ghost btn-small"
                    type="button"
                    onClick={async () => {
                      if (!token) return;
                      const ok = await confirm({
                        title: "מחיקת מגבלה רוטינית",
                        message: `למחוק מגבלה רוטינית של ${nameOf(r.person_id)} (${r.restriction_type})?`,
                        confirmLabel: "מחק",
                        tone: "danger",
                      });
                      if (!ok) return;
                      await api.deleteRecurringRestriction(token, r.id);
                      await refresh();
                    }}
                  >
                    מחק
                  </button>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </section>
      </section>
    </AppShell>
  );
}
