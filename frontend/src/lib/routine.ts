export type RemainderPolicy = "include_short" | "full_only";

export function routineCoversFullDay(durationHours: number): boolean {
  if (durationHours <= 0) return false;
  const steps = Math.round((24 / durationHours) * 1e6) / 1e6;
  return Math.abs(steps - Math.round(steps)) < 1e-6;
}

export function buildRoutineSegments(
  durationHours: number,
  startHour: number,
  remainderPolicy: RemainderPolicy = "include_short"
): { startHour: number; length: number }[] {
  if (durationHours <= 0) return [];
  const segments: { startHour: number; length: number }[] = [];
  let elapsed = 0;
  let t = startHour;
  while (elapsed + durationHours <= 24 + 1e-9) {
    segments.push({ startHour: ((t % 24) + 24) % 24, length: durationHours });
    t += durationHours;
    elapsed += durationHours;
  }
  const rem = Math.round((24 - elapsed) * 1e6) / 1e6;
  if (rem > 1e-6 && remainderPolicy === "include_short") {
    segments.push({ startHour: ((t % 24) + 24) % 24, length: rem });
  }
  return segments;
}

export function formatHourLabel(hour: number): string {
  const h = Math.floor(hour) % 24;
  const m = Math.round((hour - Math.floor(hour)) * 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function formatSegmentLabel(startHour: number, length: number): string {
  const end = startHour + length;
  const endLabel = formatHourLabel(((end % 24) + 24) % 24);
  const crosses = end >= 24;
  return `${formatHourLabel(startHour)}–${endLabel}${crosses ? " (ליום הבא)" : ""}`;
}

/** Shifts that overlap [windowStart, windowEnd), including overnight carry-in. */
export function routineShiftsForWindow(
  durationHours: number,
  startHour: number,
  remainderPolicy: RemainderPolicy,
  windowStart: string,
  windowEnd: string
): { start: Date; end: Date }[] {
  const ws = new Date(windowStart);
  const we = new Date(windowEnd);
  const hours = durationHours || 4;
  const out: { start: Date; end: Date }[] = [];

  const day = new Date(ws);
  day.setHours(0, 0, 0, 0);
  day.setDate(day.getDate() - 1);
  const last = new Date(we.getTime() - 1);
  last.setHours(0, 0, 0, 0);

  for (let d = new Date(day); d <= last; d.setDate(d.getDate() + 1)) {
    for (const seg of buildRoutineSegments(hours, startHour, remainderPolicy)) {
      const start = new Date(d);
      const h = Math.floor(seg.startHour);
      const m = Math.round((seg.startHour - h) * 60);
      start.setHours(h, m, 0, 0);
      const end = new Date(start.getTime() + seg.length * 3600000);
      if (!(start < we && end > ws)) continue;
      out.push({ start, end });
    }
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}

export function dayMatchesRecurrence(
  day: Date,
  kind: "daily" | "every_n_days" | "weekly" | string | null | undefined,
  opts: {
    intervalDays?: number | null;
    weekdays?: string | null;
    anchorDate?: string | null;
  } = {}
): boolean {
  const day0 = new Date(day);
  day0.setHours(0, 0, 0, 0);
  const k = (kind || "daily").toLowerCase();
  if (k === "daily") return true;
  if (k === "every_n_days") {
    const interval = Math.max(Number(opts.intervalDays) || 1, 1);
    if (interval <= 1) return true;
    if (!opts.anchorDate) return false;
    const anchor = new Date(opts.anchorDate);
    anchor.setHours(0, 0, 0, 0);
    const delta = Math.round(
      (day0.getTime() - anchor.getTime()) / (24 * 3600 * 1000)
    );
    return delta >= 0 && delta % interval === 0;
  }
  if (k === "weekly") {
    const raw = (opts.weekdays || "").trim();
    if (!raw) return false;
    const days = new Set(
      raw
        .split(",")
        .map((x) => Number(x.trim()))
        .filter((n) => Number.isFinite(n))
    );
    // JS: 0=Sun … 6=Sat; Python stored: 0=Mon … 6=Sun
    const js = day0.getDay();
    const py = js === 0 ? 6 : js - 1;
    return days.has(py);
  }
  return false;
}

/** Routine shifts for a schedule window, honoring day recurrence + hours mode. */
export function routineMissionsForWindow(
  mt: {
    default_duration_hours?: number | null;
    recurring_start_hour?: number | null;
    routine_remainder_policy?: RemainderPolicy | string | null;
    recurrence_kind?: string | null;
    recurrence_interval_days?: number | null;
    recurrence_weekdays?: string | null;
    recurrence_anchor_date?: string | null;
    routine_hours_mode?: string | null;
    time_windows?: { start_minute: number; end_minute: number }[] | null;
  },
  windowStart: string,
  windowEnd: string
): { start: Date; end: Date }[] {
  const ws = new Date(windowStart);
  const we = new Date(windowEnd);
  const day = new Date(ws);
  day.setHours(0, 0, 0, 0);
  day.setDate(day.getDate() - 1);
  const last = new Date(we.getTime() - 1);
  last.setHours(0, 0, 0, 0);
  const mode = (mt.routine_hours_mode || "uniform").toLowerCase();
  const out: { start: Date; end: Date }[] = [];

  for (let d = new Date(day); d <= last; d.setDate(d.getDate() + 1)) {
    if (
      !dayMatchesRecurrence(d, mt.recurrence_kind, {
        intervalDays: mt.recurrence_interval_days,
        weekdays: mt.recurrence_weekdays,
        anchorDate: mt.recurrence_anchor_date,
      })
    ) {
      continue;
    }
    if (mode === "custom") {
      const windows = mt.time_windows || [];
      for (const w of windows) {
        const start = new Date(d);
        start.setHours(0, 0, 0, 0);
        start.setMinutes(w.start_minute);
        const end = new Date(d);
        end.setHours(0, 0, 0, 0);
        end.setMinutes(w.end_minute);
        if (w.end_minute <= w.start_minute) {
          end.setDate(end.getDate() + 1);
        }
        if (!(start < we && end > ws)) continue;
        if (end <= start) continue;
        out.push({ start, end });
      }
    } else {
      if (mt.recurring_start_hour == null) continue;
      const policy =
        mt.routine_remainder_policy === "full_only"
          ? "full_only"
          : "include_short";
      for (const seg of buildRoutineSegments(
        mt.default_duration_hours || 4,
        mt.recurring_start_hour,
        policy
      )) {
        const start = new Date(d);
        const h = Math.floor(seg.startHour);
        const m = Math.round((seg.startHour - h) * 60);
        start.setHours(h, m, 0, 0);
        const end = new Date(start.getTime() + seg.length * 3600000);
        if (!(start < we && end > ws)) continue;
        out.push({ start, end });
      }
    }
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}

export function startAndDurationToWindow(
  startMinute: number,
  durationHours: number
): { start_minute: number; end_minute: number } {
  const start = ((startMinute % 1440) + 1440) % 1440;
  const mins = Math.max(1, Math.round(durationHours * 60));
  const end = (start + mins) % 1440;
  return { start_minute: start, end_minute: end === start ? (start + 1) % 1440 : end };
}

export function windowToDurationHours(
  startMinute: number,
  endMinute: number
): number {
  let delta = endMinute - startMinute;
  if (delta <= 0) delta += 1440;
  return Math.round((delta / 60) * 100) / 100;
}

export function parseTimeToMinute(value: string): number | null {
  const raw = value.trim().replace(".", ":");
  let hour: number;
  let minute: number;
  if (raw.includes(":")) {
    const [h, m] = raw.split(":");
    hour = Number(h);
    minute = Number(m);
  } else if (/^\d{3,4}$/.test(raw)) {
    hour = Number(raw.slice(0, -2));
    minute = Number(raw.slice(-2));
  } else {
    return null;
  }
  if (
    !Number.isFinite(hour) ||
    !Number.isFinite(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }
  return hour * 60 + minute;
}

export function formatMinute(minute: number): string {
  const m = ((minute % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** end_minute <= start_minute ⇒ overnight (ends next calendar day). */
export function windowShiftsForRange(
  windows: { start_minute: number; end_minute: number }[],
  windowStart: string,
  windowEnd: string
): { start: Date; end: Date }[] {
  const ws = new Date(windowStart);
  const we = new Date(windowEnd);
  if (!windows.length) return [];
  const out: { start: Date; end: Date }[] = [];
  const day = new Date(ws);
  day.setHours(0, 0, 0, 0);
  const last = new Date(we.getTime() - 1);
  last.setHours(0, 0, 0, 0);

  for (let d = new Date(day); d <= last; d.setDate(d.getDate() + 1)) {
    for (const w of windows) {
      const start = new Date(d);
      start.setHours(0, 0, 0, 0);
      start.setMinutes(w.start_minute);
      const end = new Date(d);
      end.setHours(0, 0, 0, 0);
      end.setMinutes(w.end_minute);
      if (w.end_minute <= w.start_minute) {
        end.setDate(end.getDate() + 1);
      }
      if (!(ws <= start && start < we)) continue;
      if (end <= start) continue;
      out.push({ start, end });
    }
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}

function minuteInBand(minute: number, startMinute: number, endMinute: number) {
  const m = ((minute % 1440) + 1440) % 1440;
  const s = ((startMinute % 1440) + 1440) % 1440;
  const e = ((endMinute % 1440) + 1440) % 1440;
  if (s === e) return true;
  if (s < e) return s <= m && m < e;
  return m >= s || m < e;
}

export function resolveStaffingForStart(
  start: Date,
  mt: {
    default_personnel_count: number;
    default_requirements: {
      role_id?: number | null;
      qualification_id?: number | null;
      count: number;
      exact_role?: boolean;
      exact_qualification?: boolean;
    }[];
    staffing_bands?: {
      label?: string | null;
      start_minute: number;
      end_minute: number;
      personnel_count: number;
      requirements: {
        role_id?: number | null;
        qualification_id?: number | null;
        count: number;
        exact_role?: boolean;
        exact_qualification?: boolean;
      }[];
    }[];
  }
): {
  personnel_count: number;
  requirements: {
    role_id?: number | null;
    qualification_id?: number | null;
    count: number;
    exact_role?: boolean;
    exact_qualification?: boolean;
  }[];
  band_label?: string | null;
} {
  const minute = start.getHours() * 60 + start.getMinutes();
  for (const b of mt.staffing_bands || []) {
    if (minuteInBand(minute, b.start_minute, b.end_minute)) {
      return {
        personnel_count: Math.max(1, b.personnel_count),
        requirements: b.requirements || [],
        band_label: b.label,
      };
    }
  }
  return {
    personnel_count: Math.max(1, mt.default_personnel_count),
    requirements: mt.default_requirements || [],
  };
}
