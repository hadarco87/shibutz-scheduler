"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth";
import { api, HistorySummary, Schedule } from "@/lib/api";

const TYPE_COLORS = [
  "#2c5f8a",
  "#3f5a32",
  "#b85c38",
  "#9a6b16",
  "#1f6f5a",
  "#8b3a4a",
  "#4a5f8a",
  "#6a7a2e",
  "#a05a2c",
  "#5a4a3a",
  "#2a6a7a",
  "#7a5a2a",
];

function colorForType(name: string, index: number) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return TYPE_COLORS[(index + h) % TYPE_COLORS.length];
}

function formatHours(n: number) {
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}` : `${rounded}`;
}

type Period = 7 | 30 | 90 | "all";

export default function HistoryPage() {
  const { token } = useAuth();
  const [summary, setSummary] = useState<HistorySummary | null>(null);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [selected, setSelected] = useState<Schedule | null>(null);
  const [error, setError] = useState("");
  const [period, setPeriod] = useState<Period>(30);
  const [query, setQuery] = useState("");
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  const [showZero, setShowZero] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    if (!token) return;
    const days = period === "all" ? undefined : period;
    Promise.all([
      api.historySummary(token, days),
      api.schedules(token),
    ])
      .then(([hist, sched]) => {
        setSummary(hist);
        setSchedules(sched.filter((x) => x.status === "published"));
      })
      .catch((e) => setError(e.message));
  }, [token, period]);

  const typeColors = useMemo(() => {
    const map = new Map<string, string>();
    (summary?.mission_types || []).forEach((t, i) => {
      map.set(t, colorForType(t, i));
    });
    return map;
  }, [summary]);

  const visibleTypes = useMemo(
    () => (summary?.mission_types || []).filter((t) => !hiddenTypes.has(t)),
    [summary, hiddenTypes]
  );

  const rows = useMemo(() => {
    if (!summary) return [];
    const q = query.trim().toLowerCase();
    return summary.people
      .map((p) => {
        const by: Record<string, number> = {};
        let total = 0;
        for (const t of visibleTypes) {
          const h = p.by_mission_type[t] || 0;
          if (h > 0) {
            by[t] = h;
            total += h;
          }
        }
        return { ...p, by_mission_type: by, total_hours: total };
      })
      .filter((p) => {
        if (q && !p.person_name.toLowerCase().includes(q)) return false;
        if (!showZero && p.total_hours <= 0) return false;
        return true;
      })
      .sort((a, b) => b.total_hours - a.total_hours);
  }, [summary, query, visibleTypes, showZero]);

  const maxHours = useMemo(
    () => Math.max(1, ...rows.map((r) => r.total_hours), 1),
    [rows]
  );

  function toggleType(name: string) {
    setHiddenTypes((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  return (
    <AppShell>
      <section className="panel">
        <h1 style={{ marginTop: 0 }}>היסטוריית שיבוצים</h1>
        <p style={{ color: "var(--ink-soft)", marginTop: 0 }}>
          שעות משימה משובצות לפי חייל וסוג משימה — רק משיבוצים שפורסמו.
          שונה ממדד עומס (שמכפיל בקושי).
        </p>
        {error ? <div className="alert alert-danger">{error}</div> : null}

        <div className="filter-bar" role="search" aria-label="סינון היסטוריה">
          <input
            className="filter-bar-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="חיפוש שם…"
            aria-label="חיפוש לפי שם"
          />
          <select
            value={period}
            onChange={(e) =>
              setPeriod(
                e.target.value === "all" ? "all" : (Number(e.target.value) as Period)
              )
            }
            aria-label="תקופה"
          >
            <option value={7}>7 ימים</option>
            <option value={30}>30 ימים</option>
            <option value={90}>90 ימים</option>
            <option value="all">הכל</option>
          </select>
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.35rem",
              fontSize: "0.88rem",
              color: "var(--ink-soft)",
              whiteSpace: "nowrap",
            }}
          >
            <input
              type="checkbox"
              checked={showZero}
              onChange={(e) => setShowZero(e.target.checked)}
            />
            הצג ללא שעות
          </label>
          <div className="filter-bar-meta">
            <span>
              {rows.length} חיילים
              {summary ? ` · ${summary.published_schedules} שיבוצים` : ""}
            </span>
          </div>
        </div>

        {summary && summary.mission_types.length > 0 ? (
          <div className="history-legend" aria-label="מקרא סוגי משימות">
            {summary.mission_types.map((t) => {
              const on = !hiddenTypes.has(t);
              return (
                <button
                  key={t}
                  type="button"
                  className={`history-legend-item ${on ? "" : "is-off"}`}
                  onClick={() => toggleType(t)}
                  title={on ? "לחצו להסתרה" : "לחצו להצגה"}
                >
                  <span
                    className="history-swatch"
                    style={{ background: typeColors.get(t) }}
                  />
                  {t}
                </button>
              );
            })}
          </div>
        ) : null}
      </section>

      <section className="panel">
        <h2 style={{ marginTop: 0, fontSize: "1.05rem" }}>
          שעות משימה משובצות לפי חייל
        </h2>
        {!summary ? (
          <p style={{ color: "var(--ink-soft)" }}>טוען…</p>
        ) : rows.length === 0 ? (
          <p style={{ color: "var(--ink-soft)" }}>
            אין נתונים לתקופה שנבחרה. פרסמו שיבוץ כדי לצבור היסטוריה.
          </p>
        ) : (
          <div className="history-chart" role="img" aria-label="גרף שעות לפי חייל">
            <div className="history-chart-axis">
              <span>0</span>
              <span>{formatHours(maxHours / 2)}</span>
              <span>{formatHours(maxHours)} ש׳</span>
            </div>
            {rows.map((p) => (
              <div key={p.person_id} className="history-row">
                <div className="history-name" title={p.person_name}>
                  {p.person_name}
                </div>
                <div className="history-track" dir="ltr">
                  <div
                    className="history-stack"
                    style={{ width: `${(p.total_hours / maxHours) * 100}%` }}
                  >
                    {visibleTypes.map((t) => {
                      const h = p.by_mission_type[t] || 0;
                      if (h <= 0) return null;
                      const pct =
                        p.total_hours > 0 ? (h / p.total_hours) * 100 : 0;
                      return (
                        <span
                          key={t}
                          className="history-seg"
                          style={{
                            width: `${pct}%`,
                            background: typeColors.get(t),
                          }}
                          title={`${t}: ${formatHours(h)} ש׳`}
                        />
                      );
                    })}
                  </div>
                </div>
                <div className="history-total">{formatHours(p.total_hours)}ש׳</div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => setDetailsOpen((v) => !v)}
          style={{ marginBottom: detailsOpen ? "0.75rem" : 0 }}
        >
          {detailsOpen ? "▼" : "◀"} פירוט לפי שיבוץ שפורסם
        </button>
        {detailsOpen ? (
          <>
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>חלון</th>
                  <th>פורסם</th>
                  <th>משימות</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {schedules.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ color: "var(--ink-soft)" }}>
                      עדיין אין שיבוצים שפורסמו
                    </td>
                  </tr>
                ) : (
                  schedules.map((s) => (
                    <tr key={s.id}>
                      <td>{s.id}</td>
                      <td>
                        {new Date(s.window_start).toLocaleString("he-IL")} →{" "}
                        {new Date(s.window_end).toLocaleString("he-IL")}
                      </td>
                      <td>
                        {s.published_at
                          ? new Date(s.published_at).toLocaleString("he-IL")
                          : "—"}
                      </td>
                      <td>{s.missions.length}</td>
                      <td>
                        <button
                          className="btn btn-ghost btn-small"
                          type="button"
                          onClick={() =>
                            setSelected(selected?.id === s.id ? null : s)
                          }
                        >
                          {selected?.id === s.id ? "סגור" : "הצג"}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            {selected ? (
              <div className="mission-list" style={{ marginTop: "1rem" }}>
                <h3 style={{ marginTop: 0 }}>שיבוץ #{selected.id}</h3>
                {selected.missions.map((m) => {
                  const assigned = selected.assignments.filter(
                    (a) => a.mission_id === m.id
                  );
                  return (
                    <article key={m.id} className="mission-card">
                      <header>
                        <h3>{m.name}</h3>
                        <span className="time">
                          {new Date(m.start_at).toLocaleString("he-IL")}
                        </span>
                      </header>
                      <div className="people-chips">
                        {assigned.map((a) => (
                          <span key={a.id} className="chip">
                            {a.person_name}
                          </span>
                        ))}
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : null}
          </>
        ) : null}
      </section>
    </AppShell>
  );
}
