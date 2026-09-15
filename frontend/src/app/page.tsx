"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useConfirm } from "@/components/ConfirmDialog";
import { SchedulePdfSheet } from "@/components/SchedulePdfSheet";
import { SchedulingHowItWorksButton } from "@/components/SchedulingHowItWorks";
import { useAuth } from "@/lib/auth";
import {
  api,
  AfterCandidate,
  AfterDraftItem,
  AfterPreview,
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
import { assignmentsForMission } from "@/lib/assignmentOrder";

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
  const [afterPreview, setAfterPreview] = useState<AfterPreview | null>(null);
  const [afterSelected, setAfterSelected] = useState<
    Record<number, { start: string; end: string }>
  >({});
  const [rosterOpen, setRosterOpen] = useState(false);

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
    if (day.status === "draft" && day.assignments.length) {
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
    if (draft && draft.status === "draft" && draft.assignments.length) {
      try {
        applyAfterPreview(await api.afterPreview(token, draft.id));
      } catch {
        applyAfterPreview(null);
      }
    } else {
      applyAfterPreview(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  async function selectPlanDay(dayId: number) {
    if (!token || !plan) return;
    if (schedule?.id === dayId) return;
    startBusy("טוען יום…");
    setError("");
    setResult(null);
    try {
      await loadDaySchedule(token, dayId);
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
        try {
          applyAfterPreview(await api.afterPreview(token, dayId));
        } catch {
          applyAfterPreview(null);
        }
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
        applyAfterPreview(null);
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
    startBusy("שומר אפטר…");
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
      stopBusy();
    }
  }

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
      <section className="panel">
        <div className="hero-actions">
          <div>
            <h1
              style={{
                margin: "0 0 0.35rem",
                fontSize: "1.7rem",
                display: "flex",
                alignItems: "center",
                gap: "0.55rem",
                flexWrap: "wrap",
              }}
            >
              מסך שיבוץ
              <SchedulingHowItWorksButton />
            </h1>
            <p style={{ margin: "0 0 0.35rem", color: "var(--ink-soft)" }}>
              <span className="schedule-day-badge muted">היום</span>
              {todayTitle}
            </p>
            <p style={{ margin: 0, fontSize: "1.05rem" }}>
              {windowKind === "today" ? (
                <>
                  <span className="schedule-day-badge today">שיבוץ להיום</span>
                  {schedule
                    ? `${formatDayTitle(schedule.window_start)} · 00:00–24:00`
                    : `${todayTitle} · 00:00–24:00`}
                </>
              ) : plan && plan.days_count > 1 ? (
                <>
                  <span className="schedule-day-badge">תוכנית רב־יומית</span>
                  {planRangeLabel} · {plan.days_count} ימים
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

            <div className="plan-range-bar">
              <label className="plan-range-field">
                <span>התחלה</span>
                <select
                  value={planStartKind}
                  disabled={busy || planDaysCount > 1}
                  onChange={(e) =>
                    setPlanStartKind(e.target.value as "today" | "tomorrow")
                  }
                >
                  <option value="tomorrow">מחר</option>
                  <option value="today">היום</option>
                </select>
              </label>
              <label className="plan-range-field">
                <span>מספר ימים</span>
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
              <span className="plan-range-hint">
                {planStartKind === "today"
                  ? "קיצור ליום אחד — היום"
                  : planDaysCount === 1
                    ? "יממה אחת — מחר"
                    : `מחר + ${planDaysCount - 1} ימים נוספים (עד 7)`}
              </span>
            </div>

            {plan && plan.days.length > 1 ? (
              <div className="plan-day-tabs" role="tablist" aria-label="ימי התוכנית">
                {plan.days.map((d, idx) => {
                  const active = schedule?.id === d.id;
                  const label = new Date(d.window_start).toLocaleDateString(
                    "he-IL",
                    { weekday: "short", day: "numeric", month: "numeric" }
                  );
                  return (
                    <button
                      key={d.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      className={`plan-day-tab${active ? " active" : ""}${
                        d.status === "published" ? " published" : ""
                      }`}
                      disabled={busy}
                      onClick={() => void selectPlanDay(d.id)}
                    >
                      <span className="plan-day-tab-idx">יום {idx + 1}</span>
                      <span className="plan-day-tab-date">{label}</span>
                      {d.status === "published" ? (
                        <span className="plan-day-tab-status">מפורסם</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ) : null}

            <p className="schedule-day-alt">
              {windowKind === "today" ? (
                <button
                  type="button"
                  className="text-link"
                  disabled={busy}
                  onClick={() => {
                    setPlanStartKind("tomorrow");
                    setPlanDaysCount(1);
                    void createWindow("tomorrow");
                  }}
                >
                  חזרה לשיבוץ מחר (ברירת מחדל)
                </button>
              ) : (
                <button
                  type="button"
                  className="text-link"
                  disabled={busy || planDaysCount > 1}
                  onClick={() => {
                    setPlanStartKind("today");
                    setPlanDaysCount(1);
                    void createWindow("today");
                  }}
                >
                  צריך שיבוץ להיום במקום?
                </button>
              )}
            </p>
          </div>
          <div className="hero-primary-actions">
            <button
              className="btn btn-primary"
              type="button"
              disabled={busy}
              onClick={() => void onGeneratePlan("all_draft")}
            >
              {busy && busyMessage.includes("משבץ") ? (
                <span className="btn-busy-label">
                  <span className="busy-spinner busy-spinner-inline" aria-hidden />
                  משבץ…
                </span>
              ) : (
                generateButtonLabel()
              )}
            </button>
            {plan &&
            plan.status === "draft" &&
            schedule &&
            schedule.status === "draft" &&
            plan.days_count > 1 ? (
              <button
                className="btn btn-ghost"
                type="button"
                disabled={busy}
                onClick={() => void onGenerateDayOnly()}
              >
                שבץ מחדש יום זה
              </button>
            ) : null}
            {(canPublishPlan || canPublishSingle) &&
            schedule?.status === "draft" ? (
              <button
                className="btn btn-accent"
                type="button"
                disabled={busy || !(canPublishPlan || canPublishSingle)}
                onClick={() => void onPublish()}
              >
                {plan && plan.days_count > 1
                  ? "מאושר לפרסום — כל התקופה"
                  : "מאושר לפרסום"}
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
                  {pdfBusy ? "מכין PDF…" : "הורד PDF ליום זה"}
                </button>
                {plan && plan.days.length > 1 ? (
                  <button
                    className="btn btn-ghost"
                    type="button"
                    disabled={pdfBusy}
                    onClick={() => void buildAndDownloadAllPlanPdfs()}
                  >
                    הורד PDF לכל הימים
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
            <ul className="conflict-list">
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
                const understaffed = assigned.length < m.personnel_count;
                return (
                  <article
                    key={m.id}
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
                        </h3>
                        <div className={`time${understaffed ? " understaffed-label" : ""}`}>
                          קושי {m.difficulty_weight}/5 · {assigned.length}/
                          {m.personnel_count} אנשים
                          {understaffed ? " · חסר איוש" : ""}
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
                        assigned.map((a) => {
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
                        })
                      )}
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
    </AppShell>
  );
}
