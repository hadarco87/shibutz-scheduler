"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth";
import {
  api,
  AfterCandidate,
  AfterDraftItem,
  AfterPreview,
  MissionType,
  Person,
  Schedule,
  SchedulingResult,
  ReplacementCandidate,
} from "@/lib/api";
import { routineShiftsForWindow, resolveStaffingForStart, windowShiftsForRange } from "@/lib/routine";

function formatRange(start: string, end: string) {
  const s = new Date(start);
  const e = new Date(end);
  const opts: Intl.DateTimeFormatOptions = {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  };
  return `${s.toLocaleString("he-IL", opts)} → ${e.toLocaleString("he-IL", opts)}`;
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function formatLocal(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Naive local datetime for API (avoid UTC day-shift from toISOString). */
function toApiLocal(d: Date) {
  return `${formatLocal(d)}:00`;
}

/** Full calendar day: local midnight → next midnight. */
function calendarDayWindow(which: "today" | "tomorrow") {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (which === "tomorrow") {
    start.setDate(start.getDate() + 1);
  }
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

function sameCalendarDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatDayTitle(d: Date | string) {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("he-IL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

const MISSION_COLORS = [
  "#3f5a32",
  "#b85c38",
  "#2c5f8a",
  "#6b3d7a",
  "#9a6b16",
  "#1f6f5a",
  "#8b3a4a",
  "#4a5f8a",
  "#6a7a2e",
  "#a05a2c",
];

function colorForMissionType(typeId: number) {
  return MISSION_COLORS[Math.abs(typeId) % MISSION_COLORS.length];
}

function pctInDay(dayStart: Date, dayEnd: Date, t: Date) {
  const total = dayEnd.getTime() - dayStart.getTime();
  if (total <= 0) return 0;
  const clamped = Math.min(dayEnd.getTime(), Math.max(dayStart.getTime(), t.getTime()));
  return ((clamped - dayStart.getTime()) / total) * 100;
}

export default function HomePage() {
  const { token } = useAuth();
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [missionTypes, setMissionTypes] = useState<MissionType[]>([]);
  const [result, setResult] = useState<SchedulingResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [replaceFor, setReplaceFor] = useState<number | null>(null);
  const [replacePersonId, setReplacePersonId] = useState<number | "">("");
  const [replaceCandidates, setReplaceCandidates] = useState<
    ReplacementCandidate[]
  >([]);
  const [replaceLoading, setReplaceLoading] = useState(false);
  const [afterPreview, setAfterPreview] = useState<AfterPreview | null>(null);
  const [afterSelected, setAfterSelected] = useState<
    Record<number, { start: string; end: string }>
  >({});
  const [rosterOpen, setRosterOpen] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    const [schedules, roster, types] = await Promise.all([
      api.schedules(token),
      api.people(token),
      api.missionTypes(token),
    ]);
    setPeople(roster.filter((p) => p.is_active));
    setMissionTypes(types);
    const draft =
      schedules.find((s) => s.status === "draft") ||
      schedules[0] ||
      null;
    setSchedule(draft);
    if (draft && draft.status === "draft" && draft.assignments.length) {
      try {
        const preview = await api.afterPreview(token, draft.id);
        setAfterPreview(preview);
        const sel: Record<number, { start: string; end: string }> = {};
        for (const d of preview.drafts) {
          sel[d.person_id] = {
            start: formatLocal(new Date(d.start_at)),
            end: formatLocal(new Date(d.end_at)),
          };
        }
        setAfterSelected(sel);
      } catch {
        setAfterPreview(null);
      }
    } else {
      setAfterPreview(null);
      setAfterSelected({});
    }
  }, [token]);

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);

  const availableCount = people.length;
  const missionCount = schedule?.missions.length || 0;
  const conflictCount = result?.conflicts.length || 0;

  const rosterByRole = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of people) {
      const role = p.role_name || "ללא תפקיד";
      counts.set(role, (counts.get(role) || 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([role, count]) => ({ role, count }))
      .sort((a, b) => b.count - a.count || a.role.localeCompare(b.role, "he"));
  }, [people]);

  const selectableTypes = useMemo(
    () => missionTypes.filter((t) => t.is_active),
    [missionTypes]
  );

  const missionsSorted = useMemo(() => {
    if (!schedule) return [];
    return [...schedule.missions].sort(
      (a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime()
    );
  }, [schedule]);

  async function createMissions(
    mt: MissionType,
    shifts: { start: Date; end: Date }[],
    isAdhoc: boolean
  ) {
    if (!token || !schedule) return;
    if (!shifts.length) {
      throw new Error(`לא נוצרו מופעים עבור «${mt.name}»`);
    }
    for (const { start, end } of shifts) {
      const staffing = resolveStaffingForStart(start, mt);
      await api.createMission(token, {
        mission_type_id: mt.id,
        name: mt.name,
        start_at: toApiLocal(start),
        end_at: toApiLocal(end),
        personnel_count: staffing.personnel_count,
        difficulty_weight: mt.difficulty_weight,
        is_adhoc: isAdhoc,
        schedule_id: schedule.id,
        requirements: staffing.requirements.map((r) => ({
          role_id: r.role_id ?? null,
          qualification_id: r.qualification_id ?? null,
          count: r.count,
        })),
      });
    }
    const refreshed = await api.getSchedule(token, schedule.id);
    setSchedule(refreshed);
    setResult(null);
  }

  async function toggleTypeInWindow(mt: MissionType) {
    if (!token || !schedule || schedule.status !== "draft") return;
    const existing = schedule.missions.filter((m) => m.mission_type_id === mt.id);
    if (existing.length) {
      if (
        !confirm(
          `להסיר את «${mt.name}» מחלון השיבוץ (${existing.length} מופעים)?`
        )
      ) {
        return;
      }
      setBusy(true);
      setError("");
      try {
        for (const m of existing) {
          await api.deleteMission(token, m.id);
        }
        const refreshed = await api.getSchedule(token, schedule.id);
        setSchedule(refreshed);
        setResult(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "עדכון משימות נכשל");
      } finally {
        setBusy(false);
      }
      return;
    }

    setBusy(true);
    setError("");
    try {
      if (mt.is_recurring_template) {
        if (mt.recurring_start_hour == null) {
          setError(
            `למשימה הרוטינית «${mt.name}» חסרה שעת התחלה — הגדירו בהגדרות`
          );
          return;
        }
        await createMissions(
          mt,
          routineShiftsForWindow(
            mt.default_duration_hours || 4,
            mt.recurring_start_hour,
            mt.routine_remainder_policy === "full_only"
              ? "full_only"
              : "include_short",
            schedule.window_start,
            schedule.window_end
          ),
          false
        );
      } else {
        const windows = mt.time_windows || [];
        if (!windows.length) {
          setError(
            `למשימה «${mt.name}» חסרים טווחי שעות — הגדירו בהגדרות`
          );
          return;
        }
        await createMissions(
          mt,
          windowShiftsForRange(
            windows,
            schedule.window_start,
            schedule.window_end
          ),
          false
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "עדכון משימות נכשל");
    } finally {
      setBusy(false);
    }
  }

  async function createWindow(which: "today" | "tomorrow", opts?: { silent?: boolean }) {
    if (!token) return null;
    if (!opts?.silent && schedule && schedule.status === "draft") {
      const label = which === "today" ? "היום" : "מחר";
      if (
        !confirm(
          `ליצור חלון שיבוץ חדש ל${label}? הטיוטה הנוכחית תישאר; החלון החדש יהפוך לפעיל.`
        )
      ) {
        return null;
      }
    }
    setBusy(true);
    setError("");
    setResult(null);
    setAfterPreview(null);
    setAfterSelected({});
    try {
      const { start, end } = calendarDayWindow(which);
      const created = await api.createSchedule(token, {
        window_start: toApiLocal(start),
        window_end: toApiLocal(end),
        instantiate_recurring: true,
      });
      setSchedule(created);
      return created;
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function onGenerate() {
    if (!token) return;
    setBusy(true);
    setError("");
    try {
      let target = schedule;
      const tomorrowStart = calendarDayWindow("tomorrow").start;
      const onTomorrow =
        target &&
        target.status === "draft" &&
        sameCalendarDay(new Date(target.window_start), tomorrowStart);

      if (!onTomorrow) {
        // Always schedule the next calendar day, regardless of current clock time.
        const { start, end } = calendarDayWindow("tomorrow");
        target = await api.createSchedule(token, {
          window_start: toApiLocal(start),
          window_end: toApiLocal(end),
          instantiate_recurring: true,
        });
        setSchedule(target);
        setAfterPreview(null);
        setAfterSelected({});
      }

      if (!target) return;
      const res = await api.generate(token, target.id);
      setResult(res);
      setSchedule(res.schedule);
      const preview = await api.afterPreview(token, target.id);
      setAfterPreview(preview);
      const sel: Record<number, { start: string; end: string }> = {};
      for (const d of preview.drafts) {
        sel[d.person_id] = {
          start: formatLocal(new Date(d.start_at)),
          end: formatLocal(new Date(d.end_at)),
        };
      }
      setAfterSelected(sel);
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה בשיבוץ");
    } finally {
      setBusy(false);
    }
  }

  async function onGenerateForToday() {
    if (!token || !schedule || schedule.status !== "draft") return;
    setBusy(true);
    setError("");
    try {
      const res = await api.generate(token, schedule.id);
      setResult(res);
      setSchedule(res.schedule);
      const preview = await api.afterPreview(token, schedule.id);
      setAfterPreview(preview);
      const sel: Record<number, { start: string; end: string }> = {};
      for (const d of preview.drafts) {
        sel[d.person_id] = {
          start: formatLocal(new Date(d.start_at)),
          end: formatLocal(new Date(d.end_at)),
        };
      }
      setAfterSelected(sel);
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה בשיבוץ");
    } finally {
      setBusy(false);
    }
  }

  async function onPublish() {
    if (!token || !schedule) return;
    if (!confirm("לאשר ולפרסם את השיבוץ? פעולה זו תעדכן את מדד העומס.")) return;
    setBusy(true);
    setError("");
    try {
      const published = await api.publish(token, schedule.id);
      setSchedule(published);
      setResult(null);
      setAfterPreview(null);
      setAfterSelected({});
    } catch (e) {
      setError(e instanceof Error ? e.message : "פרסום נכשל");
    } finally {
      setBusy(false);
    }
  }

  async function toggleAfterCandidate(c: AfterCandidate) {
    if (!schedule) return;
    setError("");
    if (!afterSelected[c.person_id]) {
      if (
        afterPreview &&
        Object.keys(afterSelected).length >= afterPreview.after_quota
      ) {
        setError(`מכסת האפטר היא ${afterPreview.after_quota} בלבד`);
        return;
      }
    }
    setAfterSelected((prev) => {
      const next = { ...prev };
      if (next[c.person_id]) {
        delete next[c.person_id];
      } else {
        const start = formatLocal(new Date(schedule.window_start));
        const endDate = new Date(schedule.window_start);
        endDate.setHours(endDate.getHours() + 8);
        next[c.person_id] = { start, end: formatLocal(endDate) };
      }
      return next;
    });
  }

  async function saveAfterSelections() {
    if (!token || !schedule) return;
    setBusy(true);
    setError("");
    try {
      const items: AfterDraftItem[] = Object.entries(afterSelected).map(
        ([pid, times]) => ({
          person_id: Number(pid),
          start_at: new Date(times.start).toISOString(),
          end_at: new Date(times.end).toISOString(),
        })
      );
      const preview = await api.saveAfterDrafts(token, schedule.id, items);
      setAfterPreview(preview);
    } catch (e) {
      setError(e instanceof Error ? e.message : "שמירת אפטר נכשלה");
    } finally {
      setBusy(false);
    }
  }

  async function openReplace(assignmentId: number) {
    if (!token || !schedule) return;
    setReplaceFor(assignmentId);
    setReplacePersonId("");
    setReplaceCandidates([]);
    setReplaceLoading(true);
    setError("");
    try {
      const candidates = await api.replacementCandidates(
        token,
        schedule.id,
        assignmentId
      );
      setReplaceCandidates(candidates);
    } catch (e) {
      setError(e instanceof Error ? e.message : "טעינת מועמדים נכשלה");
      setReplaceFor(null);
    } finally {
      setReplaceLoading(false);
    }
  }

  async function onReplace(assignmentId: number) {
    if (!token || !schedule || !replacePersonId) return;
    setBusy(true);
    setError("");
    try {
      await api.replaceAssignment(token, schedule.id, assignmentId, {
        person_id: Number(replacePersonId),
      });
      const refreshed = await api.getSchedule(token, schedule.id);
      setSchedule(refreshed);
      setReplaceFor(null);
      setReplacePersonId("");
      setReplaceCandidates([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "החלפה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  const timelineRows = useMemo(() => {
    if (!schedule) return [];
    const byType = new Map<
      number,
      { typeId: number; name: string; missions: typeof missionsSorted }
    >();
    for (const m of missionsSorted) {
      const key = m.mission_type_id;
      const name = m.mission_type_name || m.name;
      if (!byType.has(key)) {
        byType.set(key, { typeId: key, name, missions: [] });
      }
      byType.get(key)!.missions.push(m);
    }
    return Array.from(byType.values()).sort((a, b) =>
      a.name.localeCompare(b.name, "he")
    );
  }, [missionsSorted, schedule]);

  const dayBounds = useMemo(() => {
    if (!schedule) return null;
    const start = new Date(schedule.window_start);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start, end };
  }, [schedule]);

  const windowKind = useMemo(() => {
    if (!schedule) return null as null | "today" | "tomorrow" | "other";
    const start = new Date(schedule.window_start);
    const today = calendarDayWindow("today").start;
    const tomorrow = calendarDayWindow("tomorrow").start;
    if (sameCalendarDay(start, today)) return "today";
    if (sameCalendarDay(start, tomorrow)) return "tomorrow";
    return "other";
  }, [schedule]);

  const todayTitle = useMemo(
    () => formatDayTitle(calendarDayWindow("today").start),
    []
  );
  const tomorrowTitle = useMemo(
    () => formatDayTitle(calendarDayWindow("tomorrow").start),
    []
  );

  return (
    <AppShell>
      <section className="panel">
        <div className="hero-actions">
          <div>
            <h1 style={{ margin: "0 0 0.35rem", fontSize: "1.7rem" }}>
              מסך שיבוץ
            </h1>
            <p style={{ margin: "0 0 0.35rem", color: "var(--ink-soft)" }}>
              <span className="schedule-day-badge muted">היום</span>
              {todayTitle}
            </p>
            <p style={{ margin: 0, fontSize: "1.05rem" }}>
              {windowKind === "today" ? (
                <>
                  <span className="schedule-day-badge today">שיבוץ להיום</span>
                  {formatDayTitle(schedule!.window_start)} · 00:00–24:00
                </>
              ) : (
                <>
                  <span className="schedule-day-badge">שיבוץ למחר</span>
                  {schedule && windowKind === "tomorrow"
                    ? `${formatDayTitle(schedule.window_start)} · 00:00–24:00`
                    : `${tomorrowTitle} · 00:00–24:00`}
                </>
              )}
            </p>
            <p
              style={{
                margin: "0.35rem 0 0",
                color: "var(--ink-soft)",
                fontSize: "0.9rem",
              }}
            >
              «שבץ אותי למחר» תמיד בונה שיבוץ ליממה הבאה (חצות–חצות), בלי קשר
              לשעה הנוכחית.
            </p>
            <p className="schedule-day-alt">
              {windowKind === "today" ? (
                <button
                  type="button"
                  className="text-link"
                  disabled={busy}
                  onClick={() => createWindow("tomorrow")}
                >
                  חזרה לשיבוץ מחר (ברירת מחדל)
                </button>
              ) : (
                <button
                  type="button"
                  className="text-link"
                  disabled={busy}
                  onClick={() => createWindow("today")}
                >
                  צריך שיבוץ להיום במקום?
                </button>
              )}
            </p>
          </div>
          <div className="hero-primary-actions">
            {schedule && schedule.status === "draft" && windowKind === "today" ? (
              <>
                <button
                  className="btn btn-primary"
                  type="button"
                  disabled={busy}
                  onClick={onGenerateForToday}
                >
                  שבץ אותי להיום
                </button>
                <button
                  className="btn btn-accent"
                  type="button"
                  disabled={busy || !schedule.assignments.length}
                  onClick={onPublish}
                >
                  מאושר לפרסום
                </button>
              </>
            ) : (
              <>
                <button
                  className="btn btn-primary"
                  type="button"
                  disabled={busy}
                  onClick={onGenerate}
                >
                  שבץ אותי למחר
                </button>
                {schedule &&
                schedule.status === "draft" &&
                windowKind === "tomorrow" ? (
                  <button
                    className="btn btn-accent"
                    type="button"
                    disabled={busy || !schedule.assignments.length}
                    onClick={onPublish}
                  >
                    מאושר לפרסום
                  </button>
                ) : null}
              </>
            )}
          </div>
        </div>

        <div className="stats" style={{ marginTop: "1rem" }}>
          <div className="stat-stack">
            <button
              type="button"
              className={`stat stat-button ${rosterOpen ? "open" : ""}`}
              onClick={() => setRosterOpen((v) => !v)}
              aria-expanded={rosterOpen}
            >
              <span className="label">
                כוח אדם זמין {rosterOpen ? "▴" : "▾"}
              </span>
              <span className="value">{availableCount}</span>
            </button>
            {rosterOpen ? (
              <div className="roster-breakdown">
                <div className="roster-breakdown-title">פירוט לפי תפקיד</div>
                {rosterByRole.length === 0 ? (
                  <p style={{ margin: 0, color: "var(--ink-soft)" }}>
                    אין כוח אדם פעיל.
                  </p>
                ) : (
                  <ul className="roster-breakdown-list">
                    {rosterByRole.map((row) => (
                      <li key={row.role}>
                        <span>{row.role}</span>
                        <strong>{row.count}</strong>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}
          </div>
          <div className="stat">
            <span className="label">משימות</span>
            <span className="value">{missionCount}</span>
          </div>
          <div className="stat">
            <span className="label">קונפליקטים</span>
            <span className="value">{conflictCount}</span>
          </div>
        </div>

        {schedule ? (
          <div style={{ marginTop: "0.85rem", color: "var(--ink-soft)" }}>
            סטטוס:{" "}
            <strong>
              {schedule.status === "published" ? "מפורסם" : "טיוטה"}
            </strong>
          </div>
        ) : null}

        {error ? <div className="alert alert-danger">{error}</div> : null}
        {result?.status === "success" ? (
          <div className="alert alert-ok">שיבוץ תקין — כל המשימות מאוישות.</div>
        ) : null}
        {result?.status === "success_with_warnings" ? (
          <div className="alert alert-warn">
            שיבוץ תקין עם אזהרות. בדקו את הפרטים למטה.
          </div>
        ) : null}
        {result?.conflicts?.length ? (
          <div className="alert alert-danger">
            <strong>קונפליקטים שלא נפתרו:</strong>
            <ul style={{ margin: "0.4rem 0 0", paddingInlineStart: "1.2rem" }}>
              {result.conflicts.map((c, i) => (
                <li key={`${c.mission_id}-${i}`}>{c.message}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      {schedule ? (
        <section className="panel">
          <h2 style={{ marginTop: 0 }}>משימות בחלון</h2>
          <p style={{ color: "var(--ink-soft)", marginTop: 0 }}>
            רוטינית מתווספת לפי שעת התחלה ומשך (מהגדרות). משימה שאינה רוטינית
            מתווספת אוטומטית לפי טווחי השעות שהוגדרו בהגדרות.
          </p>
          {selectableTypes.length === 0 ? (
            <p style={{ color: "var(--ink-soft)" }}>
              אין משימות מסומנות לשיבוץ. סמנו משימות בעמוד ההגדרות.
            </p>
          ) : (
            <div className="people-chips">
              {selectableTypes.map((mt) => {
                const inWindow = schedule.missions.some(
                  (m) => m.mission_type_id === mt.id
                );
                return (
                  <button
                    key={mt.id}
                    type="button"
                    className={`chip ${inWindow ? "manual" : ""}`}
                    disabled={busy || schedule.status !== "draft"}
                    onClick={() => toggleTypeInWindow(mt)}
                    title={
                      inWindow
                        ? "הסר מהחלון"
                        : mt.is_recurring_template
                          ? "הוסף משמרות רוטיניות"
                          : "הוסף לפי טווחי השעות מההגדרות"
                    }
                  >
                    {inWindow ? "✓ " : ""}
                    {mt.name}
                    {!mt.is_recurring_template ? " · חד־פעמית" : ""}
                  </button>
                );
              })}
            </div>
          )}

          {schedule.status !== "draft" ? (
            <p style={{ color: "var(--ink-soft)", marginBottom: 0 }}>
              שיבוץ מפורסם — לא ניתן לשנות את רשימת המשימות.
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="panel">
        <h2 style={{ marginTop: 0 }}>לוח זמנים</h2>
        {!schedule || !dayBounds ? (
          <p style={{ color: "var(--ink-soft)" }}>עדיין אין שיבוץ להצגה.</p>
        ) : (
          <>
            <p style={{ color: "var(--ink-soft)", marginTop: 0 }}>
              ציר זמן ליממה · כל צבע = סוג משימה · פסים לפי שעות
            </p>
            <div className="day-timeline" dir="ltr">
              <div className="day-timeline-hours">
                <div className="day-timeline-label-spacer" />
                <div className="day-timeline-track hours">
                  {Array.from({ length: 25 }, (_, h) => (
                    <span
                      key={h}
                      className="day-timeline-hour"
                      style={{ insetInlineStart: `${(h / 24) * 100}%` }}
                    >
                      {pad(h === 24 ? 0 : h)}
                    </span>
                  ))}
                </div>
              </div>
              {timelineRows.length === 0 ? (
                <p style={{ color: "var(--ink-soft)", padding: "0.5rem 0" }}>
                  אין משימות בחלון — בחרו משימות למעלה ואז «שבץ אותי».
                </p>
              ) : (
                timelineRows.map((row) => (
                  <div key={row.typeId} className="day-timeline-row">
                    <div className="day-timeline-label">
                      <span
                        className="day-timeline-swatch"
                        style={{ background: colorForMissionType(row.typeId) }}
                      />
                      {row.name}
                    </div>
                    <div className="day-timeline-track">
                      {row.missions.map((m) => {
                        const ms = new Date(m.start_at);
                        const me = new Date(m.end_at);
                        const left = pctInDay(dayBounds.start, dayBounds.end, ms);
                        const right = pctInDay(dayBounds.start, dayBounds.end, me);
                        const width = Math.max(1.2, right - left);
                        const assigned = schedule.assignments.filter(
                          (a) => a.mission_id === m.id
                        );
                        return (
                          <div
                            key={m.id}
                            className="day-timeline-bar"
                            style={{
                              insetInlineStart: `${left}%`,
                              width: `${width}%`,
                              background: colorForMissionType(row.typeId),
                            }}
                            title={`${m.name} · ${formatRange(m.start_at, m.end_at)}${
                              assigned.length
                                ? ` · ${assigned.map((a) => a.person_name).join(", ")}`
                                : " · לא מאויש"
                            }`}
                          >
                            <span className="day-timeline-bar-text">
                              {pad(ms.getHours())}:{pad(ms.getMinutes())}
                              {assigned.length
                                ? ` · ${assigned.map((a) => a.person_name).join(", ")}`
                                : ""}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="mission-list" style={{ marginTop: "1.25rem" }}>
              {missionsSorted.map((m) => {
                const assigned = schedule.assignments.filter(
                  (a) => a.mission_id === m.id
                );
                return (
                  <article key={m.id} className="mission-card">
                    <header>
                      <div>
                        <h3>
                          <span
                            className="day-timeline-swatch"
                            style={{
                              background: colorForMissionType(m.mission_type_id),
                              display: "inline-block",
                              marginInlineEnd: "0.4rem",
                              verticalAlign: "middle",
                            }}
                          />
                          {m.name}
                        </h3>
                        <div className="time">
                          קושי {m.difficulty_weight}/5 · {m.personnel_count} אנשים
                        </div>
                      </div>
                      <div className="time">
                        {formatRange(m.start_at, m.end_at)}
                      </div>
                    </header>
                    <div className="people-chips">
                      {assigned.length === 0 ? (
                        <span style={{ color: "var(--danger)" }}>לא מאויש</span>
                      ) : (
                        assigned.map((a) => (
                          <span
                            key={a.id}
                            className={`chip ${a.is_manual ? "manual" : ""}`}
                          >
                            {a.person_name}
                            {schedule.status === "draft" ? (
                              <button
                                className="btn btn-ghost btn-small"
                                type="button"
                                onClick={() => openReplace(a.id)}
                              >
                                החלף
                              </button>
                            ) : null}
                          </span>
                        ))
                      )}
                    </div>
                    {replaceFor && assigned.some((a) => a.id === replaceFor) ? (
                      <div
                        style={{
                          marginTop: "0.75rem",
                          display: "flex",
                          gap: "0.5rem",
                          flexWrap: "wrap",
                          alignItems: "center",
                        }}
                      >
                        {replaceLoading ? (
                          <span style={{ color: "var(--ink-soft)" }}>
                            טוען מועמדים מתאימים…
                          </span>
                        ) : replaceCandidates.length === 0 ? (
                          <span style={{ color: "var(--danger)" }}>
                            אין חיילים שיכולים לבצע את המשבצת הזו כרגע
                          </span>
                        ) : (
                          <select
                            value={replacePersonId}
                            onChange={(e) =>
                              setReplacePersonId(
                                e.target.value ? Number(e.target.value) : ""
                              )
                            }
                          >
                            <option value="">בחרו חייל</option>
                            {replaceCandidates.map((p) => (
                              <option key={p.person_id} value={p.person_id}>
                                {p.person_name}
                                {p.role_name ? ` (${p.role_name})` : ""}
                              </option>
                            ))}
                          </select>
                        )}
                        <button
                          className="btn btn-primary btn-small"
                          type="button"
                          disabled={
                            !replacePersonId ||
                            busy ||
                            replaceLoading ||
                            replaceCandidates.length === 0
                          }
                          onClick={() => onReplace(replaceFor)}
                        >
                          שמור החלפה
                        </button>
                        <button
                          className="btn btn-ghost btn-small"
                          type="button"
                          onClick={() => {
                            setReplaceFor(null);
                            setReplacePersonId("");
                            setReplaceCandidates([]);
                          }}
                        >
                          ביטול
                        </button>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </>
        )}
      </section>

      {schedule &&
      schedule.status === "draft" &&
      afterPreview &&
      (result || schedule.assignments.length > 0) ? (
        <section className="panel">
          <h2 style={{ marginTop: 0 }}>אפטר — פרגון יציאות</h2>
          <p style={{ color: "var(--ink-soft)", marginTop: 0 }}>
            מכסה: {afterPreview.after_quota} (כוח אדם {afterPreview.total_active} −
            קנים {afterPreview.min_kanim}). הרשימה מדורגת לפי מי שפחות יצא לאפטר ב־30
            הימים האחרונים — ההמלצה אינה מחייבת. נשמר סופית רק ב«מאושר לפרסום».
          </p>
          <div className="stats" style={{ marginBottom: "1rem" }}>
            <div className="stat">
              <span className="label">ניתן לפרגן</span>
              <span className="value">{afterPreview.after_quota}</span>
            </div>
            <div className="stat">
              <span className="label">נבחרו</span>
              <span className="value">{Object.keys(afterSelected).length}</span>
            </div>
            <div className="stat">
              <span className="label">מועמדים פנויים</span>
              <span className="value">{afterPreview.candidates.length}</span>
            </div>
          </div>
          <div className="mission-list">
            {afterPreview.candidates.map((c) => {
              const selected = !!afterSelected[c.person_id];
              const times = afterSelected[c.person_id];
              return (
                <article key={c.person_id} className="mission-card">
                  <header>
                    <div>
                      <h3>
                        #{c.recommended_rank} · {c.person_name}
                      </h3>
                      <div className="time">
                        אפטרים ב־30 ימים: {c.after_count_30d}
                        {c.sleep_warning ? (
                          <span style={{ color: "var(--danger)", marginInlineStart: 8 }}>
                            ⚠ {c.sleep_warning_message || "ייתכן שלא ישן מספיק"}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <button
                      className={`btn ${selected ? "btn-accent" : "btn-ghost"} btn-small`}
                      type="button"
                      disabled={busy}
                      onClick={() => toggleAfterCandidate(c)}
                    >
                      {selected ? "נבחר לאפטר" : "פרגן אפטר"}
                    </button>
                  </header>
                  {selected && times ? (
                    <div
                      style={{
                        display: "flex",
                        gap: "0.5rem",
                        flexWrap: "wrap",
                        marginTop: "0.6rem",
                      }}
                    >
                      <label>
                        התחלה
                        <input
                          type="datetime-local"
                          value={times.start}
                          onChange={(e) =>
                            setAfterSelected((prev) => ({
                              ...prev,
                              [c.person_id]: { ...times, start: e.target.value },
                            }))
                          }
                        />
                      </label>
                      <label>
                        סיום
                        <input
                          type="datetime-local"
                          value={times.end}
                          onChange={(e) =>
                            setAfterSelected((prev) => ({
                              ...prev,
                              [c.person_id]: { ...times, end: e.target.value },
                            }))
                          }
                        />
                      </label>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
          <button
            className="btn btn-primary"
            type="button"
            style={{ marginTop: "1rem" }}
            disabled={busy}
            onClick={saveAfterSelections}
          >
            שמור בחירת אפטר לטיוטה
          </button>
        </section>
      ) : null}
    </AppShell>
  );
}
