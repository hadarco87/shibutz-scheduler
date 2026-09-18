"use client";

import { useCallback, useEffect, useState } from "react";
import { SettingsAccordion } from "@/components/SettingsAccordion";
import { useAuth } from "@/lib/auth";
import {
  api,
  AfterCandidate,
  AfterDraftItem,
  AfterPreview,
  Schedule,
  ScheduleDaySummary,
  SchedulePlan,
} from "@/lib/api";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function formatLocal(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function dayShortLabel(iso: string) {
  return new Date(iso).toLocaleDateString("he-IL", {
    weekday: "short",
    day: "numeric",
    month: "numeric",
  });
}

export function AfterGrantsAccordion() {
  const { token } = useAuth();
  const [plan, setPlan] = useState<SchedulePlan | null>(null);
  const [planDays, setPlanDays] = useState<ScheduleDaySummary[]>([]);
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [afterPreview, setAfterPreview] = useState<AfterPreview | null>(null);
  const [afterSelected, setAfterSelected] = useState<
    Record<number, { start: string; end: string }>
  >({});
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [switchingDay, setSwitchingDay] = useState(false);

  function applyAfterPreview(preview: AfterPreview | null) {
    setAfterPreview(preview);
    if (!preview) {
      setAfterSelected({});
      return;
    }
    const sel: Record<number, { start: string; end: string }> = {};
    for (const d of preview.drafts) {
      sel[d.person_id] = {
        start: formatLocal(new Date(d.start_at)),
        end: formatLocal(new Date(d.end_at)),
      };
    }
    setAfterSelected(sel);
  }

  async function loadDayAfter(token: string, dayId: number) {
    const day = await api.getSchedule(token, dayId);
    setSchedule(day);
    if (day.status === "draft" && day.assignments.length > 0) {
      try {
        applyAfterPreview(await api.afterPreview(token, day.id));
      } catch {
        applyAfterPreview(null);
      }
    } else {
      applyAfterPreview(null);
    }
    return day;
  }

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const [activePlan, schedules] = await Promise.all([
        api.activeSchedulePlan(token),
        api.schedules(token),
      ]);
      if (activePlan?.days?.length) {
        setPlan(activePlan);
        setPlanDays(activePlan.days);
        const preferred =
          activePlan.days.find((d) => d.status === "draft") ||
          activePlan.days[0];
        await loadDayAfter(token, preferred.id);
      } else {
        setPlan(null);
        setPlanDays([]);
        const summary =
          schedules.find((s) => s.status === "draft") || schedules[0] || null;
        if (summary) {
          await loadDayAfter(token, summary.id);
        } else {
          setSchedule(null);
          applyAfterPreview(null);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "טעינת אפטר נכשלה");
      setPlan(null);
      setPlanDays([]);
      setSchedule(null);
      applyAfterPreview(null);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function selectPlanDay(dayId: number) {
    if (!token || schedule?.id === dayId || switchingDay) return;
    setSwitchingDay(true);
    setError("");
    setOk("");
    try {
      await loadDayAfter(token, dayId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "טעינת היום נכשלה");
    } finally {
      setSwitchingDay(false);
    }
  }

  function toggleAfterCandidate(c: AfterCandidate) {
    if (!schedule || schedule.status !== "draft") return;
    setError("");
    setOk("");
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
    if (!token || !schedule || schedule.status !== "draft") return;
    setBusy(true);
    setError("");
    setOk("");
    try {
      const items: AfterDraftItem[] = Object.entries(afterSelected).map(
        ([pid, times]) => ({
          person_id: Number(pid),
          start_at: new Date(times.start).toISOString(),
          end_at: new Date(times.end).toISOString(),
        })
      );
      const preview = await api.saveAfterDrafts(token, schedule.id, items);
      applyAfterPreview(preview);
      setOk("בחירת האפטר נשמרה לטיוטה");
    } catch (e) {
      setError(e instanceof Error ? e.message : "שמירת אפטר נכשלה");
    } finally {
      setBusy(false);
    }
  }

  const ready =
    schedule &&
    schedule.status === "draft" &&
    afterPreview &&
    schedule.assignments.length > 0;

  const windowLabel = schedule
    ? new Date(schedule.window_start).toLocaleDateString("he-IL", {
        weekday: "short",
        day: "numeric",
        month: "short",
      })
    : null;

  const multiDay = planDays.length > 1;

  return (
    <SettingsAccordion
      title="אפטר — פרגון יציאות"
      hint={
        ready
          ? `מכסה ${afterPreview.after_quota} · ${windowLabel || "טיוטה"}`
          : "נפתח אחרי שיבוץ בטיוטה"
      }
    >
      {error ? <div className="alert alert-danger">{error}</div> : null}
      {ok ? <div className="alert alert-ok">{ok}</div> : null}

      {loading ? (
        <p style={{ color: "var(--ink-soft)", marginTop: 0 }}>טוען…</p>
      ) : !schedule ? (
        <p style={{ color: "var(--ink-soft)", marginTop: 0 }}>
          כדי לפרגן אפטר צריך קודם טיוטת שיבוץ עם אנשים משובצים («שבץ אותי» בטאב
          השיבוץ). הפרגון נשמר סופית רק ב«מאושר לפרסום».
        </p>
      ) : (
        <>
          {multiDay ? (
            <section
              className="schedule-day-picker after-day-picker"
              aria-label="בחירת יום לפרגון אפטר"
            >
              <div className="schedule-day-picker-head">
                <h2>בחירת יום מהתוכנית</h2>
                <span>
                  {plan ? `${plan.days_count} ימים` : ""} · כל יום נשמר בנפרד
                  לטיוטה שלו
                </span>
              </div>
              <div className="day-card-grid" role="tablist">
                {planDays.map((d, idx) => {
                  const active = schedule?.id === d.id;
                  const editable = d.status === "draft";
                  return (
                    <button
                      key={d.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      className={`day-pick-card${active ? " active" : ""}${
                        d.status === "published" ? " published" : ""
                      }`}
                      disabled={busy || switchingDay}
                      onClick={() => void selectPlanDay(d.id)}
                    >
                      <div className="day-pick-card-top">
                        <span className="day-pick-idx">יום {idx + 1}</span>
                        {d.status === "published" ? (
                          <span className="day-pick-badge ok">מפורסם</span>
                        ) : editable ? (
                          <span className="day-pick-badge info">טיוטה</span>
                        ) : (
                          <span className="day-pick-badge muted">—</span>
                        )}
                      </div>
                      <div className="day-pick-date">
                        {dayShortLabel(d.window_start)}
                      </div>
                      <div className="day-pick-foot">
                        <span>
                          {d.assignment_count > 0
                            ? `${d.assignment_count} שיבוצים`
                            : "אין שיבוצים"}
                        </span>
                        <span
                          className={`day-pick-dot ${
                            d.status === "published"
                              ? "ok"
                              : d.assignment_count > 0
                                ? "info"
                                : "muted"
                          }`}
                          aria-hidden
                        />
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          ) : null}

          {!ready ? (
            <p style={{ color: "var(--ink-soft)", marginTop: multiDay ? "1rem" : 0 }}>
              {schedule.status === "published"
                ? "היום שנבחר כבר פורסם — לא ניתן לערוך אפטר עליו. בחרו יום בטיוטה."
                : schedule.assignments.length === 0
                  ? "ביום זה אין עדיין שיבוצים. שבצו קודם בטאב השיבוץ, ואז חזרו לכאן."
                  : "טוען תצוגת אפטר…"}
            </p>
          ) : (
            <>
              <p style={{ color: "var(--ink-soft)", marginTop: multiDay ? "1rem" : 0 }}>
                מכסה: {afterPreview.after_quota} (כוח אדם{" "}
                {afterPreview.total_active} − קנים {afterPreview.min_kanim}
                {windowLabel ? ` · יום ${windowLabel}` : ""}
                ). הרשימה מדורגת לפי מי שפחות יצא לאפטר ב־30 הימים האחרונים —
                ההמלצה אינה מחייבת. נשמר סופית רק ב«מאושר לפרסום».
              </p>
              {switchingDay ? (
                <p style={{ color: "var(--ink-soft)" }}>מחליף יום…</p>
              ) : (
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
                                <span
                                  style={{
                                    color: "var(--danger)",
                                    marginInlineStart: 8,
                                  }}
                                >
                                  ⚠{" "}
                                  {c.sleep_warning_message ||
                                    "ייתכן שלא ישן מספיק"}
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
                                    [c.person_id]: {
                                      ...times,
                                      start: e.target.value,
                                    },
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
                                    [c.person_id]: {
                                      ...times,
                                      end: e.target.value,
                                    },
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
              )}
              <div className="stats after-stats-footer">
                <div className="stat">
                  <span className="label">ניתן לפרגן</span>
                  <span className="value">{afterPreview.after_quota}</span>
                </div>
                <div className="stat">
                  <span className="label">נבחרו</span>
                  <span className="value">
                    {Object.keys(afterSelected).length}
                  </span>
                </div>
                <div className="stat">
                  <span className="label">מועמדים פנויים</span>
                  <span className="value">
                    {afterPreview.candidates.length}
                  </span>
                </div>
              </div>
              <button
                className="btn btn-primary"
                type="button"
                style={{ marginTop: "1rem" }}
                disabled={busy || switchingDay}
                onClick={() => void saveAfterSelections()}
              >
                {busy ? "שומר…" : "שמור בחירת אפטר לטיוטה"}
              </button>
            </>
          )}
        </>
      )}
    </SettingsAccordion>
  );
}
