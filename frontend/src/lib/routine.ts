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

/** Shifts whose start falls inside [windowStart, windowEnd). */
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
  const last = new Date(we.getTime() - 1);
  last.setHours(0, 0, 0, 0);

  for (let d = new Date(day); d <= last; d.setDate(d.getDate() + 1)) {
    for (const seg of buildRoutineSegments(hours, startHour, remainderPolicy)) {
      const start = new Date(d);
      const h = Math.floor(seg.startHour);
      const m = Math.round((seg.startHour - h) * 60);
      start.setHours(h, m, 0, 0);
      if (!(ws <= start && start < we)) continue;
      const end = new Date(start.getTime() + seg.length * 3600000);
      out.push({ start, end });
    }
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
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
      }[];
    }[];
  }
): {
  personnel_count: number;
  requirements: {
    role_id?: number | null;
    qualification_id?: number | null;
    count: number;
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
