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
} from "@/lib/api";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function formatLocal(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function AfterGrantsAccordion() {
  const { token } = useAuth();
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [afterPreview, setAfterPreview] = useState<AfterPreview | null>(null);
  const [afterSelected, setAfterSelected] = useState<
    Record<number, { start: string; end: string }>
  >({});
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

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

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const [activePlan, schedules] = await Promise.all([
        api.activeSchedulePlan(token),
        api.schedules(token),
      ]);
      let day: Schedule | null = null;
      if (activePlan?.days?.length) {
        const preferred =
          activePlan.days.find((d) => d.status === "draft") ||
          activePlan.days[0];
        day = await api.getSchedule(token, preferred.id);
      } else {
        day =
          schedules.find((s) => s.status === "draft") || schedules[0] || null;
        if (day) {
          day = await api.getSchedule(token, day.id);
        }
      }
      setSchedule(day);
      if (day && day.status === "draft" && day.assignments.length > 0) {
        try {
          applyAfterPreview(await api.afterPreview(token, day.id));
        } catch {
          applyAfterPreview(null);
        }
      } else {
        applyAfterPreview(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "טעינת אפטר נכשלה");
      setSchedule(null);
      applyAfterPreview(null);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  function toggleAfterCandidate(c: AfterCandidate) {
    if (!schedule) return;
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
    if (!token || !schedule) return;
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
      ) : !ready ? (
        <p style={{ color: "var(--ink-soft)", marginTop: 0 }}>
          כדי לפרגן אפטר צריך קודם טיוטת שיבוץ עם אנשים משובצים («שבץ אותי» בטאב
          השיבוץ). הפרגון נשמר סופית רק ב«מאושר לפרסום».
        </p>
      ) : (
        <>
          <p style={{ color: "var(--ink-soft)", marginTop: 0 }}>
            מכסה: {afterPreview.after_quota} (כוח אדם {afterPreview.total_active}{" "}
            − קנים {afterPreview.min_kanim}
            {windowLabel ? ` · יום ${windowLabel}` : ""}
            ). הרשימה מדורגת לפי מי שפחות יצא לאפטר ב־30 הימים האחרונים — ההמלצה
            אינה מחייבת. נשמר סופית רק ב«מאושר לפרסום».
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
                          <span
                            style={{
                              color: "var(--danger)",
                              marginInlineStart: 8,
                            }}
                          >
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
            onClick={() => void saveAfterSelections()}
          >
            {busy ? "שומר…" : "שמור בחירת אפטר לטיוטה"}
          </button>
        </>
      )}
    </SettingsAccordion>
  );
}
