"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useConfirm } from "@/components/ConfirmDialog";
import { SchedulePdfSheet } from "@/components/SchedulePdfSheet";
import { SchedulingHowItWorksButton } from "@/components/SchedulingHowItWorks";
import { useAuth } from "@/lib/auth";
import {
  api,
  MissionType,
  Person,
  Schedule,
  SchedulePlan,
  SchedulingResult,
  ReplacementOptions,
} from "@/lib/api";
import { routineMissionsForWindow, resolveStaffingForStart, windowShiftsForRange } from "@/lib/routine";
import {
  downloadBlob,
  elementToPdfBlob,
  schedulePdfFilename,
  sharePdfViaWhatsApp,
} from "@/lib/schedulePdf";
import { assignmentsForMission, openSlotsForMission } from "@/lib/assignmentOrder";

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
  const { token, user } = useAuth();
  const confirm = useConfirm();
  const pdfRef = useRef<HTMLDivElement>(null);
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [plan, setPlan] = useState<SchedulePlan | null>(null);
  const [planDaysCount, setPlanDaysCount] = useState(1);
  const [planStartKind, setPlanStartKind] = useState<"today" | "tomorrow">(
    "tomorrow"
  );
  const [people, setPeople] = useState<Person[]>([]);
  const [missionTypes, setMissionTypes] = useState<MissionType[]>([]);
  const [result, setResult] = useState<SchedulingResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyMessage, setBusyMessage] = useState("מעבד נתונים…");
  const [pdfBusy, setPdfBusy] = useState(false);
  const [publishShareOpen, setPublishShareOpen] = useState(false);
  const [autoPdfAfterPublish, setAutoPdfAfterPublish] = useState(false);
  const [replaceFor, setReplaceFor] = useState<number | null>(null);
  const [replacePersonId, setReplacePersonId] = useState<number | "">("");
  const [replaceOptions, setReplaceOptions] = useState<ReplacementOptions | null>(
    null
  );
  const [replaceMode, setReplaceMode] = useState<"matching" | "all">("matching");
  const [replaceLoading, setReplaceLoading] = useState(false);
  const [rosterOpen, setRosterOpen] = useState(false);
  const [wipeOpen, setWipeOpen] = useState(false);
  const [wipeOperational, setWipeOperational] = useState(false);
  const [wipeCatalog, setWipeCatalog] = useState(false);
  const [wipePeople, setWipePeople] = useState(false);
  const [wipeBusy, setWipeBusy] = useState(false);
  const [scrollToUnderstaffed, setScrollToUnderstaffed] = useState(false);

  async function loadDaySchedule(
    token: string,
    dayId: number,
    opts?: { sync?: boolean }
  ): Promise<Schedule> {
    let day = await api.getSchedule(token, dayId);
    if (opts?.sync !== false && day.status === "draft") {
      try {
        day = await api.syncScheduleMissions(token, day.id);
      } catch {
        /* keep loaded day if sync fails */
      }
    }
    setSchedule(day);
    return day;
  }

  const load = useCallback(async () => {
    if (!token) return;
    const [activePlan, schedules, roster, types] = await Promise.all([
      api.activeSchedulePlan(token),
      api.schedules(token),
      api.people(token),
      api.missionTypes(token),
    ]);
    setPeople(roster.filter((p) => p.is_active));
    setMissionTypes(types);

    if (activePlan && activePlan.days.length) {
      setPlan(activePlan);
      setPlanDaysCount(activePlan.days_count);
      setPlanStartKind(
        sameCalendarDay(
          new Date(activePlan.days[0].window_start),
          calendarDayWindow("today").start
        )
          ? "today"
          : "tomorrow"
      );
      await loadDaySchedule(token, activePlan.days[0].id);
      return;
    }

    setPlan(null);
    let draft =
      schedules.find((s) => s.status === "draft") || schedules[0] || null;
    if (draft && draft.status === "draft") {
      try {
        draft = await api.syncScheduleMissions(token, draft.id);
      } catch {
        /* keep loaded draft if sync fails */
      }
    }
    setSchedule(draft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);

  useEffect(() => {
    if (!scrollToUnderstaffed || !schedule || busy) return;
    const firstGap = schedule.missions.find((m) => {
      const assigned = schedule.assignments.filter((a) => a.mission_id === m.id)
        .length;
      return assigned < m.personnel_count;
    });
    if (!firstGap) {
      setScrollToUnderstaffed(false);
      return;
    }
    const t = window.setTimeout(() => {
      document
        .getElementById(`mission-card-${firstGap.id}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
      setScrollToUnderstaffed(false);
    }, 80);
    return () => window.clearTimeout(t);
  }, [scrollToUnderstaffed, schedule, busy]);

  const availableCount = people.length;
  const missionCount = schedule?.missions.length || 0;
  const conflictCount = result?.conflicts.length || 0;

  const staffing = useMemo(() => {
    if (!schedule) return { needed: 0, filled: 0, shortfall: 0 };
    let needed = 0;
    let filled = 0;
    for (const m of schedule.missions) {
      needed += m.personnel_count;
      const assigned = schedule.assignments.filter((a) => a.mission_id === m.id)
        .length;
      filled += Math.min(m.personnel_count, assigned);
    }
    return { needed, filled, shortfall: Math.max(0, needed - filled) };
  }, [schedule]);

  const assignedPeopleCount = useMemo(() => {
    if (!schedule) return 0;
    return new Set(schedule.assignments.map((a) => a.person_id)).size;
  }, [schedule]);

  const scheduleStatusLabel =
    schedule?.status === "published" || plan?.status === "published"
      ? "published"
      : schedule
        ? "draft"
        : "empty";

  const warningCount = result?.warnings?.length || 0;
  const hasRunResult = result != null;

  const conflictMetric = useMemo(() => {
    if (conflictCount > 0) {
      return {
        tone: "warn" as const,
        text: "דורש טיפול לפני פרסום",
      };
    }
    if (hasRunResult) {
      return {
        tone: "ok" as const,
        text:
          warningCount > 0
            ? `ללא קונפליקטים · ${warningCount} אזהרות`
            : "הריצה האחרונה ללא קונפליקטים",
      };
    }
    return null;
  }, [conflictCount, hasRunResult, warningCount]);

  const nextScopeHint = useMemo(() => {
    if (planStartKind === "today") {
      return "השיבוץ הבא יופעל על היום · יממה אחת";
    }
    if (planDaysCount === 1) {
      return "השיבוץ הבא יופעל על מחר · יממה אחת";
    }
    return `השיבוץ הבא יופעל ממחר · ${planDaysCount} ימים`;
  }, [planStartKind, planDaysCount]);

  const selectedScopeDisplay = useMemo(() => {
    const short: Intl.DateTimeFormatOptions = {
      day: "numeric",
      month: "short",
    };
    if (planStartKind === "today") {
      const d = calendarDayWindow("today").start;
      return {
        title: formatDayTitle(d),
        chip: "יום אחד",
        kicker: "יעד לשיבוץ",
      };
    }
    const start = calendarDayWindow("tomorrow").start;
    if (planDaysCount <= 1) {
      return {
        title: formatDayTitle(start),
        chip: "יום אחד",
        kicker: "יעד לשיבוץ",
      };
    }
    const end = new Date(start);
    end.setDate(end.getDate() + planDaysCount - 1);
    return {
      title: `${start.toLocaleDateString("he-IL", short)} – ${end.toLocaleDateString("he-IL", short)}`,
      chip: `${planDaysCount} ימים`,
      kicker: "יעד לשיבוץ",
    };
  }, [planStartKind, planDaysCount]);

  const viewingDiffersFromSelection = useMemo(() => {
    if (!schedule) return false;
    if (plan && plan.days.length > 1) {
      return !(
        plan.days_count === planDaysCount &&
        planStartKind === "tomorrow" &&
        sameCalendarDay(
          new Date(plan.days[0].window_start),
          calendarDayWindow("tomorrow").start
        )
      );
    }
    const want = calendarDayWindow(
      planStartKind === "today" ? "today" : "tomorrow"
    ).start;
    return (
      planDaysCount !== 1 ||
      !sameCalendarDay(new Date(schedule.window_start), want)
    );
  }, [schedule, plan, planStartKind, planDaysCount]);

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
          exact_role: Boolean(r.exact_role),
          exact_qualification: r.exact_qualification !== false,
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
      const ok = await confirm({
        title: "הסרת משימה מהחלון",
        message: `להסיר את «${mt.name}» מחלון השיבוץ (${existing.length} מופעים)?`,
        confirmLabel: "הסר",
        tone: "danger",
      });
      if (!ok) {
        return;
      }
      startBusy("מעדכן משימות…");
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
        stopBusy();
      }
      return;
    }

    startBusy("מעדכן משימות…");
    setError("");
    try {
      if (mt.is_recurring_template) {
        const shifts = routineMissionsForWindow(
          mt,
          schedule.window_start,
          schedule.window_end
        );
        if (!shifts.length) {
          setError(
            `«${mt.name}» לא נופלת על חלון השיבוץ הזה לפי התדירות/השעות שהוגדרו`
          );
          return;
        }
        await createMissions(mt, shifts, false);
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
      stopBusy();
    }
  }

  function startBusy(message = "מעבד נתונים…") {
    setBusyMessage(message);
    setBusy(true);
  }

  function stopBusy() {
    setBusy(false);
  }

  async function selectPlanDay(dayId: number, opts?: { jumpToGap?: boolean }) {
    if (!token || !plan) return;
    if (schedule?.id === dayId) {
      if (opts?.jumpToGap) setScrollToUnderstaffed(true);
      return;
    }
    startBusy("טוען יום…");
    setError("");
    setResult(null);
    try {
      await loadDaySchedule(token, dayId);
      if (opts?.jumpToGap) setScrollToUnderstaffed(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "טעינת היום נכשלה");
    } finally {
      stopBusy();
    }
  }

  async function refreshPlanKeepingDay(planOut: SchedulePlan, dayId?: number) {
    if (!token) return;
    setPlan(planOut);
    const keepId =
      dayId ??
      (schedule && planOut.days.some((d) => d.id === schedule.id)
        ? schedule.id
        : planOut.days[0]?.id);
    if (keepId) {
      await loadDaySchedule(token, keepId);
    }
  }

  async function createWindow(which: "today" | "tomorrow", opts?: { silent?: boolean }) {
    if (!token) return null;
    if (!opts?.silent && plan && plan.status === "draft") {
      const label = which === "today" ? "היום" : "מחר";
      const ok = await confirm({
        title: "תוכנית שיבוץ חדשה",
        message: `ליצור תוכנית חדשה ל${label}?\nהטיוטה הנוכחית תישאר; התוכנית החדשה תהפוך לפעילה.`,
        confirmLabel: "צור תוכנית",
      });
      if (!ok) return null;
    }
    startBusy("יוצר תוכנית שיבוץ…");
    setError("");
    setResult(null);
    try {
      const created = await api.createSchedulePlan(token, {
        days_count: 1,
        start_kind: which,
        instantiate_recurring: true,
        generate: false,
      });
      setPlan(created);
      setPlanDaysCount(1);
      setPlanStartKind(which);
      if (created.days[0]) {
        await loadDaySchedule(token, created.days[0].id);
      }
      return created;
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה");
      return null;
    } finally {
      stopBusy();
    }
  }

  function generateButtonLabel() {
    if (planStartKind === "today" && planDaysCount === 1) {
      return "שבץ אותי להיום";
    }
    if (planDaysCount <= 1) {
      return "שבץ אותי למחר";
    }
    return `שבץ ל־${planDaysCount} ימים קדימה`;
  }

  async function onGeneratePlan(scope: "all_draft" | "day" = "all_draft") {
    if (!token) return;

    const wantToday = planStartKind === "today" && planDaysCount === 1;
    const wantDays = wantToday ? 1 : Math.max(1, Math.min(7, planDaysCount));
    const wantKind: "today" | "tomorrow" = wantToday ? "today" : "tomorrow";
    const existing = plan;

    const matchedPlan =
      existing &&
      existing.status === "draft" &&
      existing.days_count === wantDays &&
      existing.days[0] &&
      sameCalendarDay(
        new Date(existing.days[0].window_start),
        calendarDayWindow(wantKind).start
      )
        ? existing
        : null;

    if (!matchedPlan) {
      if (existing && existing.status === "draft") {
        const ok = await confirm({
          title: "תוכנית שיבוץ חדשה",
          message:
            "כבר יש טיוטת תוכנית פתוחה. ליצור תוכנית חדשה לפי הטווח שנבחר?\nהטיוטה הקודמת תישאר בהיסטוריה.",
          confirmLabel: "צור תוכנית חדשה",
        });
        if (!ok) return;
      }
    } else if (scope === "all_draft" && matchedPlan.days_count > 1) {
      const ok = await confirm({
        title: "שיבוץ מחדש לכל הימים",
        message:
          "לשבץ מחדש את כל ימי הטיוטה בתוכנית?\nימים שכבר פורסמו לא יידרסו.\nלשיבוץ יום בודד השתמשו ב«שבץ מחדש יום זה».",
        confirmLabel: "שבץ את כל הימים",
      });
      if (!ok) return;
    }

    const schedulingLabel =
      scope === "day"
        ? "משבץ את היום הנוכחי…"
        : wantDays > 1
          ? `משבץ ${wantDays} ימים — זה עשוי לקחת כמה רגעים…`
          : "משבץ עכשיו…";
    startBusy(schedulingLabel);
    setError("");
    try {
      if (!matchedPlan) {
        const created = await api.createSchedulePlan(token, {
          days_count: wantDays,
          start_kind: wantKind,
          instantiate_recurring: true,
          generate: true,
        });
        await refreshPlanKeepingDay(created, created.days[0]?.id);
        setResult(null);
        return;
      }

      const dayId = schedule?.id;
      if (scope === "day" && dayId) {
        const res = await api.generate(token, dayId);
        setResult(res);
        setSchedule(res.schedule);
        const refreshed = await api.getSchedulePlan(token, matchedPlan.id);
        setPlan(refreshed);
        return;
      }

      const regenerated = await api.generateSchedulePlan(token, matchedPlan.id, {
        scope: "all_draft",
      });
      await refreshPlanKeepingDay(regenerated, dayId);
      setResult(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה בשיבוץ");
    } finally {
      stopBusy();
    }
  }

  async function onGenerateDayOnly() {
    if (!token || !plan || !schedule || schedule.status !== "draft") return;
    await onGeneratePlan("day");
  }

  async function onPublish() {
    if (!token || !schedule) return;
    const multi = plan && plan.days_count > 1;
    const ok = await confirm({
      title: multi ? "פרסום תוכנית שיבוץ" : "פרסום שיבוץ",
      message: multi
        ? "לאשר ולפרסם את כל ימי התוכנית?\nפעולה זו תעדכן את מדד העומס ואת האפטרים לכל הימים יחד."
        : "לאשר ולפרסם את השיבוץ?\nפעולה זו תעדכן את מדד העומס.",
      confirmLabel: multi ? "פרסם את כל התקופה" : "פרסם",
      tone: "accent",
    });
    if (!ok) return;
    startBusy(multi ? "מפרסם את כל התקופה…" : "מפרסם שיבוץ…");
    setError("");
    try {
      if (plan) {
        const published = await api.publishSchedulePlan(token, plan.id);
        await refreshPlanKeepingDay(published, schedule.id);
      } else {
        const published = await api.publish(token, schedule.id);
        setSchedule(published);
      }
      setResult(null);
      setPublishShareOpen(true);
      setAutoPdfAfterPublish(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "פרסום נכשל");
    } finally {
      stopBusy();
    }
  }

  async function buildPdfBlob(): Promise<Blob> {
    if (!schedule) throw new Error("אין שיבוץ לייצוא");
    await new Promise((r) => window.requestAnimationFrame(() => r(null)));
    await new Promise((r) => window.setTimeout(r, 30));
    const el = pdfRef.current;
    if (!el) throw new Error("לא ניתן להפיק PDF כרגע");
    return elementToPdfBlob(el);
  }

  async function buildAndDownloadPdf() {
    if (!schedule) return;
    setPdfBusy(true);
    setError("");
    try {
      const blob = await buildPdfBlob();
      const name = schedulePdfFilename(
        user?.company_name || "pluga",
        schedule.window_start
      );
      downloadBlob(blob, name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "הפקת PDF נכשלה");
    } finally {
      setPdfBusy(false);
    }
  }

  async function buildAndDownloadAllPlanPdfs() {
    if (!token || !plan || !plan.days.length) {
      await buildAndDownloadPdf();
      return;
    }
    setPdfBusy(true);
    setError("");
    const previousId = schedule?.id;
    try {
      for (const day of plan.days) {
        await loadDaySchedule(token, day.id, { sync: false });
        await new Promise((r) => window.requestAnimationFrame(() => r(null)));
        await new Promise((r) => window.setTimeout(r, 40));
        const blob = await buildPdfBlob();
        const name = schedulePdfFilename(
          user?.company_name || "pluga",
          day.window_start
        );
        downloadBlob(blob, name);
        await new Promise((r) => window.setTimeout(r, 200));
      }
      if (previousId) {
        await loadDaySchedule(token, previousId, { sync: false });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "הפקת PDF נכשלה");
    } finally {
      setPdfBusy(false);
    }
  }

  async function sharePublishedPdf() {
    if (!schedule) return;
    setPdfBusy(true);
    setError("");
    try {
      const blob = await buildPdfBlob();
      const name = schedulePdfFilename(
        user?.company_name || "pluga",
        schedule.window_start
      );
      const day = new Date(schedule.window_start).toLocaleDateString("he-IL");
      await sharePdfViaWhatsApp(
        blob,
        name,
        `שיבוץ ${user?.company_name || "הפלוגה"} ל־${day}`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "שיתוף נכשל");
    } finally {
      setPdfBusy(false);
    }
  }

  useEffect(() => {
    if (!autoPdfAfterPublish) return;
    if (!schedule || schedule.status !== "published") return;
    setAutoPdfAfterPublish(false);
    void buildAndDownloadPdf();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPdfAfterPublish, schedule]);

  async function loadReplaceOptions(
    assignmentId: number,
    mode: "matching" | "all"
  ) {
    if (!token || !schedule) return;
    setReplaceLoading(true);
    setError("");
    try {
      const options = await api.replacementCandidates(
        token,
        schedule.id,
        assignmentId,
        mode
      );
      setReplaceOptions(options);
      setReplaceMode(mode);
      setReplacePersonId("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "טעינת מועמדים נכשלה");
      if (mode === "matching") {
        setReplaceFor(null);
        setReplaceOptions(null);
      }
    } finally {
      setReplaceLoading(false);
    }
  }

  async function openReplace(assignmentId: number) {
    if (!token || !schedule) return;
    setReplaceFor(assignmentId);
    setReplacePersonId("");
    setReplaceOptions(null);
    setReplaceMode("matching");
    await loadReplaceOptions(assignmentId, "matching");
  }

  function closeReplace() {
    setReplaceFor(null);
    setReplacePersonId("");
    setReplaceOptions(null);
    setReplaceMode("matching");
  }

  async function onReplace(assignmentId: number) {
    if (!token || !schedule || !replacePersonId || !replaceOptions) return;
    const selected = (replaceOptions.candidates ?? []).find(
      (c) => c.person_id === Number(replacePersonId)
    );
    if (!selected) return;

    let overrideReason: string | undefined;
    if (selected.requires_override) {
      const slot = replaceOptions.slot_label;
      const ok = await confirm({
        title: "שיבוץ עם עקיפה",
        message: `${selected.person_name} אינו עומד בדרישת המשבצת (${slot}). לשבץ בכל זאת?`,
        confirmLabel: "שבץ בכל זאת",
        tone: "danger",
      });
      if (!ok) return;
      overrideReason = `עקיפת דרישת משבצת (${slot})`;
    }

    startBusy("מחליף משובץ…");
    setError("");
    try {
      await api.replaceAssignment(token, schedule.id, assignmentId, {
        person_id: Number(replacePersonId),
        ...(overrideReason ? { override_reason: overrideReason } : {}),
      });
      const refreshed = await api.getSchedule(token, schedule.id);
      setSchedule(refreshed);
      closeReplace();
    } catch (e) {
      setError(e instanceof Error ? e.message : "החלפה נכשלה");
    } finally {
      stopBusy();
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

  const includePdfTimeline =
    timelineRows.length > 0 && timelineRows.length <= 8;

  const dayBounds = useMemo(() => {
    if (!schedule) return null;
    const start = new Date(schedule.window_start);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start, end };
  }, [schedule]);

  const planRangeLabel = useMemo(() => {
    if (!plan || !plan.days.length) return null;
    const first = new Date(plan.days[0].window_start);
    const last = new Date(plan.days[plan.days.length - 1].window_start);
    if (plan.days.length === 1) {
      return formatDayTitle(first);
    }
    const short: Intl.DateTimeFormatOptions = {
      day: "numeric",
      month: "short",
    };
    return `${first.toLocaleDateString("he-IL", short)} – ${last.toLocaleDateString("he-IL", short)}`;
  }, [plan]);

  const canPublishPlan =
    !!plan &&
    plan.status === "draft" &&
    (plan.days.some((d) => d.status === "draft" && d.assignment_count > 0) ||
      (!!schedule &&
        schedule.status === "draft" &&
        schedule.assignments.length > 0));

  const canPublishSingle =
    !!schedule &&
    schedule.status === "draft" &&
    schedule.assignments.length > 0 &&
    (!plan || plan.days_count === 1);

  function openWipeDialog() {
    setWipeOperational(false);
    setWipeCatalog(false);
    setWipePeople(false);
    setWipeOpen(true);
  }

  async function submitWipe() {
    if (!token) return;
    if (!wipeOperational && !wipeCatalog && !wipePeople) {
      setError("יש לבחור לפחות שכבת מחיקה אחת");
      return;
    }

    const layers: string[] = [];
    if (wipeOperational) layers.push("נתוני שיבוץ תפעוליים");
    if (wipeCatalog) {
      layers.push(
        wipePeople
          ? "הגדרות וקטלוג (כולל תפקידים)"
          : "הגדרות וקטלוג (תפקידים נשמרים עם כוח האדם)"
      );
    }
    if (wipePeople) layers.push("כוח אדם (לא משתמשי מערכת)");

    const ok = await confirm({
      title: "אישור מחיקה סופי",
      message: `למחוק לצמיתות מהמסד?\n\n${layers.map((l) => `• ${l}`).join("\n")}\n\nפעולה זו אינה ניתנת לשחזור.`,
      confirmLabel: "מחק לצמיתות",
      tone: "danger",
    });
    if (!ok) return;

    setWipeBusy(true);
    setError("");
    startBusy("מוחק נתונים…");
    try {
      await api.wipeCompanyData(token, {
        operational: wipeOperational,
        catalog: wipeCatalog,
        people: wipePeople,
      });
      setWipeOpen(false);
      setSchedule(null);
      setPlan(null);
      setResult(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "מחיקת הנתונים נכשלה");
    } finally {
      setWipeBusy(false);
      stopBusy();
    }
  }

  return (
    <AppShell>
      {busy ? (
        <div
          className="busy-overlay"
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          <div className="busy-card">
            <span className="busy-spinner" aria-hidden />
            <p className="busy-title">מעבד נתונים</p>
            <p className="busy-message">{busyMessage}</p>
          </div>
        </div>
      ) : null}
      <section className="panel schedule-board">
        <header className="schedule-topbar">
          <div className="schedule-topbar-start">
            <h1 className="schedule-title">שיבוץ</h1>
            {scheduleStatusLabel === "published" ? (
              <span className="schedule-status-pill published">
                <span className="schedule-status-dot" aria-hidden />
                מפורסם
              </span>
            ) : scheduleStatusLabel === "draft" ? (
              <span className="schedule-status-pill draft">
                <span className="schedule-status-dot pulse" aria-hidden />
                טיוטה — טרם פורסם
              </span>
            ) : (
              <span className="schedule-status-pill empty">אין חלון פעיל</span>
            )}
            <SchedulingHowItWorksButton />
          </div>
          <div className="schedule-topbar-end">
            {user?.role === "commander" ? (
              <button
                className="btn-wipe-quiet"
                type="button"
                disabled={busy || wipeBusy}
                onClick={openWipeDialog}
                title="מחיקת שכבות מידע מהמסד (לא משתמשי מערכת)"
              >
                מחיקת מידע
              </button>
            ) : null}
            {(canPublishPlan || canPublishSingle) &&
            schedule?.status === "draft" ? (
              <button
                className="btn btn-publish"
                type="button"
                disabled={busy || !(canPublishPlan || canPublishSingle)}
                onClick={() => void onPublish()}
              >
                {plan && plan.days_count > 1
                  ? "פרסם את כל התקופה"
                  : "פרסם שיבוץ"}
              </button>
            ) : null}
            {schedule?.status === "published" || plan?.status === "published" ? (
              <>
                <button
                  className="btn btn-primary"
                  type="button"
                  disabled={pdfBusy || !schedule}
                  onClick={() => void buildAndDownloadPdf()}
                >
                  {pdfBusy ? "מכין PDF…" : "הורד PDF"}
                </button>
                {plan && plan.days.length > 1 ? (
                  <button
                    className="btn btn-ghost"
                    type="button"
                    disabled={pdfBusy}
                    onClick={() => void buildAndDownloadAllPlanPdfs()}
                  >
                    PDF לכל הימים
                  </button>
                ) : null}
                <button
                  className="btn btn-accent"
                  type="button"
                  disabled={pdfBusy || !schedule}
                  onClick={() => void sharePublishedPdf()}
                >
                  שתף בוואטסאפ
                </button>
              </>
            ) : null}
          </div>
        </header>

        <div className="schedule-range-card">
          <div className="schedule-range-meta">
            <div className="schedule-range-icon" aria-hidden>
              ▦
            </div>
            <div>
              <span className="schedule-range-kicker">
                {selectedScopeDisplay.kicker}
              </span>
              <div className="schedule-range-title-row">
                <strong>{selectedScopeDisplay.title}</strong>
                <span className="schedule-range-chip">
                  {selectedScopeDisplay.chip}
                </span>
              </div>
              {viewingDiffersFromSelection && schedule ? (
                <p className="schedule-range-viewing">
                  מוצג למטה כעת:{" "}
                  {plan && plan.days.length > 1
                    ? planRangeLabel
                    : formatDayTitle(schedule.window_start)}
                </p>
              ) : null}
            </div>
          </div>

          <div className="schedule-range-controls-wrap">
            <div className="schedule-range-controls">
              <div
                className="segmented"
                role="group"
                aria-label="יעד לשיבוץ הבא"
              >
                <button
                  type="button"
                  className={`segmented-btn${planStartKind === "tomorrow" ? " active" : ""}`}
                  disabled={busy}
                  onClick={() => setPlanStartKind("tomorrow")}
                >
                  מחר
                </button>
                <button
                  type="button"
                  className={`segmented-btn${planStartKind === "today" ? " active" : ""}`}
                  disabled={busy || planDaysCount > 1}
                  onClick={() => {
                    setPlanStartKind("today");
                    setPlanDaysCount(1);
                  }}
                >
                  היום
                </button>
              </div>

              <label className="schedule-days-field">
                <span>ימים</span>
                <select
                  value={planDaysCount}
                  disabled={busy || planStartKind === "today"}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    setPlanDaysCount(n);
                    if (n > 1) setPlanStartKind("tomorrow");
                  }}
                >
                  {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>

              <button
                className="btn btn-primary schedule-run-btn"
                type="button"
                disabled={busy}
                onClick={() => void onGeneratePlan("all_draft")}
              >
                {busy && busyMessage.includes("משבץ") ? (
                  <span className="btn-busy-label">
                    <span
                      className="busy-spinner busy-spinner-inline"
                      aria-hidden
                    />
                    משבץ…
                  </span>
                ) : (
                  generateButtonLabel()
                )}
              </button>
            </div>
            <p className="schedule-range-hint-line">{nextScopeHint}</p>
            {planDaysCount === 1 ? (
              <p className="schedule-range-quick">
                <button
                  type="button"
                  className="text-link"
                  disabled={busy}
                  onClick={() =>
                    void createWindow(
                      planStartKind === "today" ? "today" : "tomorrow"
                    )
                  }
                >
                  {planStartKind === "today"
                    ? "טען/צור חלון להיום בלי לשבץ עדיין"
                    : "טען/צור חלון למחר בלי לשבץ עדיין"}
                </button>
              </p>
            ) : null}
          </div>
        </div>

        {plan && plan.days.length > 1 ? (
          <section className="schedule-day-picker" aria-label="ימי התוכנית">
            <div className="schedule-day-picker-head">
              <h2>ימי התוכנית</h2>
              <span>
                יום עם מחסור באיוש מסומן באדום — לחיצה קופצת למשמרת החסרה
              </span>
            </div>
            <div className="day-card-grid" role="tablist">
              {plan.days.map((d, idx) => {
                const active = schedule?.id === d.id;
                const label = new Date(d.window_start).toLocaleDateString(
                  "he-IL",
                  { weekday: "short", day: "numeric", month: "numeric" }
                );
                const needed =
                  active && schedule
                    ? staffing.needed
                    : d.staffing_needed ?? 0;
                const filled =
                  active && schedule
                    ? staffing.filled
                    : d.staffing_filled ?? 0;
                const shortfall = Math.max(0, needed - filled);
                const hasGap = needed > 0 && shortfall > 0;
                const hasMissions = d.mission_count > 0;
                return (
                  <button
                    key={d.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    className={`day-pick-card${active ? " active" : ""}${
                      d.status === "published" ? " published" : ""
                    }${hasGap ? " understaffed" : ""}`}
                    disabled={busy}
                    onClick={() =>
                      void selectPlanDay(d.id, { jumpToGap: hasGap })
                    }
                  >
                    <div className="day-pick-card-top">
                      <span className="day-pick-idx">יום {idx + 1}</span>
                      {d.status === "published" ? (
                        <span className="day-pick-badge ok">מפורסם</span>
                      ) : hasGap ? (
                        <span className="day-pick-badge danger">
                          חסר איוש {filled}/{needed}
                        </span>
                      ) : !hasMissions ? (
                        <span className="day-pick-badge muted">ללא משימות</span>
                      ) : filled === 0 ? (
                        <span className="day-pick-badge warn">טרם שובץ</span>
                      ) : (
                        <span className="day-pick-badge ok">מאויש</span>
                      )}
                    </div>
                    <div className="day-pick-date">{label}</div>
                    <div className="day-pick-foot">
                      <span>
                        {d.mission_count} משימות · איוש {filled}/{needed || 0}
                      </span>
                      <span
                        className={`day-pick-dot ${
                          hasGap
                            ? "danger"
                            : d.status === "published" ||
                                (needed > 0 && shortfall === 0)
                              ? "ok"
                              : !hasMissions
                                ? "muted"
                                : "warn"
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
            <ul className="conflict-list">
              {result.conflicts.map((c, i) => (
                <li key={`${c.mission_id}-${i}`}>{c.message}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      {schedule ? (
        <section className="panel schedule-workspace">
          <div className="schedule-workspace-head">
            <div>
              <span className="schedule-workspace-kicker">יום פעיל לעריכה</span>
              <h2>
                {formatDayTitle(schedule.window_start)}
                {schedule.status === "draft" ? " · טיוטה" : " · מפורסם"}
              </h2>
            </div>
            {plan &&
            plan.status === "draft" &&
            schedule.status === "draft" &&
            plan.days_count > 1 ? (
              <button
                className="btn btn-ghost btn-small"
                type="button"
                disabled={busy}
                onClick={() => void onGenerateDayOnly()}
              >
                שבץ מחדש יום זה בלבד
              </button>
            ) : null}
          </div>
          <p className="schedule-workspace-lead">
            רוטינית מתווספת לפי שעת התחלה ומשך (מהגדרות). משימה שאינה רוטינית
            מתווספת אוטומטית לפי טווחי השעות שהוגדרו בהגדרות.
          </p>
          <h3 className="schedule-workspace-sub">משימות בחלון</h3>
          {selectableTypes.length === 0 ? (
            <p style={{ color: "var(--ink-soft)" }}>
              עדיין אין סוגי משימה פעילים. הוסיפו בהגדרות וסמנו «בשיבוץ» — הם
              יופיעו כאן אוטומטית.
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

          <div className="schedule-metrics schedule-metrics-in-workspace">
            <div className="stat-stack">
              <button
                type="button"
                className={`metric-card metric-card-button ${rosterOpen ? "open" : ""}`}
                onClick={() => setRosterOpen((v) => !v)}
                aria-expanded={rosterOpen}
              >
                <div className="metric-card-head">
                  <span className="metric-label">כוח אדם זמין</span>
                  <span className="metric-icon metric-icon-ok" aria-hidden>
                    ◇
                  </span>
                </div>
                <div className="metric-value-row">
                  <span className="metric-value">{availableCount}</span>
                  <span className="metric-unit">
                    חיילים פעילים {rosterOpen ? "▴" : "▾"}
                  </span>
                </div>
                <div className="metric-foot">
                  <span>
                    משובצים ביום זה: <strong>{assignedPeopleCount}</strong>
                  </span>
                  <span
                    className={
                      availableCount > 0
                        ? "metric-foot-ok"
                        : "metric-foot-muted"
                    }
                  >
                    {availableCount > 0 ? "במאגר השיבוץ" : "אין כוח אדם"}
                  </span>
                </div>
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

            {staffing.shortfall > 0 ? (
              <button
                type="button"
                className="metric-card metric-card-button metric-card-danger"
                onClick={() => setScrollToUnderstaffed(true)}
                title="מעבר למשמרת עם חוסר איוש"
              >
                <div className="metric-card-head">
                  <span className="metric-label">משימות ואיוש</span>
                  <span className="metric-icon metric-icon-danger" aria-hidden>
                    ▤
                  </span>
                </div>
                <div className="metric-value-row">
                  <span className="metric-value">{missionCount}</span>
                  <span className="metric-unit">משימות בחלון</span>
                </div>
                <div className="metric-foot">
                  <span>
                    מקומות איוש:{" "}
                    <strong>
                      {staffing.filled}/{staffing.needed || 0}
                    </strong>
                  </span>
                  <span className="metric-foot-danger">
                    חסר {staffing.shortfall} · לחצו למעבר
                  </span>
                </div>
              </button>
            ) : (
              <div className="metric-card">
                <div className="metric-card-head">
                  <span className="metric-label">משימות ואיוש</span>
                  <span className="metric-icon metric-icon-info" aria-hidden>
                    ▤
                  </span>
                </div>
                <div className="metric-value-row">
                  <span className="metric-value">{missionCount}</span>
                  <span className="metric-unit">משימות בחלון</span>
                </div>
                <div className="metric-foot">
                  <span>
                    מקומות איוש:{" "}
                    <strong>
                      {staffing.filled}/{staffing.needed || 0}
                    </strong>
                  </span>
                  {staffing.needed > 0 ? (
                    <span className="metric-foot-ok">מאויש במלואו</span>
                  ) : (
                    <span className="metric-foot-muted">אין משימות עדיין</span>
                  )}
                </div>
              </div>
            )}

            <div className="metric-card">
              <div className="metric-card-head">
                <span className="metric-label">קונפליקטים</span>
                <span
                  className={`metric-icon ${
                    conflictCount > 0
                      ? "metric-icon-danger"
                      : hasRunResult
                        ? "metric-icon-ok"
                        : "metric-icon-info"
                  }`}
                  aria-hidden
                >
                  !
                </span>
              </div>
              <div className="metric-value-row">
                <span className="metric-value">{conflictCount}</span>
                <span className="metric-unit">מריצת השיבוץ</span>
              </div>
              {conflictMetric ? (
                <div className="metric-foot">
                  <span
                    className={
                      conflictMetric.tone === "ok"
                        ? "metric-foot-ok"
                        : "metric-foot-warn"
                    }
                  >
                    {conflictMetric.text}
                  </span>
                </div>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      <section className="panel schedule-workspace">
        <div className="schedule-workspace-head">
          <div>
            <span className="schedule-workspace-kicker">לוח זמנים</span>
            <h2 style={{ margin: 0 }}>
              {schedule
                ? `משמרות ומשימות · ${formatDayTitle(schedule.window_start)}`
                : "משמרות ומשימות"}
            </h2>
          </div>
        </div>
        {!schedule || !dayBounds ? (
          <p style={{ color: "var(--ink-soft)" }}>עדיין אין שיבוץ להצגה.</p>
        ) : (
          <>
            <p className="schedule-workspace-lead">
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
                        const assigned = assignmentsForMission(
                          schedule.assignments,
                          m.id
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
                const assigned = assignmentsForMission(
                  schedule.assignments,
                  m.id
                );
                const openSlots = openSlotsForMission(m, schedule.assignments);
                const understaffed = openSlots.length > 0;
                return (
                  <article
                    key={m.id}
                    id={`mission-card-${m.id}`}
                    className={`mission-card${understaffed ? " understaffed" : ""}`}
                  >
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
                          {understaffed ? (
                            <span className="mission-gap-pill">חסר איוש</span>
                          ) : null}
                        </h3>
                        <div className={`time${understaffed ? " understaffed-label" : ""}`}>
                          קושי {m.difficulty_weight}/5 · {assigned.length}/
                          {m.personnel_count} אנשים
                          {understaffed
                            ? ` · חסר: ${openSlots.map((s) => s.label).join(" · ")}`
                            : ""}
                        </div>
                      </div>
                      <div className="time">
                        {formatRange(m.start_at, m.end_at)}
                      </div>
                    </header>
                    <div className="people-chips">
                      {assigned.length === 0 && openSlots.length === 0 ? (
                        <span style={{ color: "var(--danger)" }}>לא מאויש</span>
                      ) : null}
                      {assigned.map((a) => {
                          const meta = [
                            a.person_role_name,
                            (a.person_qualification_names || []).join(", ") || null,
                          ]
                            .filter(Boolean)
                            .join(" · ");
                          const slotNeed = [
                            a.slot_role_name ? `תפקיד: ${a.slot_role_name}` : null,
                            a.slot_qualification_name
                              ? `פק״ל נדרש: ${a.slot_qualification_name}`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(" · ");
                          return (
                            <span
                              key={a.id}
                              className={`chip chip-person ${a.is_manual ? "manual" : ""}`}
                              title={slotNeed || undefined}
                            >
                              <span className="chip-text">
                                <strong>{a.person_name}</strong>
                                {meta ? (
                                  <span className="chip-meta">{meta}</span>
                                ) : null}
                              </span>
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
                          );
                        })}
                      {openSlots.map((slot) => (
                        <span
                          key={slot.key}
                          className="chip chip-person chip-open-slot"
                          title="משבצת שטרם אוישה"
                        >
                          <span className="chip-text">
                            <strong className="chip-open-slot-title">חסר</strong>
                            <span className="chip-meta">{slot.label}</span>
                          </span>
                        </span>
                      ))}
                    </div>
                    {replaceFor && assigned.some((a) => a.id === replaceFor) ? (
                      <div
                        style={{
                          marginTop: "0.75rem",
                          display: "flex",
                          flexDirection: "column",
                          gap: "0.5rem",
                          alignItems: "stretch",
                        }}
                      >
                        {replaceOptions?.slot_label ? (
                          <span
                            style={{
                              color: "var(--ink-soft)",
                              fontSize: "0.9rem",
                            }}
                          >
                            מחפשים מחליף ל־{replaceOptions.slot_label}
                            {replaceMode === "all"
                              ? " · מוצג כל הכוח אדם הזמין"
                              : ""}
                          </span>
                        ) : null}
                        <div
                          style={{
                            display: "flex",
                            gap: "0.5rem",
                            flexWrap: "wrap",
                            alignItems: "center",
                          }}
                        >
                          {(() => {
                            const candidates = replaceOptions?.candidates ?? [];
                            if (replaceLoading) {
                              return (
                                <span style={{ color: "var(--ink-soft)" }}>
                                  {replaceMode === "matching"
                                    ? "טוען מועמדים מתאימים…"
                                    : "טוען את כל הכוח אדם הזמין…"}
                                </span>
                              );
                            }
                            if (candidates.length === 0) {
                              return (
                                <span style={{ color: "var(--danger)" }}>
                                  {replaceOptions?.empty_message ||
                                    "אין חיילים זמינים למשבצת הזו כרגע"}
                                </span>
                              );
                            }
                            return (
                              <select
                                value={replacePersonId}
                                onChange={(e) =>
                                  setReplacePersonId(
                                    e.target.value ? Number(e.target.value) : ""
                                  )
                                }
                              >
                                <option value="">בחרו חייל</option>
                                {candidates.map((p) => (
                                  <option key={p.person_id} value={p.person_id}>
                                    {p.person_name}
                                    {p.role_name ? ` (${p.role_name})` : ""}
                                    {p.requires_override ? " — דורש עקיפה" : ""}
                                  </option>
                                ))}
                              </select>
                            );
                          })()}
                          <button
                            className="btn btn-primary btn-small"
                            type="button"
                            disabled={
                              !replacePersonId ||
                              busy ||
                              replaceLoading ||
                              !(replaceOptions?.candidates?.length)
                            }
                            onClick={() => onReplace(replaceFor)}
                          >
                            שמור החלפה
                          </button>
                          {replaceMode === "matching" ? (
                            <button
                              className="btn btn-ghost btn-small"
                              type="button"
                              disabled={busy || replaceLoading}
                              onClick={() =>
                                loadReplaceOptions(replaceFor, "all")
                              }
                            >
                              הצג את כל הכוח אדם הזמין
                            </button>
                          ) : (
                            <button
                              className="btn btn-ghost btn-small"
                              type="button"
                              disabled={busy || replaceLoading}
                              onClick={() =>
                                loadReplaceOptions(replaceFor, "matching")
                              }
                            >
                              חזרה למתאימים בלבד
                            </button>
                          )}
                          <button
                            className="btn btn-ghost btn-small"
                            type="button"
                            onClick={closeReplace}
                          >
                            ביטול
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
            <footer className="schedule-legend">
              <span>
                <span className="day-pick-dot ok" aria-hidden /> מאויש במלואו
              </span>
              <span>
                <span className="day-pick-dot warn" aria-hidden /> חסר איוש
              </span>
              <span>
                פרסום מעדכן מדד עומס · שיתוף לצוות נעשה בנפרד אחרי הפרסום
              </span>
            </footer>
          </>
        )}
      </section>

      {schedule ? (
        <div className="schedule-pdf-mount" aria-hidden>
          <SchedulePdfSheet
            ref={pdfRef}
            schedule={schedule}
            companyName={user?.company_name || "הפלוגה"}
            timelineRows={timelineRows}
            includeTimeline={includePdfTimeline}
          />
        </div>
      ) : null}

      {publishShareOpen ? (
        <div
          className="publish-share-backdrop"
          role="presentation"
          onClick={() => setPublishShareOpen(false)}
        >
          <div
            className="publish-share-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="publish-share-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="publish-share-title">השיבוץ פורסם</h2>
            <p>
              {plan && plan.days.length > 1
                ? "התוכנית פורסמה. אפשר להוריד PDF ליום הנוכחי, לכל הימים, או לשתף בוואטסאפ."
                : `קובץ PDF של שיבוץ הפלוגה מוכן. אפשר להוריד שוב או לשתף בוואטסאפ${
                    includePdfTimeline ? " (כולל ציר זמן)" : ""
                  }.`}
            </p>
            <div className="publish-share-actions">
              <button
                className="btn btn-ghost btn-small"
                type="button"
                onClick={() => setPublishShareOpen(false)}
              >
                סגור
              </button>
              <button
                className="btn btn-primary btn-small"
                type="button"
                disabled={pdfBusy}
                onClick={() => void buildAndDownloadPdf()}
              >
                {pdfBusy ? "…" : "הורד PDF"}
              </button>
              {plan && plan.days.length > 1 ? (
                <button
                  className="btn btn-ghost btn-small"
                  type="button"
                  disabled={pdfBusy}
                  onClick={() => void buildAndDownloadAllPlanPdfs()}
                >
                  כל הימים
                </button>
              ) : null}
              <button
                className="btn btn-accent btn-small"
                type="button"
                disabled={pdfBusy}
                onClick={() => void sharePublishedPdf()}
              >
                וואטסאפ
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {wipeOpen ? (
        <div
          className="app-dialog-backdrop"
          role="presentation"
          onClick={() => !wipeBusy && setWipeOpen(false)}
        >
          <div
            className="app-dialog app-dialog-danger wipe-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="wipe-dialog-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="wipe-dialog-title" className="app-dialog-title">
              מחיקת מידע
            </h2>
            <p className="app-dialog-message">
              המחיקה מוחקת נתונים לצמיתות מטבלאות המסד. משתמשי המערכת (חשבונות
              התחברות) לא יימחקו. בחרו אילו שכבות למחוק — כברירת מחדל אף אחת לא
              מסומנת.
            </p>
            <div className="wipe-options">
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={wipeOperational}
                  disabled={wipeBusy}
                  onChange={(e) => setWipeOperational(e.target.checked)}
                />
                <span>
                  <strong>נתוני שיבוץ תפעוליים</strong>
                  <span className="wipe-option-hint">
                    תוכניות, ימי שיבוץ, משימות, שיבוצים, עומס, אפטרים, חופשות
                    והגבלות
                  </span>
                </span>
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={wipeCatalog}
                  disabled={wipeBusy}
                  onChange={(e) => setWipeCatalog(e.target.checked)}
                />
                <span>
                  <strong>הגדרות וקטלוג</strong>
                  <span className="wipe-option-hint">
                    סוגי משימות, כללי שיבוץ, קנים והכשרות. כולל גם ניקוי נתוני
                    שיבוץ תלויים. תפקידים נמחקים רק יחד עם כוח אדם.
                  </span>
                </span>
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={wipePeople}
                  disabled={wipeBusy}
                  onChange={(e) => setWipePeople(e.target.checked)}
                />
                <span>
                  <strong>כוח אדם</strong>
                  <span className="wipe-option-hint">
                    רשימת החיילים בלבד — לא משתמשי המערכת
                  </span>
                </span>
              </label>
            </div>
            <div className="app-dialog-actions">
              <button
                className="btn btn-ghost"
                type="button"
                disabled={wipeBusy}
                onClick={() => setWipeOpen(false)}
              >
                ביטול
              </button>
              <button
                className="btn btn-danger"
                type="button"
                disabled={
                  wipeBusy ||
                  (!wipeOperational && !wipeCatalog && !wipePeople)
                }
                onClick={() => void submitWipe()}
              >
                {wipeBusy ? "מוחק…" : "מחק"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}
