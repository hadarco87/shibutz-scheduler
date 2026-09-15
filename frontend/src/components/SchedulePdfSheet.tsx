"use client";

import { forwardRef } from "react";
import type { Assignment, Mission, Schedule } from "@/lib/api";

const MISSION_COLORS = [
  "#3f5a32",
  "#b85c38",
  "#2f6b3a",
  "#6a7a2e",
  "#a05a2c",
  "#4a6741",
  "#8b4513",
  "#556b2f",
];

function colorForMissionType(typeId: number) {
  return MISSION_COLORS[Math.abs(typeId) % MISSION_COLORS.length];
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function formatRange(start: string, end: string) {
  const opts: Intl.DateTimeFormatOptions = {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  };
  const s = new Date(start);
  const e = new Date(end);
  return `${s.toLocaleString("he-IL", opts)} → ${e.toLocaleString("he-IL", opts)}`;
}

function formatDayTitle(start: string) {
  return new Date(start).toLocaleDateString("he-IL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function pctInDay(dayStart: Date, dayEnd: Date, t: Date) {
  const total = dayEnd.getTime() - dayStart.getTime();
  if (total <= 0) return 0;
  const clamped = Math.min(
    dayEnd.getTime(),
    Math.max(dayStart.getTime(), t.getTime())
  );
  return ((clamped - dayStart.getTime()) / total) * 100;
}

function assignmentMeta(a: Assignment) {
  const parts = [
    a.person_role_name,
    (a.person_qualification_names || []).join(", ") || null,
  ].filter(Boolean);
  return parts.join(" · ");
}

export type TimelineRow = {
  typeId: number;
  name: string;
  missions: Mission[];
};

type Props = {
  schedule: Schedule;
  companyName: string;
  timelineRows: TimelineRow[];
  includeTimeline: boolean;
};

export const SchedulePdfSheet = forwardRef<HTMLDivElement, Props>(
  function SchedulePdfSheet(
    { schedule, companyName, timelineRows, includeTimeline },
    ref
  ) {
    const missions = [...schedule.missions].sort(
      (a, b) =>
        new Date(a.start_at).getTime() - new Date(b.start_at).getTime() ||
        a.name.localeCompare(b.name, "he")
    );

    const dayStart = new Date(schedule.window_start);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    return (
      <div ref={ref} className="schedule-pdf-sheet" dir="rtl">
        <header className="schedule-pdf-header">
          <div>
            <p className="schedule-pdf-kicker">שיבוץ מפורסם</p>
            <h1>{companyName || "הפלוגה"}</h1>
            <p className="schedule-pdf-sub">
              {formatDayTitle(schedule.window_start)}
            </p>
          </div>
          <div className="schedule-pdf-meta">
            <div>
              <span>משימות</span>
              <strong>{missions.length}</strong>
            </div>
            <div>
              <span>שיבוצים</span>
              <strong>{schedule.assignments.length}</strong>
            </div>
          </div>
        </header>

        {includeTimeline && timelineRows.length > 0 ? (
          <section className="schedule-pdf-timeline">
            <h2>ציר זמן</h2>
            <div className="schedule-pdf-timeline-hours" dir="ltr">
              {Array.from({ length: 13 }, (_, i) => i * 2).map((h) => (
                <span key={h} style={{ left: `${(h / 24) * 100}%` }}>
                  {pad(h)}
                </span>
              ))}
            </div>
            {timelineRows.map((row) => (
              <div key={row.typeId} className="schedule-pdf-timeline-row">
                <div className="schedule-pdf-timeline-label">
                  <span
                    className="schedule-pdf-swatch"
                    style={{ background: colorForMissionType(row.typeId) }}
                  />
                  {row.name}
                </div>
                <div className="schedule-pdf-timeline-track" dir="ltr">
                  {row.missions.map((m) => {
                    const ms = new Date(m.start_at);
                    const me = new Date(m.end_at);
                    const left = pctInDay(dayStart, dayEnd, ms);
                    const right = pctInDay(dayStart, dayEnd, me);
                    const width = Math.max(1.5, right - left);
                    return (
                      <div
                        key={m.id}
                        className="schedule-pdf-timeline-bar"
                        style={{
                          left: `${left}%`,
                          width: `${width}%`,
                          background: colorForMissionType(row.typeId),
                        }}
                      >
                        {pad(ms.getHours())}:{pad(ms.getMinutes())}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </section>
        ) : null}

        <section className="schedule-pdf-missions">
          <h2>פירוט משימות</h2>
          {missions.map((m) => {
            const assigned = schedule.assignments.filter(
              (a) => a.mission_id === m.id
            );
            const under = assigned.length < m.personnel_count;
            return (
              <article key={m.id} className="schedule-pdf-mission">
                <header>
                  <div>
                    <h3>
                      <span
                        className="schedule-pdf-swatch"
                        style={{
                          background: colorForMissionType(m.mission_type_id),
                        }}
                      />
                      {m.name}
                    </h3>
                    <p>
                      קושי {m.difficulty_weight}/5 · {assigned.length}/
                      {m.personnel_count} אנשים
                      {under ? " · חסר איוש" : ""}
                    </p>
                  </div>
                  <div className="schedule-pdf-mission-time">
                    {formatRange(m.start_at, m.end_at)}
                  </div>
                </header>
                {assigned.length === 0 ? (
                  <p className="schedule-pdf-empty">לא מאויש</p>
                ) : (
                  <ul>
                    {assigned.map((a) => {
                      const meta = assignmentMeta(a);
                      return (
                        <li key={a.id}>
                          <strong>{a.person_name}</strong>
                          {meta ? <span>{meta}</span> : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </article>
            );
          })}
        </section>

        <footer className="schedule-pdf-footer">
          נוצר ממערכת שיבוץ · {new Date().toLocaleString("he-IL")}
        </footer>
      </div>
    );
  }
);
