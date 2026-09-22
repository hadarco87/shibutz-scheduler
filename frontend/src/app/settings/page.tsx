"use client";

import { FormEvent, Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useConfirm } from "@/components/ConfirmDialog";
import { SettingsAccordion } from "@/components/SettingsAccordion";
import { useAuth } from "@/lib/auth";
import {
  api,
  CompanyInvite,
  CompanyMember,
  KanimRule,
  MissionType,
  MissionTypeRequirement,
  PersonLabel,
  Qualification,
  Role,
  SchedulingRule,
} from "@/lib/api";
import { sortMissionRequirements } from "@/lib/assignmentOrder";
import {
  buildRoutineSegments,
  formatMinute,
  formatSegmentLabel,
  parseTimeToMinute,
  RemainderPolicy,
  routineCoversFullDay,
  startAndDurationToWindow,
  windowToDurationHours,
} from "@/lib/routine";

type ReqDraft = {
  roleId: number | "";
  qualId: number | "";
  count: number;
  exactRole: boolean;
  exactQual: boolean;
};

type WindowDraft = { start: string; end: string };
type SegmentDraft = { start: string; durationHours: number };

type BandDraft = {
  label: string;
  start: string;
  end: string;
  personnel: number;
  reqs: ReqDraft[];
};

const HEB_WEEKDAYS: { label: string; py: number }[] = [
  { label: "א׳", py: 6 },
  { label: "ב׳", py: 0 },
  { label: "ג׳", py: 1 },
  { label: "ד׳", py: 2 },
  { label: "ה׳", py: 3 },
  { label: "ו׳", py: 4 },
  { label: "ש׳", py: 5 },
];

export default function SettingsPage() {
  const { token } = useAuth();
  const confirm = useConfirm();
  const [quals, setQuals] = useState<Qualification[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [missionTypes, setMissionTypes] = useState<MissionType[]>([]);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  const [roleName, setRoleName] = useState("");
  const [roleDescription, setRoleDescription] = useState("");
  const [roleCanFulfill, setRoleCanFulfill] = useState<number[]>([]);
  const [editingRoleId, setEditingRoleId] = useState<number | null>(null);

  const [qualName, setQualName] = useState("");
  const [editingQualId, setEditingQualId] = useState<number | null>(null);

  const [personLabels, setPersonLabels] = useState<PersonLabel[]>([]);
  const [labelName, setLabelName] = useState("");
  const [labelMode, setLabelMode] = useState<"single" | "multi">("single");
  const [labelOptionsText, setLabelOptionsText] = useState("");
  const [editingLabelId, setEditingLabelId] = useState<number | null>(null);

  const [editingMtId, setEditingMtId] = useState<number | null>(null);
  const [mtName, setMtName] = useState("");
  const [mtDifficulty, setMtDifficulty] = useState(1);
  const [mtCount, setMtCount] = useState(1);
  const [mtDuration, setMtDuration] = useState(8);
  const [mtRecurring, setMtRecurring] = useState(false);
  const [mtStartHour, setMtStartHour] = useState(8);
  const [mtRemainderPolicy, setMtRemainderPolicy] =
    useState<RemainderPolicy>("include_short");
  const [mtRecurrenceKind, setMtRecurrenceKind] = useState<
    "daily" | "every_n_days" | "weekly"
  >("daily");
  const [mtIntervalDays, setMtIntervalDays] = useState(3);
  const [mtWeekdays, setMtWeekdays] = useState<number[]>([]);
  const [mtAnchorDate, setMtAnchorDate] = useState("");
  const [mtHoursMode, setMtHoursMode] = useState<"uniform" | "custom">(
    "uniform"
  );
  const [mtSegments, setMtSegments] = useState<SegmentDraft[]>([
    { start: "08:00", durationHours: 8 },
  ]);
  const [mtWindows, setMtWindows] = useState<WindowDraft[]>([
    { start: "05:30", end: "07:00" },
  ]);
  const [mtBands, setMtBands] = useState<BandDraft[]>([]);
  const [reqs, setReqs] = useState<ReqDraft[]>([]);
  const [newMtName, setNewMtName] = useState("");
  const [kanimRules, setKanimRules] = useState<KanimRule[]>([]);
  const [kanimKind, setKanimKind] = useState<"weekday" | "weekend" | "specific_date">(
    "weekday"
  );
  const [kanimCount, setKanimCount] = useState(12);
  const [kanimDate, setKanimDate] = useState("");
  const [kanimNotes, setKanimNotes] = useState("");
  const [schedulingRules, setSchedulingRules] = useState<SchedulingRule[]>([]);
  const [ruleKind, setRuleKind] = useState<
    "transition" | "min_presence" | "sleep_before_after"
  >("transition");
  const [ruleSources, setRuleSources] = useState<number[]>([]);
  const [ruleBlocked, setRuleBlocked] = useState<number[]>([]);
  const [ruleMinHours, setRuleMinHours] = useState(8);
  const [ruleCooldownHours, setRuleCooldownHours] = useState(8);
  const [ruleSeverity, setRuleSeverity] = useState<"hard" | "soft">("hard");
  const [ruleAllRoles, setRuleAllRoles] = useState(true);
  const [ruleRoleIds, setRuleRoleIds] = useState<number[]>([]);
  const [ruleQualIds, setRuleQualIds] = useState<number[]>([]);
  const [ruleMinCount, setRuleMinCount] = useState(1);
  const [rulePresenceScope, setRulePresenceScope] = useState<
    "not_at_home" | "on_mission" | "on_mission_types"
  >("not_at_home");
  const [members, setMembers] = useState<CompanyMember[]>([]);
  const [invites, setInvites] = useState<CompanyInvite[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [copiedInviteId, setCopiedInviteId] = useState<number | null>(null);

  const activeRoles = useMemo(() => roles.filter((r) => r.is_active), [roles]);

  const routinePreview = useMemo(() => {
    if (!mtRecurring || mtHoursMode !== "uniform" || mtDuration <= 0) return [];
    return buildRoutineSegments(mtDuration, mtStartHour, mtRemainderPolicy);
  }, [mtRecurring, mtHoursMode, mtDuration, mtStartHour, mtRemainderPolicy]);

  const customPreview = useMemo(() => {
    if (!mtRecurring || mtHoursMode !== "custom") return [];
    return mtSegments
      .map((s) => {
        const sm = parseTimeToMinute(s.start);
        if (sm == null || s.durationHours <= 0) return null;
        const w = startAndDurationToWindow(sm, s.durationHours);
        const startH = sm / 60;
        const len = windowToDurationHours(w.start_minute, w.end_minute);
        return formatSegmentLabel(startH, len);
      })
      .filter(Boolean) as string[];
  }, [mtRecurring, mtHoursMode, mtSegments]);

  const routineUneven =
    mtRecurring &&
    mtHoursMode === "uniform" &&
    !routineCoversFullDay(mtDuration);

  const refresh = useCallback(async () => {
    if (!token) return;
    const [q, r, labels, mt, kr, sr, mem, inv] = await Promise.all([
      api.qualifications(token),
      api.roles(token),
      api.personLabels(token),
      api.missionTypes(token),
      api.kanimRules(token),
      api.schedulingRules(token),
      api.companyMembers(token),
      api.companyInvites(token),
    ]);
    setQuals(q);
    setRoles(r);
    setPersonLabels(
      [...labels].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
    );
    setMissionTypes(mt);
    setKanimRules(kr);
    setSchedulingRules(sr);
    setMembers(mem);
    setInvites(inv);
  }, [token]);

  function resetLabelForm() {
    setEditingLabelId(null);
    setLabelName("");
    setLabelMode("single");
    setLabelOptionsText("");
  }

  function parseLabelOptions(text: string) {
    return text
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((name, i) => ({ name, sort_order: i, is_active: true }));
  }

  async function savePersonLabel(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    const name = labelName.trim();
    if (!name) return;
    setError("");
    setOk("");
    try {
      const options = parseLabelOptions(labelOptionsText);
      if (editingLabelId) {
        await api.updatePersonLabel(token, editingLabelId, {
          name,
          selection_mode: labelMode,
          options,
        });
        setOk("תווית עודכנה");
      } else {
        if (personLabels.length >= 3) {
          setError("ניתן להגדיר עד 3 תוויות");
          return;
        }
        await api.createPersonLabel(token, {
          name,
          selection_mode: labelMode,
          options,
        });
        setOk("תווית נוספה");
      }
      resetLabelForm();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "שמירת תווית נכשלה");
    }
  }

  function inviteLink(tokenValue: string) {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/login?invite=${encodeURIComponent(tokenValue)}`;
  }

  async function copyInviteLink(inv: CompanyInvite) {
    const link = inviteLink(inv.token);
    try {
      await navigator.clipboard.writeText(link);
      setCopiedInviteId(inv.id);
      window.setTimeout(() => setCopiedInviteId(null), 2000);
    } catch {
      setError("לא ניתן להעתיק ללוח — העתיקו ידנית מהקישור");
    }
  }

  async function sendInvite(e: FormEvent) {
    e.preventDefault();
    if (!token || !inviteEmail.trim()) return;
    setInviteBusy(true);
    setError("");
    setOk("");
    try {
      const created = await api.createCompanyInvite(token, inviteEmail.trim());
      setInviteEmail("");
      setOk(`הזמנה נוצרה ל־${created.email} — העתיקו את הקישור ושלחו`);
      await refresh();
      await copyInviteLink(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : "יצירת הזמנה נכשלה");
    } finally {
      setInviteBusy(false);
    }
  }

  async function revokeInvite(inv: CompanyInvite) {
    if (!token) return;
    const okConfirm = await confirm({
      title: "ביטול הזמנה",
      message: `לבטל את ההזמנה ל־${inv.email}?`,
      confirmLabel: "בטל הזמנה",
      tone: "danger",
    });
    if (!okConfirm) return;
    setError("");
    try {
      await api.revokeCompanyInvite(token, inv.id);
      setOk("ההזמנה בוטלה");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ביטול נכשל");
    }
  }

  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, [refresh]);

  function resetRoleForm() {
    setEditingRoleId(null);
    setRoleName("");
    setRoleDescription("");
    setRoleCanFulfill([]);
  }

  function startEditRole(role: Role) {
    setEditingRoleId(role.id);
    setRoleName(role.name);
    setRoleDescription(role.description || "");
    setRoleCanFulfill([...(role.can_fulfill_role_ids || [])]);
  }

  async function saveRole(e: FormEvent) {
    e.preventDefault();
    if (!token || !roleName.trim()) return;
    setError("");
    setOk("");
    try {
      const body = {
        name: roleName.trim(),
        description: roleDescription.trim() || null,
        can_fulfill_role_ids: roleCanFulfill,
      };
      if (editingRoleId) {
        await api.updateRole(token, editingRoleId, body);
      } else {
        await api.createRole(token, body);
      }
      resetRoleForm();
      setOk("תפקיד נשמר");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה");
    }
  }

  async function saveQualification(e: FormEvent) {
    e.preventDefault();
    if (!token || !qualName.trim()) return;
    setError("");
    setOk("");
    try {
      if (editingQualId) {
        await api.updateQualification(token, editingQualId, { name: qualName.trim() });
      } else {
        await api.createQualification(token, { name: qualName.trim() });
      }
      setQualName("");
      setEditingQualId(null);
      setOk("פק״ל נשמר");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה");
    }
  }

  function startEditMt(mt: MissionType) {
    setEditingMtId(mt.id);
    setMtName(mt.name);
    setMtDifficulty(mt.difficulty_weight);
    setMtCount(mt.default_personnel_count);
    setMtDuration(mt.default_duration_hours || 8);
    setMtRecurring(!!mt.is_recurring_template);
    setMtStartHour(
      mt.recurring_start_hour != null ? mt.recurring_start_hour : 8
    );
    setMtRemainderPolicy(
      mt.routine_remainder_policy === "full_only" ? "full_only" : "include_short"
    );
    const kind =
      mt.recurrence_kind === "every_n_days" || mt.recurrence_kind === "weekly"
        ? mt.recurrence_kind
        : "daily";
    setMtRecurrenceKind(kind);
    setMtIntervalDays(Math.max(2, mt.recurrence_interval_days || 3));
    setMtWeekdays(
      (mt.recurrence_weekdays || "")
        .split(",")
        .map((x) => Number(x.trim()))
        .filter((n) => Number.isFinite(n) && n >= 0 && n <= 6)
    );
    setMtAnchorDate(
      mt.recurrence_anchor_date
        ? String(mt.recurrence_anchor_date).slice(0, 10)
        : ""
    );
    const hoursMode =
      mt.routine_hours_mode === "custom" ? "custom" : "uniform";
    setMtHoursMode(hoursMode);
    if (hoursMode === "custom" && (mt.time_windows || []).length) {
      setMtSegments(
        (mt.time_windows || []).map((w) => ({
          start: formatMinute(w.start_minute),
          durationHours: windowToDurationHours(w.start_minute, w.end_minute),
        }))
      );
    } else {
      setMtSegments([{ start: "08:00", durationHours: mt.default_duration_hours || 8 }]);
    }
    setMtWindows(
      !mt.is_recurring_template && (mt.time_windows || []).length
        ? (mt.time_windows || []).map((w) => ({
            start: formatMinute(w.start_minute),
            end: formatMinute(w.end_minute),
          }))
        : [{ start: "05:30", end: "07:00" }]
    );
    setMtBands(
      (mt.staffing_bands || []).map((b) => ({
        label: b.label || "",
        start: formatMinute(b.start_minute),
        end: formatMinute(b.end_minute),
        personnel: b.personnel_count,
        reqs: sortMissionRequirements(b.requirements || [], resolveReqNames).map(
          (r) => ({
            roleId: (r.role_id || "") as number | "",
            qualId: (r.qualification_id || "") as number | "",
            count: r.count,
            exactRole: Boolean(r.exact_role),
            exactQual: r.exact_qualification !== false,
          })
        ),
      }))
    );
    setReqs(
      sortMissionRequirements(mt.default_requirements || [], resolveReqNames).map(
        (r) => ({
          roleId: (r.role_id || "") as number | "",
          qualId: (r.qualification_id || "") as number | "",
          count: r.count,
          exactRole: Boolean(r.exact_role),
          exactQual: r.exact_qualification !== false,
        })
      )
    );
  }

  function reqsTotal(list: ReqDraft[] = reqs) {
    return list.reduce((sum, r) => sum + (Number(r.count) || 0), 0);
  }

  /** Keep requirement headcount ≤ default personnel (trim from the end). */
  function fitReqsToPersonnel(list: ReqDraft[], personnel: number): ReqDraft[] {
    let remaining = Math.max(0, Math.floor(personnel));
    const out: ReqDraft[] = [];
    for (const r of list) {
      if (remaining <= 0) break;
      const wanted = Math.max(1, Number(r.count) || 1);
      const take = Math.min(wanted, remaining);
      out.push({ ...r, count: take });
      remaining -= take;
    }
    return out;
  }

  function setMtCountAndFit(n: number) {
    const next = Math.max(1, Number(n) || 1);
    setMtCount(next);
    setReqs((prev) => fitReqsToPersonnel(prev, next));
  }

  function setReqsCapped(next: ReqDraft[]) {
    setReqs(fitReqsToPersonnel(next, mtCount));
  }

  function addRequirement() {
    const remaining = mtCount - reqsTotal();
    if (remaining <= 0) {
      setError(
        `לא ניתן להוסיף דרישה — כבר מוגדרים ${mtCount} אנשים. הגדילו קודם את מספר האנשים.`
      );
      return;
    }
    setError("");
    setReqsCapped([
      ...reqs,
      {
        roleId: activeRoles[0]?.id ?? "",
        qualId: "",
        count: 1,
        exactRole: false,
        exactQual: true,
      },
    ]);
  }

  async function createMissionType(e: FormEvent) {
    e.preventDefault();
    if (!token || !newMtName.trim()) return;
    setError("");
    setOk("");
    try {
      await api.createMissionType(token, {
        name: newMtName.trim(),
        difficulty_weight: 2,
        default_personnel_count: 2,
        default_duration_hours: 4,
        is_recurring_template: false,
        default_requirements: [],
      });
      setNewMtName("");
      setOk("סוג משימה נוסף");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה");
    }
  }

  async function saveMissionType(e: FormEvent) {
    e.preventDefault();
    if (!token || !editingMtId) return;
    setError("");
    setOk("");
    const default_requirements: MissionTypeRequirement[] =
      sortMissionRequirements(
        reqs
          .map((r) => {
            const roleId =
              r.roleId !== ""
                ? Number(r.roleId)
                : activeRoles[0]?.id != null
                  ? activeRoles[0].id
                  : null;
            const qualId = r.qualId !== "" ? Number(r.qualId) : null;
            return {
              role_id: roleId,
              qualification_id: qualId,
              count: r.count,
              exact_role: Boolean(r.exactRole),
              exact_qualification: Boolean(r.exactQual),
            };
          })
          .filter((r) => r.role_id != null || r.qualification_id != null),
        resolveReqNames
      );
    const reqSum = default_requirements.reduce((s, r) => s + r.count, 0);
    const useBands = mtRecurring && mtBands.length > 0;
    if (!useBands && default_requirements.length && reqSum !== mtCount) {
      setError(
        `סכום הדרישות (${reqSum}) חייב להיות שווה למספר האנשים (${mtCount})`
      );
      return;
    }
    if (
      mtRecurring &&
      mtHoursMode === "uniform" &&
      (mtStartHour < 0 || mtStartHour > 23)
    ) {
      setError("שעת התחלה חייבת להיות בין 0 ל־23");
      return;
    }
    if (mtRecurring && mtRecurrenceKind === "every_n_days") {
      if (mtIntervalDays < 2) {
        setError("כל X ימים — X חייב להיות לפחות 2");
        return;
      }
      if (!mtAnchorDate) {
        setError("כל X ימים — חובה לבחור תאריך עוגן");
        return;
      }
    }
    if (mtRecurring && mtRecurrenceKind === "weekly" && mtWeekdays.length === 0) {
      setError("בתדירות שבועית חובה לבחור לפחות יום אחד");
      return;
    }
    if (mtDifficulty < 1 || mtDifficulty > 5) {
      setError("רמת הקושי חייבת להיות בין 1 ל־5 (1 הכי קל, 5 הכי קשה)");
      return;
    }
    const time_windows: { start_minute: number; end_minute: number; sort_order: number }[] =
      [];
    if (!mtRecurring) {
      for (let i = 0; i < mtWindows.length; i++) {
        const w = mtWindows[i];
        const sm = parseTimeToMinute(w.start);
        const em = parseTimeToMinute(w.end);
        if (sm == null || em == null) {
          setError(`טווח ${i + 1}: הזינו שעה בפורמט HH:MM (למשל 05:30)`);
          return;
        }
        if (sm === em) {
          setError(`טווח ${i + 1}: התחלה וסיום לא יכולים להיות זהים`);
          return;
        }
        time_windows.push({ start_minute: sm, end_minute: em, sort_order: i });
      }
      if (!time_windows.length) {
        setError("למשימה שאינה רוטינית חובה להגדיר לפחות טווח שעות אחד");
        return;
      }
    } else if (mtHoursMode === "custom") {
      for (let i = 0; i < mtSegments.length; i++) {
        const s = mtSegments[i];
        const sm = parseTimeToMinute(s.start);
        if (sm == null) {
          setError(`משמרת ${i + 1}: הזינו שעת התחלה בפורמט HH:MM`);
          return;
        }
        if (!(s.durationHours > 0)) {
          setError(`משמרת ${i + 1}: משך חייב להיות גדול מ־0`);
          return;
        }
        const w = startAndDurationToWindow(sm, s.durationHours);
        time_windows.push({ ...w, sort_order: i });
      }
      if (!time_windows.length) {
        setError("למשמרות ספציפיות חובה להגדיר לפחות משמרת אחת");
        return;
      }
    }
    const staffing_bands: {
      label: string | null;
      start_minute: number;
      end_minute: number;
      personnel_count: number;
      sort_order: number;
      requirements: MissionTypeRequirement[];
    }[] = [];
    if (useBands) {
      for (let i = 0; i < mtBands.length; i++) {
        const b = mtBands[i];
        const sm = parseTimeToMinute(b.start);
        const em = parseTimeToMinute(b.end);
        if (sm == null || em == null) {
          setError(`רצועה ${i + 1}: הזינו שעות בפורמט HH:MM`);
          return;
        }
        if (sm === em) {
          setError(`רצועה ${i + 1}: התחלה וסיום לא יכולים להיות זהים`);
          return;
        }
        if (b.personnel < 1) {
          setError(`רצועה ${i + 1}: מספר אנשים חייב להיות לפחות 1`);
          return;
        }
        const bandReqs = sortMissionRequirements(
          b.reqs
            .map((r) => ({
              role_id:
                r.roleId !== ""
                  ? Number(r.roleId)
                  : activeRoles[0]?.id != null
                    ? activeRoles[0].id
                    : null,
              qualification_id: r.qualId !== "" ? Number(r.qualId) : null,
              count: r.count,
              exact_role: Boolean(r.exactRole),
              exact_qualification: Boolean(r.exactQual),
            }))
            .filter((r) => r.role_id != null || r.qualification_id != null),
          resolveReqNames
        );
        const bandSum = bandReqs.reduce((s, r) => s + r.count, 0);
        if (bandReqs.length && bandSum !== b.personnel) {
          setError(
            `רצועה ${i + 1}: סכום הדרישות (${bandSum}) חייב להיות ${b.personnel}`
          );
          return;
        }
        staffing_bands.push({
          label: b.label.trim() || null,
          start_minute: sm,
          end_minute: em,
          personnel_count: b.personnel,
          sort_order: i,
          requirements: bandReqs,
        });
      }
    }
    try {
      await api.updateMissionType(token, editingMtId, {
        name: mtName,
        difficulty_weight: mtDifficulty,
        default_personnel_count: useBands
          ? Math.max(1, ...mtBands.map((b) => b.personnel), mtCount)
          : mtCount,
        default_duration_hours: mtDuration,
        is_recurring_template: mtRecurring,
        recurring_start_hour:
          mtRecurring && mtHoursMode === "uniform" ? mtStartHour : null,
        recurring_end_hour: null,
        routine_remainder_policy:
          mtRecurring && mtHoursMode === "uniform"
            ? mtRemainderPolicy
            : "include_short",
        recurrence_kind: mtRecurring ? mtRecurrenceKind : "daily",
        recurrence_interval_days:
          mtRecurring && mtRecurrenceKind === "every_n_days"
            ? mtIntervalDays
            : 1,
        recurrence_weekdays:
          mtRecurring && mtRecurrenceKind === "weekly"
            ? mtWeekdays.slice().sort((a, b) => a - b).join(",")
            : null,
        recurrence_anchor_date:
          mtRecurring && mtRecurrenceKind === "every_n_days"
            ? mtAnchorDate
            : null,
        routine_hours_mode: mtRecurring ? mtHoursMode : "uniform",
        default_requirements: useBands ? [] : default_requirements,
        time_windows:
          !mtRecurring || mtHoursMode === "custom" ? time_windows : [],
        staffing_bands: mtRecurring ? staffing_bands : [],
      });
      setOk("סוג המשימה נשמר");
      setEditingMtId(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה");
    }
  }

  async function toggleMissionInScheduling(mt: MissionType) {
    if (!token) return;
    setError("");
    setOk("");
    try {
      await api.updateMissionType(token, mt.id, { is_active: !mt.is_active });
      setOk(
        mt.is_active
          ? `${mt.name} הוסרה מרשימת השיבוץ`
          : `${mt.name} תשתתף בשיבוץ`
      );
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה");
    }
  }

  async function saveKanim(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setError("");
    setOk("");
    try {
      await api.createKanimRule(token, {
        kind: kanimKind,
        min_count: kanimCount,
        specific_date: kanimKind === "specific_date" ? kanimDate || null : null,
        notes: kanimNotes.trim() || null,
      });
      setKanimNotes("");
      setKanimDate("");
      setOk("כלל קנים נשמר");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה");
    }
  }

  function toggleId(list: number[], id: number) {
    return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  }

  function ruleSentencePreview() {
    if (ruleKind === "sleep_before_after") {
      const sources =
        ruleSources
          .map((id) => missionTypes.find((m) => m.id === id)?.name)
          .filter(Boolean)
          .join(" / ") || "…";
      const who = ruleAllRoles
        ? "כל כוח האדם"
        : ruleRoleIds
            .map((id) => roles.find((r) => r.id === id)?.name)
            .filter(Boolean)
            .join(", ") || "תפקידים נבחרים";
      return `אחרי ${sources} — ${ruleCooldownHours} ש׳ במוצב לפני יציאה לאפטר · ${
        ruleSeverity === "hard" ? "קשיח" : "רך"
      } · ${who}`;
    }
    if (ruleKind === "min_presence") {
      const who =
        [
          ...ruleRoleIds.map((id) => roles.find((r) => r.id === id)?.name),
          ...ruleQualIds.map((id) => quals.find((q) => q.id === id)?.name),
        ]
          .filter(Boolean)
          .join(" / ") || "…";
      const where =
        rulePresenceScope === "on_mission"
          ? "במשימה כלשהי"
          : rulePresenceScope === "on_mission_types"
            ? `בסוגי משימה: ${
                ruleSources
                  .map((id) => missionTypes.find((m) => m.id === id)?.name)
                  .filter(Boolean)
                  .join(" / ") || "…"
              }`
            : "במוצב או בפעילות (לא בבית)";
      return `בכל רגע חייבים לפחות ${ruleMinCount} מ־${who} ${where} · ${
        ruleSeverity === "hard" ? "קשיח" : "רך"
      }`;
    }
    const sources =
      ruleSources
        .map((id) => missionTypes.find((m) => m.id === id)?.name)
        .filter(Boolean)
        .join(" / ") || "…";
    const blocked =
      ruleBlocked
        .map((id) => missionTypes.find((m) => m.id === id)?.name)
        .filter(Boolean)
        .join(" / ") || "…";
    const who = ruleAllRoles
      ? "כל כוח האדם"
      : ruleRoleIds
          .map((id) => roles.find((r) => r.id === id)?.name)
          .filter(Boolean)
          .join(", ") || "תפקידים נבחרים";
    return `אחרי ${sources} של לפחות ${ruleMinHours} שעות — לא לשבץ ל־${blocked} במשך ${ruleCooldownHours} שעות מסוף המשמרת · ${
      ruleSeverity === "hard" ? "קשיח" : "רך"
    } · ${who}`;
  }

  function resetRuleForm() {
    setRuleSources([]);
    setRuleBlocked([]);
    setRuleMinHours(8);
    setRuleCooldownHours(8);
    setRuleSeverity("hard");
    setRuleAllRoles(true);
    setRuleRoleIds([]);
    setRuleQualIds([]);
    setRuleMinCount(1);
    setRulePresenceScope("not_at_home");
  }

  async function saveSchedulingRule(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setError("");
    setOk("");
    try {
      if (ruleKind === "min_presence") {
        await api.createSchedulingRule(token, {
          rule_kind: "min_presence",
          min_count: ruleMinCount,
          presence_scope: rulePresenceScope,
          role_ids: ruleRoleIds,
          qualification_ids: ruleQualIds,
          source_mission_type_ids:
            rulePresenceScope === "on_mission_types" ? ruleSources : [],
          blocked_mission_type_ids: [],
          severity: ruleSeverity,
          is_active: true,
        });
      } else if (ruleKind === "sleep_before_after") {
        await api.createSchedulingRule(token, {
          rule_kind: "sleep_before_after",
          source_mission_type_ids: ruleSources,
          blocked_mission_type_ids: [],
          cooldown_hours: ruleCooldownHours,
          severity: ruleSeverity,
          applies_to_all_roles: ruleAllRoles,
          role_ids: ruleAllRoles ? [] : ruleRoleIds,
          is_active: true,
        });
      } else {
        await api.createSchedulingRule(token, {
          rule_kind: "transition",
          source_mission_type_ids: ruleSources,
          blocked_mission_type_ids: ruleBlocked,
          min_source_hours: ruleMinHours,
          cooldown_hours: ruleCooldownHours,
          severity: ruleSeverity,
          applies_to_all_roles: ruleAllRoles,
          role_ids: ruleAllRoles ? [] : ruleRoleIds,
          is_active: true,
        });
      }
      resetRuleForm();
      setOk("כלל שיבוץ נשמר");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה");
    }
  }

  function formatRuleRow(r: SchedulingRule) {
    if (r.rule_kind === "sleep_before_after") {
      return (
        <>
          שינה לפני אפטר: אחרי{" "}
          <strong>{r.source_mission_type_names.join(" / ")}</strong> →{" "}
          {r.cooldown_hours}ש׳ במוצב
        </>
      );
    }
    if (r.rule_kind === "min_presence") {
      const who = [
        ...r.role_names,
        ...r.qualification_names,
      ].join(" / ");
      const where =
        r.presence_scope === "on_mission"
          ? "במשימה"
          : r.presence_scope === "on_mission_types"
            ? `ב־${r.source_mission_type_names.join(" / ")}`
            : "לא בבית";
      return `נוכחות: ≥${r.min_count} מ־${who || "—"} ${where}`;
    }
    return (
      <>
        אחרי <strong>{r.source_mission_type_names.join(" / ")}</strong> ≥
        {r.min_source_hours}ש׳ → חסום{" "}
        <strong>{r.blocked_mission_type_names.join(" / ")}</strong> ל־
        {r.cooldown_hours}ש׳
      </>
    );
  }

  function kanimKindLabel(kind: KanimRule["kind"]) {
    if (kind === "weekday") return "ימי חול (א׳–ה׳)";
    if (kind === "weekend") return "סופ״ש (ו׳–ש׳)";
    return "תאריך ספציפי";
  }

  function resolveReqNames(r: MissionTypeRequirement) {
    return {
      roleName: r.role_id
        ? roles.find((x) => x.id === r.role_id)?.name || null
        : null,
      qualName: r.qualification_id
        ? quals.find((x) => x.id === r.qualification_id)?.name || null
        : null,
    };
  }

  function reqLabel(mt: MissionType) {
    return sortMissionRequirements(mt.default_requirements || [], resolveReqNames)
      .map((r) => {
        const { roleName, qualName } = resolveReqNames(r);
        const parts = [roleName, qualName].filter(Boolean) as string[];
        const name = parts.join("+") || "כללי";
        return r.count > 1 ? `${r.count}× ${name}` : name;
      })
      .join(" · ");
  }

  function fulfillLabel(role: Role) {
    const names = (role.can_fulfill_role_ids || [])
      .map((id) => roles.find((r) => r.id === id)?.name)
      .filter(Boolean);
    return names.join(", ") || "—";
  }

  return (
    <AppShell>
      <header className="page-intro">
        <h1>הגדרות</h1>
        {error ? <div className="alert alert-danger">{error}</div> : null}
        {ok ? <div className="alert alert-ok">{ok}</div> : null}
      </header>

      <SettingsAccordion
        title="שיתוף צוות"
        hint="הזמנת משתמשים לאותה פלוגה עם הרשאות מלאות"
      >
        <p style={{ color: "var(--ink-soft)", marginTop: "0.85rem" }}>
          הזמינו במייל ושלחו קישור. מי שנרשם דרך הקישור מצטרף לפלוגה עם הרשאות
          מלאות, ויכול גם להזמין אחרים.
        </p>
        <form className="form-grid" onSubmit={sendInvite} style={{ maxWidth: 520 }}>
          <label>
            אימייל להזמנה
            <input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="name@example.com"
              required
            />
          </label>
          <button className="btn btn-primary" type="submit" disabled={inviteBusy}>
            {inviteBusy ? "…" : "צור הזמנה"}
          </button>
        </form>

        <h3 style={{ marginBottom: "0.35rem" }}>חברי הפלוגה</h3>
        <table className="table">
          <thead>
            <tr>
              <th>שם</th>
              <th>אימייל</th>
              <th>סטטוס</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id}>
                <td>{m.full_name}</td>
                <td>{m.email}</td>
                <td>{m.is_active ? "פעיל" : "מושבת"}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3 style={{ marginBottom: "0.35rem", marginTop: "1.25rem" }}>
          הזמנות ממתינות
        </h3>
        {invites.length === 0 ? (
          <p style={{ color: "var(--ink-soft)" }}>אין הזמנות פתוחות</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>אימייל</th>
                <th>הוזמן על ידי</th>
                <th>קישור</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {invites.map((inv) => (
                <tr key={inv.id}>
                  <td>{inv.email}</td>
                  <td>{inv.invited_by_name || "—"}</td>
                  <td>
                    <div className="invite-link-row">
                      <code>{inviteLink(inv.token)}</code>
                      <button
                        className="btn btn-ghost btn-small"
                        type="button"
                        onClick={() => copyInviteLink(inv)}
                      >
                        {copiedInviteId === inv.id ? "הועתק" : "העתק"}
                      </button>
                    </div>
                  </td>
                  <td>
                    <button
                      className="btn btn-danger-ghost btn-small"
                      type="button"
                      onClick={() => revokeInvite(inv)}
                    >
                      בטל
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SettingsAccordion>

      <SettingsAccordion title="תפקידים" hint="מי יכול למלא מה בשיבוץ">
        <h2 style={{ marginTop: 0 }}>תפקידים</h2>
        <p style={{ color: "var(--ink-soft)", marginTop: 0 }}>
          לדוגמה: חייל, מפקד, מפקד זוטר. אפשר גם להגדיר אילו תפקידים כל תפקיד יכול למלא
          (מפקד יכול למלא גם תפקיד חייל).
        </p>
        <form className="form-grid" onSubmit={saveRole} style={{ maxWidth: 560 }}>
          <label>
            {editingRoleId ? "עריכת תפקיד" : "תפקיד חדש"}
            <input
              value={roleName}
              onChange={(e) => setRoleName(e.target.value)}
              placeholder='לדוגמה: חייל, מפקד, מש"ק, קצין'
              required
            />
          </label>
          <label>
            תיאור (אופציונלי)
            <input
              value={roleDescription}
              onChange={(e) => setRoleDescription(e.target.value)}
              placeholder="תיאור קצר"
            />
          </label>
          <div>
            <div style={{ marginBottom: "0.4rem", color: "var(--ink-soft)" }}>
              יכול למלא גם את התפקידים הבאים
            </div>
            <div className="people-chips">
              {roles
                .filter((r) => r.is_active || r.id === editingRoleId)
                .map((r) => {
                  const on = roleCanFulfill.includes(r.id);
                  return (
                    <button
                      key={r.id}
                      type="button"
                      className={`chip ${on ? "manual" : ""}`}
                      onClick={() =>
                        setRoleCanFulfill((prev) =>
                          on ? prev.filter((id) => id !== r.id) : [...prev, r.id]
                        )
                      }
                    >
                      {r.name}
                    </button>
                  );
                })}
            </div>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button className="btn btn-primary" type="submit">
              {editingRoleId ? "שמור תפקיד" : "הוסף תפקיד"}
            </button>
            {editingRoleId ? (
              <button className="btn btn-ghost" type="button" onClick={resetRoleForm}>
                ביטול
              </button>
            ) : null}
          </div>
        </form>

        <table className="table" style={{ marginTop: "1rem" }}>
          <thead>
            <tr>
              <th>שם</th>
              <th>יכול למלא</th>
              <th>סטטוס</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {roles.map((role) => (
              <tr key={role.id}>
                <td>
                  <strong>{role.name}</strong>
                  {role.description ? (
                    <div style={{ color: "var(--ink-soft)", fontSize: "0.85rem" }}>
                      {role.description}
                    </div>
                  ) : null}
                </td>
                <td>{fulfillLabel(role)}</td>
                <td>{role.is_active ? "פעיל" : "מושבת"}</td>
                <td style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
                  <button
                    className="btn btn-ghost btn-small"
                    type="button"
                    onClick={() => startEditRole(role)}
                  >
                    עריכה
                  </button>
                  {role.is_active ? (
                    <button
                      className="btn btn-ghost btn-small"
                      type="button"
                      onClick={async () => {
                        if (!token) return;
                        await api.updateRole(token, role.id, { is_active: false });
                        await refresh();
                      }}
                    >
                      השבת
                    </button>
                  ) : (
                    <button
                      className="btn btn-ghost btn-small"
                      type="button"
                      onClick={async () => {
                        if (!token) return;
                        await api.updateRole(token, role.id, { is_active: true });
                        await refresh();
                      }}
                    >
                      הפעל
                    </button>
                  )}
                  <button
                    className="btn btn-ghost btn-small"
                    type="button"
                    onClick={async () => {
                      if (!token) return;
                      const ok = await confirm({
                        title: "מחיקת תפקיד",
                        message: `למחוק את התפקיד «${role.name}»?`,
                        confirmLabel: "מחק",
                        tone: "danger",
                      });
                      if (!ok) return;
                      setError("");
                      setOk("");
                      try {
                        await api.deleteRole(token, role.id);
                        if (editingRoleId === role.id) resetRoleForm();
                        setOk("תפקיד נמחק");
                        await refresh();
                      } catch (err) {
                        setError(err instanceof Error ? err.message : "מחיקה נכשלה");
                      }
                    }}
                  >
                    מחק
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </SettingsAccordion>

      <SettingsAccordion title="פק״לים" hint="הסמכות מקצועיות לאיוש">
        <h2 style={{ marginTop: 0 }}>פק״לים</h2>
        <form className="form-grid" onSubmit={saveQualification} style={{ maxWidth: 480 }}>
          <label>
            {editingQualId ? "עריכת פק״ל" : "פק״ל חדש"}
            <input
              value={qualName}
              onChange={(e) => setQualName(e.target.value)}
              placeholder="לדוגמה: חובש, קשר, נהג"
              required
            />
          </label>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button className="btn btn-primary" type="submit">
              {editingQualId ? "שמור" : "הוסף פק״ל"}
            </button>
            {editingQualId ? (
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => {
                  setEditingQualId(null);
                  setQualName("");
                }}
              >
                ביטול
              </button>
            ) : null}
          </div>
        </form>

        <table className="table" style={{ marginTop: "1rem" }}>
          <thead>
            <tr>
              <th>שם</th>
              <th>סטטוס</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {quals.map((q) => (
              <tr key={q.id}>
                <td>{q.name}</td>
                <td>{q.is_active ? "פעיל" : "מושבת"}</td>
                <td style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
                  <button
                    className="btn btn-ghost btn-small"
                    type="button"
                    onClick={() => {
                      setEditingQualId(q.id);
                      setQualName(q.name);
                    }}
                  >
                    עריכה
                  </button>
                  {q.is_active ? (
                    <button
                      className="btn btn-ghost btn-small"
                      type="button"
                      onClick={async () => {
                        if (!token) return;
                        await api.updateQualification(token, q.id, { is_active: false });
                        await refresh();
                      }}
                    >
                      השבת
                    </button>
                  ) : (
                    <button
                      className="btn btn-ghost btn-small"
                      type="button"
                      onClick={async () => {
                        if (!token) return;
                        await api.updateQualification(token, q.id, { is_active: true });
                        await refresh();
                      }}
                    >
                      הפעל
                    </button>
                  )}
                  <button
                    className="btn btn-ghost btn-small"
                    type="button"
                    onClick={async () => {
                      if (!token) return;
                      const ok = await confirm({
                        title: "מחיקת פק״ל",
                        message: `למחוק את הפק״ל «${q.name}»?`,
                        confirmLabel: "מחק",
                        tone: "danger",
                      });
                      if (!ok) return;
                      setError("");
                      setOk("");
                      try {
                        await api.deleteQualification(token, q.id);
                        if (editingQualId === q.id) {
                          setEditingQualId(null);
                          setQualName("");
                        }
                        setOk("פק״ל נמחק");
                        await refresh();
                      } catch (err) {
                        setError(err instanceof Error ? err.message : "מחיקה נכשלה");
                      }
                    }}
                  >
                    מחק
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </SettingsAccordion>

      <SettingsAccordion
        title="תוויות"
        hint="עד 3 עמודות סיווג בכוח אדם (למשל מחלקה)"
      >
        <h2 style={{ marginTop: 0 }}>תוויות</h2>
        <p style={{ color: "var(--ink-soft)", marginTop: 0 }}>
          כל תווית היא עמודה בטבלת כוח אדם. בחרו שם ייעודי (למשל «מחלקה»), האם
          בחירה יחידה או מרובה, ואת רשימת הערכים. לא משפיע על אלגוריתם השיבוץ.
        </p>
        <form className="form-grid" onSubmit={savePersonLabel} style={{ maxWidth: 560 }}>
          <label>
            {editingLabelId ? "עריכת תווית" : "תווית חדשה"}
            <input
              value={labelName}
              onChange={(e) => setLabelName(e.target.value)}
              placeholder='לדוגמה: מחלקה, כיתה, צוות'
              required
              disabled={!editingLabelId && personLabels.length >= 3}
            />
          </label>
          <div>
            <div style={{ marginBottom: "0.4rem", color: "var(--ink-soft)" }}>
              מצב בחירה
            </div>
            <div className="people-chips">
              <button
                type="button"
                className={`chip ${labelMode === "single" ? "manual" : ""}`}
                onClick={() => setLabelMode("single")}
              >
                בחירה יחידה
              </button>
              <button
                type="button"
                className={`chip ${labelMode === "multi" ? "manual" : ""}`}
                onClick={() => setLabelMode("multi")}
              >
                בחירה מרובה
              </button>
            </div>
          </div>
          <label>
            ערכים (מופרדים בפסיק או שורה חדשה)
            <textarea
              value={labelOptionsText}
              onChange={(e) => setLabelOptionsText(e.target.value)}
              placeholder={"מחלקה א'\nמחלקה ב'\nמחלקה ג'"}
              rows={4}
            />
          </label>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button
              className="btn btn-primary"
              type="submit"
              disabled={!editingLabelId && personLabels.length >= 3}
            >
              {editingLabelId ? "שמור תווית" : "הוסף תווית"}
            </button>
            {editingLabelId ? (
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => resetLabelForm()}
              >
                ביטול
              </button>
            ) : null}
          </div>
          {!editingLabelId && personLabels.length >= 3 ? (
            <p style={{ color: "var(--ink-soft)", margin: 0 }}>
              הוגדרו 3 תוויות — מחקו אחת כדי להוסיף חדשה.
            </p>
          ) : null}
        </form>

        <table className="table" style={{ marginTop: "1rem" }}>
          <thead>
            <tr>
              <th>שם</th>
              <th>בחירה</th>
              <th>ערכים</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {personLabels.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ color: "var(--ink-soft)" }}>
                  עדיין אין תוויות
                </td>
              </tr>
            ) : (
              personLabels.map((lb) => (
                <tr key={lb.id}>
                  <td>{lb.name}</td>
                  <td>
                    {lb.selection_mode === "multi" ? "מרובה" : "יחידה"}
                  </td>
                  <td>
                    {lb.options
                      .filter((o) => o.is_active)
                      .map((o) => o.name)
                      .join(", ") || "—"}
                  </td>
                  <td style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
                    <button
                      className="btn btn-ghost btn-small"
                      type="button"
                      onClick={() => {
                        setEditingLabelId(lb.id);
                        setLabelName(lb.name);
                        setLabelMode(
                          lb.selection_mode === "multi" ? "multi" : "single"
                        );
                        setLabelOptionsText(
                          lb.options
                            .slice()
                            .sort((a, b) => a.sort_order - b.sort_order)
                            .map((o) => o.name)
                            .join("\n")
                        );
                      }}
                    >
                      עריכה
                    </button>
                    <button
                      className="btn btn-ghost btn-small"
                      type="button"
                      onClick={async () => {
                        if (!token) return;
                        const okConfirm = await confirm({
                          title: "מחיקת תווית",
                          message: `למחוק את התווית «${lb.name}»? הערכים יוסרו מכל החיילים.`,
                          confirmLabel: "מחק",
                          tone: "danger",
                        });
                        if (!okConfirm) return;
                        setError("");
                        setOk("");
                        try {
                          await api.deletePersonLabel(token, lb.id);
                          if (editingLabelId === lb.id) resetLabelForm();
                          setOk("תווית נמחקה");
                          await refresh();
                        } catch (err) {
                          setError(
                            err instanceof Error ? err.message : "מחיקה נכשלה"
                          );
                        }
                      }}
                    >
                      מחק
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </SettingsAccordion>

      <SettingsAccordion title="קנים מינימליים במוצב" hint="רצפת איוש לפי יום">
        <h2 style={{ marginTop: 0 }}>קנים מינימליים במוצב</h2>
        <p style={{ color: "var(--ink-soft)", marginTop: 0 }}>
          מספר החיילים המינימלי שחייב להישאר במוצב. מכסת האפטר = כוח אדם פעיל −
          מספר הקנים. תאריך ספציפי דורס ימי חול/סופ״ש.
        </p>
        <form className="form-grid" onSubmit={saveKanim} style={{ maxWidth: 520 }}>
          <label>
            סוג כלל
            <select
              value={kanimKind}
              onChange={(e) =>
                setKanimKind(e.target.value as "weekday" | "weekend" | "specific_date")
              }
            >
              <option value="weekday">ימי חול (א׳–ה׳)</option>
              <option value="weekend">סופ״ש (ו׳–ש׳)</option>
              <option value="specific_date">תאריך ספציפי</option>
            </select>
          </label>
          {kanimKind === "specific_date" ? (
            <label>
              תאריך
              <input
                type="date"
                value={kanimDate}
                onChange={(e) => setKanimDate(e.target.value)}
                required
              />
            </label>
          ) : null}
          <label>
            מספר קנים מינימלי
            <input
              type="number"
              min={0}
              value={kanimCount}
              onChange={(e) => setKanimCount(Number(e.target.value))}
              required
            />
          </label>
          <label>
            הערה (אופציונלי)
            <input
              value={kanimNotes}
              onChange={(e) => setKanimNotes(e.target.value)}
            />
          </label>
          <button className="btn btn-primary" type="submit">
            שמור כלל קנים
          </button>
        </form>
        <table className="table" style={{ marginTop: "1rem" }}>
          <thead>
            <tr>
              <th>סוג</th>
              <th>תאריך</th>
              <th>קנים</th>
              <th>הערה</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {kanimRules.map((r) => (
              <tr key={r.id}>
                <td>{kanimKindLabel(r.kind)}</td>
                <td>{r.specific_date || "—"}</td>
                <td>{r.min_count}</td>
                <td>{r.notes || "—"}</td>
                <td>
                  <button
                    className="btn btn-ghost btn-small"
                    type="button"
                    onClick={async () => {
                      if (!token) return;
                      const ok = await confirm({
                        title: "מחיקת כלל קנים",
                        message: "למחוק את כלל הקנים?",
                        confirmLabel: "מחק",
                        tone: "danger",
                      });
                      if (!ok) return;
                      await api.deleteKanimRule(token, r.id);
                      await refresh();
                    }}
                  >
                    מחק
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </SettingsAccordion>

      <SettingsAccordion
        title="כללי שיבוץ"
        hint="מנוחה, מעבר בין משימות ונוכחות מינימלית"
      >
        <h2 style={{ marginTop: 0 }}>כללי שיבוץ</h2>
        <p style={{ color: "var(--ink-soft)", marginTop: 0 }}>
          שלושה סוגי כללים: <strong>מעבר בין משימות</strong>,{" "}
          <strong>נוכחות מינימלית</strong>, ו־
          <strong>שעות שינה לפני אפטר</strong> (אחרי סיור לילה נשארים במוצב לפני
          יציאה הביתה).
        </p>

        <form
          className="form-grid"
          onSubmit={saveSchedulingRule}
          style={{ maxWidth: 640 }}
        >
          <label>
            סוג הכלל
            <select
              value={ruleKind}
              onChange={(e) =>
                setRuleKind(
                  e.target.value as
                    | "transition"
                    | "min_presence"
                    | "sleep_before_after"
                )
              }
            >
              <option value="transition">מעבר בין משימות</option>
              <option value="min_presence">נוכחות מינימלית בכל רגע</option>
              <option value="sleep_before_after">
                שעות שינה לפני יציאה לאפטר
              </option>
            </select>
          </label>

          {ruleKind === "transition" ? (
            <>
              <fieldset className="rule-chip-fieldset">
                <legend>אחרי משמרת מסוג</legend>
                <div className="chip-row">
                  {missionTypes.map((mt) => {
                    const on = ruleSources.includes(mt.id);
                    return (
                      <button
                        key={`src-${mt.id}`}
                        type="button"
                        className={`chip${on ? " active" : ""}`}
                        onClick={() =>
                          setRuleSources(toggleId(ruleSources, mt.id))
                        }
                      >
                        {on ? "✓ " : ""}
                        {mt.name}
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <label>
                של לפחות (שעות)
                <input
                  type="number"
                  min={0.5}
                  step={0.5}
                  max={48}
                  value={ruleMinHours}
                  onChange={(e) => setRuleMinHours(Number(e.target.value))}
                  required
                />
              </label>

              <fieldset className="rule-chip-fieldset">
                <legend>לא לשבץ לסוגים האלה</legend>
                <div className="chip-row">
                  {missionTypes.map((mt) => {
                    const on = ruleBlocked.includes(mt.id);
                    return (
                      <button
                        key={`blk-${mt.id}`}
                        type="button"
                        className={`chip${on ? " active" : ""}`}
                        onClick={() =>
                          setRuleBlocked(toggleId(ruleBlocked, mt.id))
                        }
                      >
                        {on ? "✓ " : ""}
                        {mt.name}
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <label>
                במשך (שעות מסוף המשמרת)
                <input
                  type="number"
                  min={0.5}
                  step={0.5}
                  max={72}
                  value={ruleCooldownHours}
                  onChange={(e) => setRuleCooldownHours(Number(e.target.value))}
                  required
                />
              </label>

              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={ruleAllRoles}
                  onChange={(e) => setRuleAllRoles(e.target.checked)}
                />
                חל על כל כוח האדם
              </label>

              {!ruleAllRoles ? (
                <fieldset className="rule-chip-fieldset">
                  <legend>חל רק על התפקידים</legend>
                  <div className="chip-row">
                    {activeRoles.map((r) => {
                      const on = ruleRoleIds.includes(r.id);
                      return (
                        <button
                          key={`role-${r.id}`}
                          type="button"
                          className={`chip${on ? " active" : ""}`}
                          onClick={() =>
                            setRuleRoleIds(toggleId(ruleRoleIds, r.id))
                          }
                        >
                          {on ? "✓ " : ""}
                          {r.name}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              ) : null}
            </>
          ) : ruleKind === "sleep_before_after" ? (
            <>
              <fieldset className="rule-chip-fieldset">
                <legend>אחרי משימות מסוג (שוברות שינה)</legend>
                <div className="chip-row">
                  {missionTypes.map((mt) => {
                    const on = ruleSources.includes(mt.id);
                    return (
                      <button
                        key={`sleep-src-${mt.id}`}
                        type="button"
                        className={`chip${on ? " active" : ""}`}
                        onClick={() =>
                          setRuleSources(toggleId(ruleSources, mt.id))
                        }
                      >
                        {on ? "✓ " : ""}
                        {mt.name}
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <label>
                שעות במוצב לפני יציאה לאפטר
                <input
                  type="number"
                  min={0.5}
                  step={0.5}
                  max={24}
                  value={ruleCooldownHours}
                  onChange={(e) => setRuleCooldownHours(Number(e.target.value))}
                  required
                />
              </label>

              <p style={{ margin: 0, color: "var(--ink-soft)", fontSize: "0.9rem" }}>
                לדוגמה: סיור לילה עד 05:00 ו־6 שעות שינה → אפטר רק מ־11:00.
                תורן מטבח לא נכלל כאן — רק הסוגים שסימנתם.
              </p>

              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={ruleAllRoles}
                  onChange={(e) => setRuleAllRoles(e.target.checked)}
                />
                חל על כל כוח האדם
              </label>

              {!ruleAllRoles ? (
                <fieldset className="rule-chip-fieldset">
                  <legend>חל רק על התפקידים</legend>
                  <div className="chip-row">
                    {activeRoles.map((r) => {
                      const on = ruleRoleIds.includes(r.id);
                      return (
                        <button
                          key={`sleep-role-${r.id}`}
                          type="button"
                          className={`chip${on ? " active" : ""}`}
                          onClick={() =>
                            setRuleRoleIds(toggleId(ruleRoleIds, r.id))
                          }
                        >
                          {on ? "✓ " : ""}
                          {r.name}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              ) : null}
            </>
          ) : (
            <>
              <label>
                לפחות כמה אנשים
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={ruleMinCount}
                  onChange={(e) => setRuleMinCount(Number(e.target.value))}
                  required
                />
              </label>

              <fieldset className="rule-chip-fieldset">
                <legend>מי נספר (תפקידים)</legend>
                <div className="chip-row">
                  {activeRoles.map((r) => {
                    const on = ruleRoleIds.includes(r.id);
                    return (
                      <button
                        key={`prole-${r.id}`}
                        type="button"
                        className={`chip${on ? " active" : ""}`}
                        onClick={() =>
                          setRuleRoleIds(toggleId(ruleRoleIds, r.id))
                        }
                      >
                        {on ? "✓ " : ""}
                        {r.name}
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <fieldset className="rule-chip-fieldset">
                <legend>מי נספר (פק״לים)</legend>
                <div className="chip-row">
                  {quals.map((q) => {
                    const on = ruleQualIds.includes(q.id);
                    return (
                      <button
                        key={`pq-${q.id}`}
                        type="button"
                        className={`chip${on ? " active" : ""}`}
                        onClick={() =>
                          setRuleQualIds(toggleId(ruleQualIds, q.id))
                        }
                      >
                        {on ? "✓ " : ""}
                        {q.name}
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <label>
                איפה הם חייבים להיות
                <select
                  value={rulePresenceScope}
                  onChange={(e) =>
                    setRulePresenceScope(
                      e.target.value as
                        | "not_at_home"
                        | "on_mission"
                        | "on_mission_types"
                    )
                  }
                >
                  <option value="not_at_home">
                    במוצב או בפעילות (לא בבית / אפטר / חופשה)
                  </option>
                  <option value="on_mission">משובצים למשימה כלשהי</option>
                  <option value="on_mission_types">
                    משובצים לסוגי משימה נבחרים (מוצב)
                  </option>
                </select>
              </label>

              {rulePresenceScope === "on_mission_types" ? (
                <fieldset className="rule-chip-fieldset">
                  <legend>סוגי משימה שנחשבים «במוצב»</legend>
                  <div className="chip-row">
                    {missionTypes.map((mt) => {
                      const on = ruleSources.includes(mt.id);
                      return (
                        <button
                          key={`outpost-${mt.id}`}
                          type="button"
                          className={`chip${on ? " active" : ""}`}
                          onClick={() =>
                            setRuleSources(toggleId(ruleSources, mt.id))
                          }
                        >
                          {on ? "✓ " : ""}
                          {mt.name}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              ) : null}
            </>
          )}

          <label>
            חומרת הכלל
            <select
              value={ruleSeverity}
              onChange={(e) =>
                setRuleSeverity(e.target.value as "hard" | "soft")
              }
            >
              <option value="hard">קשיח — אסור לשבור</option>
              <option value="soft">רך — אזהרה / עדיפות</option>
            </select>
          </label>

          <p className="rule-preview">{ruleSentencePreview()}</p>

          <button
            className="btn btn-primary"
            type="submit"
            disabled={
              ruleKind === "transition"
                ? !ruleSources.length || !ruleBlocked.length
                : ruleKind === "sleep_before_after"
                  ? !ruleSources.length
                  : (!ruleRoleIds.length && !ruleQualIds.length) ||
                    (rulePresenceScope === "on_mission_types" &&
                      !ruleSources.length)
            }
          >
            שמור כלל שיבוץ
          </button>
        </form>

        <table className="table" style={{ marginTop: "1rem" }}>
          <thead>
            <tr>
              <th>הכלל</th>
              <th>חומרה</th>
              <th>חל על</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {schedulingRules.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ color: "var(--ink-soft)" }}>
                  עדיין אין כללים — הוסיפו את הראשון למעלה.
                </td>
              </tr>
            ) : (
              schedulingRules.map((r) => (
                <tr key={r.id} style={{ opacity: r.is_active ? 1 : 0.55 }}>
                  <td>{formatRuleRow(r)}</td>
                  <td>{r.severity === "hard" ? "קשיח" : "רך"}</td>
                  <td>
                    {r.rule_kind === "min_presence"
                      ? "כיסוי רציף"
                      : r.rule_kind === "sleep_before_after"
                        ? r.applies_to_all_roles
                          ? "כולם"
                          : r.role_names.join(", ") || "—"
                        : r.applies_to_all_roles
                          ? "כולם"
                          : r.role_names.join(", ") || "—"}
                  </td>
                  <td>
                    <button
                      className="btn btn-ghost btn-small"
                      type="button"
                      onClick={async () => {
                        if (!token) return;
                        const okConfirm = await confirm({
                          title: "מחיקת כלל שיבוץ",
                          message: "למחוק את הכלל?",
                          confirmLabel: "מחק",
                          tone: "danger",
                        });
                        if (!okConfirm) return;
                        await api.deleteSchedulingRule(token, r.id);
                        setOk("הכלל נמחק");
                        await refresh();
                      }}
                    >
                      מחק
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </SettingsAccordion>

      <SettingsAccordion title="סוגי משימות (קטלוג)" hint="רוטינה, קושי ואיוש">
        <h2 style={{ marginTop: 0 }}>סוגי משימות (קטלוג)</h2>
        <p style={{ color: "var(--ink-soft)", marginTop: 0 }}>
          כאן מגדירים את סוגי המשימות הקבועים לפי הסדר: שם, קושי, מספר אנשים,
          רוטיני כן/לא (ואז תדירות + יממה מלאה או משמרות ספציפיות), דרישות,
          וכללי שיבוץ נפרדים. משימה מסומנת «בשיבוץ» מופיעה אוטומטית בטאב
          השיבוץ (בטיוטה פעילה) אחרי שמוגדרים משמרות/טווחים.
        </p>
        <form className="form-grid" onSubmit={createMissionType} style={{ maxWidth: 420 }}>
          <label>
            סוג משימה חדש
            <input
              value={newMtName}
              onChange={(e) => setNewMtName(e.target.value)}
              placeholder='לדוגמה: סיור, ש"ג, חמ"ל'
              required
            />
          </label>
          <button className="btn btn-primary" type="submit">
            הוסף סוג משימה
          </button>
        </form>
        <table className="table" style={{ marginTop: "1rem" }}>
          <thead>
            <tr>
              <th>סוג משימה</th>
              <th>קושי (מתוך 5)</th>
              <th>משך</th>
              <th>רוטינית</th>
              <th>דרישות חובה</th>
              <th>בשיבוץ</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {missionTypes.map((mt) => (
              <Fragment key={mt.id}>
                <tr>
                  <td>{mt.name}</td>
                  <td>{mt.difficulty_weight}/5</td>
                <td>
                  {mt.is_recurring_template
                    ? `${mt.default_duration_hours || "—"} ש׳`
                    : "—"}
                </td>
                <td>
                  {mt.is_recurring_template
                    ? [
                        mt.recurrence_kind === "every_n_days"
                          ? `כל ${mt.recurrence_interval_days || "?"} ימים`
                          : mt.recurrence_kind === "weekly"
                            ? `שבועי (${(mt.recurrence_weekdays || "")
                                .split(",")
                                .filter(Boolean)
                                .map((d) => {
                                  const hit = HEB_WEEKDAYS.find(
                                    (x) => x.py === Number(d)
                                  );
                                  return hit?.label || d;
                                })
                                .join(" ") || "—"})`
                            : "כל יום",
                        mt.routine_hours_mode === "custom"
                          ? `משמרות ספציפיות · ${(mt.time_windows || []).length}`
                          : `יממה מלאה · מ־${String(mt.recurring_start_hour ?? "—").padStart(2, "0")}:00 · כל ${mt.default_duration_hours || "—"} ש׳`,
                      ].join(" · ")
                    : (mt.time_windows || []).length
                      ? `לא · ${(mt.time_windows || [])
                          .map(
                            (w) =>
                              `${formatMinute(w.start_minute)}–${formatMinute(w.end_minute)}${
                                w.end_minute <= w.start_minute ? " (+)" : ""
                              }`
                          )
                          .join(" · ")}`
                      : "לא · חסרים טווחים"}
                </td>
                  <td>{reqLabel(mt) || "—"}</td>
                  <td>
                    <label
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "0.35rem",
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={mt.is_active}
                        onChange={() => toggleMissionInScheduling(mt)}
                        aria-label={`הכלל את ${mt.name} בשיבוץ`}
                      />
                      {mt.is_active ? "כן" : "לא"}
                    </label>
                  </td>
                  <td style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
                    <button
                      className="btn btn-ghost btn-small"
                      type="button"
                      onClick={() =>
                        editingMtId === mt.id
                          ? setEditingMtId(null)
                          : startEditMt(mt)
                      }
                    >
                      {editingMtId === mt.id ? "סגור" : "עריכה"}
                    </button>
                    <button
                      className="btn btn-ghost btn-small"
                      type="button"
                      onClick={async () => {
                        if (!token) return;
                        const ok = await confirm({
                          title: "מחיקת סוג משימה",
                          message: `למחוק את סוג המשימה «${mt.name}»?`,
                          confirmLabel: "מחק",
                          tone: "danger",
                        });
                        if (!ok) return;
                        setError("");
                        setOk("");
                        try {
                          await api.deleteMissionType(token, mt.id);
                          if (editingMtId === mt.id) setEditingMtId(null);
                          setOk("סוג משימה נמחק");
                          await refresh();
                        } catch (err) {
                          setError(err instanceof Error ? err.message : "מחיקה נכשלה");
                        }
                      }}
                    >
                      מחק
                    </button>
                  </td>
                </tr>
                {editingMtId === mt.id ? (
                  <tr>
                    <td colSpan={7} style={{ background: "var(--panel-muted, #f6f4ef)" }}>
                      <form
                        className="form-grid"
                        onSubmit={saveMissionType}
                        style={{ margin: "0.5rem 0", maxWidth: 720 }}
                      >
                        <label>
                          שם
                          <input
                            value={mtName}
                            onChange={(e) => setMtName(e.target.value)}
                            required
                          />
                        </label>
                        <label>
                          קושי (מתוך 5)
                          <input
                            type="number"
                            min={1}
                            max={5}
                            step={1}
                            value={mtDifficulty}
                            onChange={(e) => setMtDifficulty(Number(e.target.value))}
                          />
                          <span
                            style={{
                              display: "block",
                              marginTop: "0.3rem",
                              fontSize: "0.85rem",
                              color: "var(--ink-soft)",
                            }}
                          >
                            1/5 הכי קל · 5/5 הכי קשה
                          </span>
                        </label>
                        {!(mtRecurring && mtBands.length > 0) ? (
                          <label>
                            מספר אנשים ברירת מחדל
                            <input
                              type="number"
                              min={1}
                              value={mtCount}
                              onChange={(e) =>
                                setMtCountAndFit(Number(e.target.value))
                              }
                            />
                          </label>
                        ) : null}
                        <div>
                          <div style={{ marginBottom: "0.4rem", color: "var(--ink-soft)" }}>
                            האם סוג זה רוטיני?
                          </div>
                          <p
                            style={{
                              margin: "0 0 0.5rem",
                              color: "var(--ink-soft)",
                              fontSize: "0.9rem",
                            }}
                          >
                            רוטיני = חוזרת לפי תדירות ימים (כל יום / כל X ימים /
                            ימים בשבוע). התדירות קובעת מתי היום פעיל; אחר כך
                            בוחרים איך למלא את היום — יממה מלאה או משמרות
                            ספציפיות. לא רוטיני = טווחי שעות קבועים בכל יום
                            (למשל 05:30–07:00 ו־18:00–19:30), כולל חציית חצות.
                          </p>
                          <div className="people-chips">
                            <button
                              type="button"
                              className={`chip ${mtRecurring ? "manual" : ""}`}
                              onClick={() => setMtRecurring(true)}
                            >
                              כן — רוטיני
                            </button>
                            <button
                              type="button"
                              className={`chip ${!mtRecurring ? "manual" : ""}`}
                              onClick={() => setMtRecurring(false)}
                            >
                              לא
                            </button>
                          </div>
                        </div>

                        {mtRecurring ? (
                          <>
                            <div style={{ gridColumn: "1 / -1" }}>
                              <div
                                style={{
                                  marginBottom: "0.4rem",
                                  color: "var(--ink-soft)",
                                }}
                              >
                                תדירות ימים
                              </div>
                              <div className="people-chips">
                                <button
                                  type="button"
                                  className={`chip ${mtRecurrenceKind === "daily" ? "manual" : ""}`}
                                  onClick={() => setMtRecurrenceKind("daily")}
                                >
                                  כל יום
                                </button>
                                <button
                                  type="button"
                                  className={`chip ${mtRecurrenceKind === "every_n_days" ? "manual" : ""}`}
                                  onClick={() =>
                                    setMtRecurrenceKind("every_n_days")
                                  }
                                >
                                  כל X ימים
                                </button>
                                <button
                                  type="button"
                                  className={`chip ${mtRecurrenceKind === "weekly" ? "manual" : ""}`}
                                  onClick={() => setMtRecurrenceKind("weekly")}
                                >
                                  ימים בשבוע
                                </button>
                              </div>
                              {mtRecurrenceKind === "every_n_days" ? (
                                <div
                                  className="form-grid"
                                  style={{
                                    marginTop: "0.65rem",
                                    gridTemplateColumns: "140px 1fr",
                                  }}
                                >
                                  <label>
                                    כל כמה ימים
                                    <input
                                      type="number"
                                      min={2}
                                      value={mtIntervalDays}
                                      onChange={(e) =>
                                        setMtIntervalDays(
                                          Math.max(2, Number(e.target.value) || 2)
                                        )
                                      }
                                    />
                                  </label>
                                  <label>
                                    תאריך עוגן (חובה)
                                    <input
                                      type="date"
                                      value={mtAnchorDate}
                                      onChange={(e) =>
                                        setMtAnchorDate(e.target.value)
                                      }
                                      required
                                    />
                                  </label>
                                </div>
                              ) : null}
                              {mtRecurrenceKind === "weekly" ? (
                                <div
                                  className="people-chips"
                                  style={{ marginTop: "0.65rem" }}
                                >
                                  {HEB_WEEKDAYS.map((d) => {
                                    const on = mtWeekdays.includes(d.py);
                                    return (
                                      <button
                                        key={d.py}
                                        type="button"
                                        className={`chip ${on ? "manual" : ""}`}
                                        onClick={() =>
                                          setMtWeekdays((prev) =>
                                            on
                                              ? prev.filter((x) => x !== d.py)
                                              : [...prev, d.py]
                                          )
                                        }
                                      >
                                        {d.label}
                                      </button>
                                    );
                                  })}
                                </div>
                              ) : null}
                            </div>

                            <div style={{ gridColumn: "1 / -1" }}>
                              <div
                                style={{
                                  marginBottom: "0.4rem",
                                  color: "var(--ink-soft)",
                                }}
                              >
                                איך למלא את היום?
                              </div>
                              <p
                                style={{
                                  margin: "0 0 0.5rem",
                                  color: "var(--ink-soft)",
                                  fontSize: "0.9rem",
                                }}
                              >
                                התדירות למעלה קובעת מתי היום פעיל. כאן בוחרים
                                מה קורה בתוך היום: יממה מלאה (ממלאים את כל
                                ה־24 שעות במשמרות) או משמרות ספציפיות בלבד
                                (למשל תורנות מטבח 08:00–20:00 בלי למלא את
                                הלילה).
                              </p>
                              <div className="people-chips">
                                <button
                                  type="button"
                                  className={`chip ${mtHoursMode === "uniform" ? "manual" : ""}`}
                                  onClick={() => setMtHoursMode("uniform")}
                                >
                                  יממה מלאה
                                </button>
                                <button
                                  type="button"
                                  className={`chip ${mtHoursMode === "custom" ? "manual" : ""}`}
                                  onClick={() => {
                                    setMtHoursMode("custom");
                                    setMtSegments((prev) => {
                                      if (prev.length > 0 && prev.some((s) => s.start)) {
                                        return prev;
                                      }
                                      return [
                                        {
                                          start: `${String(mtStartHour).padStart(2, "0")}:00`,
                                          durationHours: mtDuration > 0 ? mtDuration : 8,
                                        },
                                      ];
                                    });
                                  }}
                                >
                                  משמרות ספציפיות
                                </button>
                              </div>
                            </div>

                            {mtHoursMode === "uniform" ? (
                              <>
                            <label>
                              משך משמרת (שעות)
                              <input
                                type="number"
                                min={0.5}
                                step={0.5}
                                value={mtDuration}
                                onChange={(e) =>
                                  setMtDuration(Number(e.target.value))
                                }
                              />
                            </label>
                            <div style={{ gridColumn: "1 / -1" }}>
                              <p
                                style={{
                                  margin: "0 0 0.55rem",
                                  color: "var(--ink-soft)",
                                  fontSize: "0.9rem",
                                }}
                              >
                                ממלאים את כל היממה במשמרות מחזוריות לפי משך
                                ושעת התחלה (למשל כל 8 שעות מ־08:00).
                              </p>
                              <label style={{ display: "block", maxWidth: 220 }}>
                                שעת התחלת מחזור (חובה)
                                <select
                                  value={mtStartHour}
                                  onChange={(e) =>
                                    setMtStartHour(Number(e.target.value))
                                  }
                                  required
                                >
                                  {Array.from({ length: 24 }, (_, h) => (
                                    <option key={h} value={h}>
                                      {String(h).padStart(2, "0")}:00
                                    </option>
                                  ))}
                                </select>
                              </label>

                              {routineUneven ? (
                                <div
                                  role="status"
                                  style={{
                                    marginTop: "0.75rem",
                                    padding: "0.75rem 1rem",
                                    border: "1px solid #c9a227",
                                    background: "#fff8e1",
                                    borderRadius: 8,
                                  }}
                                >
                                  <strong>
                                    המשמרות לא מתכנסות בדיוק ל־24 שעות
                                  </strong>
                                  <p style={{ margin: "0.4rem 0 0.75rem" }}>
                                    משך {mtDuration} שעות משאיר שארית של{" "}
                                    {Math.round(
                                      (24 -
                                        Math.floor(24 / mtDuration) *
                                          mtDuration) *
                                        1000
                                    ) / 1000}{" "}
                                    שעות. בחרו איך לטפל בזה:
                                  </p>
                                  <div
                                    style={{
                                      display: "flex",
                                      flexDirection: "column",
                                      gap: "0.5rem",
                                    }}
                                  >
                                    <label
                                      style={{
                                        display: "flex",
                                        gap: "0.5rem",
                                        alignItems: "flex-start",
                                        cursor: "pointer",
                                      }}
                                    >
                                      <input
                                        type="radio"
                                        name={`remainder-${mt.id}`}
                                        checked={
                                          mtRemainderPolicy === "include_short"
                                        }
                                        onChange={() =>
                                          setMtRemainderPolicy("include_short")
                                        }
                                      />
                                      <span>
                                        לכלול משמרת קצרה בסוף המחזור (למשל
                                        10+10+4)
                                      </span>
                                    </label>
                                    <label
                                      style={{
                                        display: "flex",
                                        gap: "0.5rem",
                                        alignItems: "flex-start",
                                        cursor: "pointer",
                                      }}
                                    >
                                      <input
                                        type="radio"
                                        name={`remainder-${mt.id}`}
                                        checked={mtRemainderPolicy === "full_only"}
                                        onChange={() =>
                                          setMtRemainderPolicy("full_only")
                                        }
                                      />
                                      <span>
                                        רק משמרות מלאות — להשאיר פער בשארית
                                        (למשל 10+10)
                                      </span>
                                    </label>
                                  </div>
                                </div>
                              ) : null}

                              {routinePreview.length > 0 ? (
                                <p
                                  style={{
                                    margin: "0.75rem 0 0",
                                    color: "var(--ink-soft)",
                                    fontSize: "0.92rem",
                                  }}
                                >
                                  תצוגה מקדימה ליום:{" "}
                                  {routinePreview
                                    .map((s) =>
                                      formatSegmentLabel(s.startHour, s.length)
                                    )
                                    .join(" · ")}
                                </p>
                              ) : null}
                            </div>
                              </>
                            ) : (
                              <div style={{ gridColumn: "1 / -1" }}>
                                <p
                                  style={{
                                    margin: "0 0 0.55rem",
                                    color: "var(--ink-soft)",
                                    fontSize: "0.9rem",
                                  }}
                                >
                                  הגדירו רק את המשמרות שרצות ביום הפעיל —
                                  התחלה + משך לכל משמרת. אפשר כמה משמרות אם
                                  צריך (למשל 08:00 ל־12 ש׳ בלבד, בלי למלא את
                                  שאר היממה).
                                </p>
                                {mtSegments.map((seg, idx) => (
                                  <div
                                    key={idx}
                                    className="form-grid"
                                    style={{
                                      gridTemplateColumns: "1fr 120px auto",
                                      marginBottom: "0.45rem",
                                      alignItems: "end",
                                    }}
                                  >
                                    <label>
                                      שעת התחלה
                                      <input
                                        value={seg.start}
                                        onChange={(e) => {
                                          const next = [...mtSegments];
                                          next[idx] = {
                                            ...seg,
                                            start: e.target.value,
                                          };
                                          setMtSegments(next);
                                        }}
                                        placeholder="08:00"
                                      />
                                    </label>
                                    <label>
                                      משך (שעות)
                                      <input
                                        type="number"
                                        min={0.5}
                                        step={0.5}
                                        value={seg.durationHours}
                                        onChange={(e) => {
                                          const next = [...mtSegments];
                                          next[idx] = {
                                            ...seg,
                                            durationHours: Number(e.target.value),
                                          };
                                          setMtSegments(next);
                                        }}
                                      />
                                    </label>
                                    <button
                                      type="button"
                                      className="btn btn-ghost btn-small"
                                      disabled={mtSegments.length <= 1}
                                      onClick={() =>
                                        setMtSegments((prev) =>
                                          prev.filter((_, i) => i !== idx)
                                        )
                                      }
                                    >
                                      הסר
                                    </button>
                                  </div>
                                ))}
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-small"
                                  onClick={() =>
                                    setMtSegments((prev) => [
                                      ...prev,
                                      { start: "16:00", durationHours: 8 },
                                    ])
                                  }
                                >
                                  הוסף משמרת
                                </button>
                                {customPreview.length > 0 ? (
                                  <p
                                    style={{
                                      margin: "0.65rem 0 0",
                                      color: "var(--ink-soft)",
                                      fontSize: "0.92rem",
                                    }}
                                  >
                                    תצוגה מקדימה ליום: {customPreview.join(" · ")}
                                  </p>
                                ) : null}
                              </div>
                            )}

                            <div style={{ gridColumn: "1 / -1", marginTop: "0.75rem" }}>
                              <div
                                style={{
                                  marginBottom: "0.4rem",
                                  color: "var(--ink-soft)",
                                }}
                              >
                                איוש לפי שעות (אופציונלי)
                              </div>
                              <p
                                style={{
                                  margin: "0 0 0.6rem",
                                  color: "var(--ink-soft)",
                                  fontSize: "0.88rem",
                                }}
                              >
                                לדוגמה ש״ג: יום 06:00–18:00 עם חייל אחד, לילה
                                18:00–06:00 עם שניים. כל משמרת מקבלת את האיוש לפי
                                שעת ההתחלה שלה. בלי רצועות — איוש אחיד לכל היממה.
                              </p>
                              {mtBands.map((band, bIdx) => (
                                <div
                                  key={bIdx}
                                  style={{
                                    border: "1px solid var(--line)",
                                    borderRadius: 10,
                                    padding: "0.65rem 0.75rem",
                                    marginBottom: "0.55rem",
                                    background: "#fff",
                                  }}
                                >
                                  <div
                                    style={{
                                      display: "flex",
                                      gap: "0.4rem",
                                      flexWrap: "wrap",
                                      alignItems: "center",
                                      marginBottom: "0.45rem",
                                    }}
                                  >
                                    <input
                                      placeholder="שם רצועה (יום/לילה)"
                                      value={band.label}
                                      onChange={(e) => {
                                        const next = [...mtBands];
                                        next[bIdx] = {
                                          ...band,
                                          label: e.target.value,
                                        };
                                        setMtBands(next);
                                      }}
                                      style={{ maxWidth: 140 }}
                                    />
                                    <input
                                      type="time"
                                      value={band.start}
                                      onChange={(e) => {
                                        const next = [...mtBands];
                                        next[bIdx] = {
                                          ...band,
                                          start: e.target.value,
                                        };
                                        setMtBands(next);
                                      }}
                                    />
                                    <span>—</span>
                                    <input
                                      type="time"
                                      value={band.end}
                                      onChange={(e) => {
                                        const next = [...mtBands];
                                        next[bIdx] = {
                                          ...band,
                                          end: e.target.value,
                                        };
                                        setMtBands(next);
                                      }}
                                    />
                                    <label
                                      style={{
                                        display: "inline-flex",
                                        gap: "0.3rem",
                                        alignItems: "center",
                                      }}
                                    >
                                      אנשים
                                      <input
                                        type="number"
                                        min={1}
                                        value={band.personnel}
                                        style={{ width: 64 }}
                                        onChange={(e) => {
                                          const next = [...mtBands];
                                          const personnel = Math.max(
                                            1,
                                            Number(e.target.value) || 1
                                          );
                                          next[bIdx] = {
                                            ...band,
                                            personnel,
                                            reqs: fitReqsToPersonnel(
                                              band.reqs,
                                              personnel
                                            ),
                                          };
                                          setMtBands(next);
                                        }}
                                      />
                                    </label>
                                    <button
                                      className="btn btn-ghost btn-small"
                                      type="button"
                                      onClick={() =>
                                        setMtBands(
                                          mtBands.filter((_, i) => i !== bIdx)
                                        )
                                      }
                                    >
                                      הסר רצועה
                                    </button>
                                  </div>
                                  {band.reqs.map((r, rIdx) => {
                                    const activeQuals = quals.filter(
                                      (q) => q.is_active
                                    );
                                    return (
                                      <div
                                        key={rIdx}
                                        style={{
                                          display: "flex",
                                          gap: "0.35rem",
                                          flexWrap: "wrap",
                                          alignItems: "center",
                                          marginBottom: "0.35rem",
                                        }}
                                      >
                                        <span style={{ color: "var(--ink-soft)" }}>
                                          תפקיד
                                        </span>
                                        <select
                                          value={
                                            r.roleId !== ""
                                              ? r.roleId
                                              : activeRoles[0]?.id ?? ""
                                          }
                                          onChange={(e) => {
                                            const next = [...mtBands];
                                            const reqs = [...band.reqs];
                                            reqs[rIdx] = {
                                              ...r,
                                              roleId: e.target.value
                                                ? Number(e.target.value)
                                                : "",
                                            };
                                            next[bIdx] = { ...band, reqs };
                                            setMtBands(next);
                                          }}
                                        >
                                          {activeRoles.map((item) => (
                                            <option key={item.id} value={item.id}>
                                              {item.name}
                                            </option>
                                          ))}
                                        </select>
                                        <span style={{ color: "var(--ink-soft)" }}>
                                          פק״ל
                                        </span>
        <select
                                          value={r.qualId !== "" ? r.qualId : ""}
                                          onChange={(e) => {
                                            const next = [...mtBands];
                                            const reqs = [...band.reqs];
                                            const qualId = e.target.value
                                              ? Number(e.target.value)
                                              : "";
                                            reqs[rIdx] = {
                                              ...r,
                                              qualId,
                                              exactQual:
                                                qualId === ""
                                                  ? false
                                                  : r.qualId === ""
                                                    ? true
                                                    : Boolean(r.exactQual),
                                            };
                                            next[bIdx] = { ...band, reqs };
                                            setMtBands(next);
                                          }}
                                        >
                                          <option value="">ללא</option>
                                          {activeQuals.map((item) => (
                                            <option key={item.id} value={item.id}>
                                              {item.name}
                                            </option>
                                          ))}
                                        </select>
                                        <input
                                          type="number"
                                          min={1}
                                          value={r.count}
                                          style={{ width: 60 }}
                                          onChange={(e) => {
                                            const next = [...mtBands];
                                            const reqs = [...band.reqs];
                                            reqs[rIdx] = {
                                              ...r,
                                              count: Number(e.target.value),
                                            };
                                            next[bIdx] = {
                                              ...band,
                                              reqs: fitReqsToPersonnel(
                                                reqs,
                                                band.personnel
                                              ),
                                            };
                                            setMtBands(next);
                                          }}
                                        />
                                        <label
                                          style={{
                                            display: "inline-flex",
                                            gap: "0.3rem",
                                            alignItems: "center",
                                            color: "var(--ink-soft)",
                                            fontSize: "0.88rem",
                                            whiteSpace: "nowrap",
                                          }}
                                          title="בלי יכולות מילוי בין תפקידים — רק מי שתפקידו זה בדיוק"
                                        >
                                          <input
                                            type="checkbox"
                                            checked={Boolean(r.exactRole)}
                                            onChange={(e) => {
                                              const next = [...mtBands];
                                              const reqs = [...band.reqs];
                                              reqs[rIdx] = {
                                                ...r,
                                                exactRole: e.target.checked,
                                              };
                                              next[bIdx] = { ...band, reqs };
                                              setMtBands(next);
                                            }}
                                          />
                                          רק תפקיד זה במדויק
                                        </label>
                                        <label
                                          style={{
                                            display: "inline-flex",
                                            gap: "0.3rem",
                                            alignItems: "center",
                                            color: "var(--ink-soft)",
                                            fontSize: "0.88rem",
                                            whiteSpace: "nowrap",
                                            opacity: r.qualId === "" ? 0.45 : 1,
                                          }}
                                          title="חובה שהחייל יחזיק בפק״ל שנבחר (בלי זה זו רק העדפה)"
                                        >
                                          <input
                                            type="checkbox"
                                            checked={Boolean(r.exactQual)}
                                            disabled={r.qualId === ""}
                                            onChange={(e) => {
                                              const next = [...mtBands];
                                              const reqs = [...band.reqs];
                                              reqs[rIdx] = {
                                                ...r,
                                                exactQual: e.target.checked,
                                              };
                                              next[bIdx] = { ...band, reqs };
                                              setMtBands(next);
                                            }}
                                          />
                                          רק פק״ל זה במדויק
                                        </label>
                                        <button
                                          className="btn btn-ghost btn-small"
                                          type="button"
                                          onClick={() => {
                                            const next = [...mtBands];
                                            next[bIdx] = {
                                              ...band,
                                              reqs: band.reqs.filter(
                                                (_, i) => i !== rIdx
                                              ),
                                            };
                                            setMtBands(next);
                                          }}
                                        >
                                          הסר
                                        </button>
                                      </div>
                                    );
                                  })}
                                  <button
                                    className="btn btn-ghost btn-small"
                                    type="button"
                                    onClick={() => {
                                      const remaining =
                                        band.personnel - reqsTotal(band.reqs);
                                      if (remaining <= 0) return;
                                      const next = [...mtBands];
                                      next[bIdx] = {
                                        ...band,
                                        reqs: [
                                          ...band.reqs,
                                          {
                                            roleId: activeRoles[0]?.id ?? "",
                                            qualId: "",
                                            count: 1,
                                            exactRole: false,
                                            exactQual: true,
                                          },
                                        ],
                                      };
                                      setMtBands(next);
                                    }}
                                  >
                                    הוסף דרישה לרצועה
                                  </button>
                                </div>
                              ))}
                              <button
                                className="btn btn-ghost btn-small"
                                type="button"
                                onClick={() =>
                                  setMtBands([
                                    ...mtBands,
                                    {
                                      label: mtBands.length === 0 ? "יום" : "לילה",
                                      start:
                                        mtBands.length === 0 ? "06:00" : "18:00",
                                      end:
                                        mtBands.length === 0 ? "18:00" : "06:00",
                                      personnel: mtBands.length === 0 ? 1 : 2,
                                      reqs: [
                                        {
                                          roleId: activeRoles[0]?.id ?? "",
                                          qualId: "",
                                          count: mtBands.length === 0 ? 1 : 2,
                                          exactRole: false,
                                          exactQual: true,
                                        },
                                      ],
                                    },
                                  ])
                                }
                              >
                                הוסף רצועת איוש
                              </button>
                            </div>
                          </>
                        ) : (
                          <div style={{ gridColumn: "1 / -1" }}>
                            <div
                              style={{
                                marginBottom: "0.5rem",
                                color: "var(--ink-soft)",
                              }}
                            >
                              טווחי שעות ביום השיבוץ (חובה לפחות אחד)
                            </div>
                            <p
                              style={{
                                margin: "0 0 0.6rem",
                                color: "var(--ink-soft)",
                                fontSize: "0.9rem",
                              }}
                            >
                              אם שעת הסיום קטנה או שווה להתחלה — הטווח חוצה חצות
                              (למשל 22:00–06:00).
                            </p>
                            {mtWindows.map((w, idx) => (
                              <div
                                key={idx}
                                style={{
                                  display: "flex",
                                  gap: "0.4rem",
                                  flexWrap: "wrap",
                                  alignItems: "center",
                                  marginBottom: "0.45rem",
                                }}
                              >
                                <input
                                  type="time"
                                  value={w.start}
                                  onChange={(e) => {
                                    const next = [...mtWindows];
                                    next[idx] = {
                                      ...w,
                                      start: e.target.value,
                                    };
                                    setMtWindows(next);
                                  }}
                                  required
                                />
                                <span>—</span>
                                <input
                                  type="time"
                                  value={w.end}
                                  onChange={(e) => {
                                    const next = [...mtWindows];
                                    next[idx] = { ...w, end: e.target.value };
                                    setMtWindows(next);
                                  }}
                                  required
                                />
                                {(() => {
                                  const sm = parseTimeToMinute(w.start);
                                  const em = parseTimeToMinute(w.end);
                                  if (sm == null || em == null || em > sm) return null;
                                  return (
                                    <span
                                      style={{
                                        color: "var(--ink-soft)",
                                        fontSize: "0.85rem",
                                      }}
                                    >
                                      (ליום הבא)
                                    </span>
                                  );
                                })()}
                                <button
                                  className="btn btn-ghost btn-small"
                                  type="button"
                                  onClick={() =>
                                    setMtWindows(
                                      mtWindows.filter((_, i) => i !== idx)
                                    )
                                  }
                                  disabled={mtWindows.length <= 1}
                                >
                                  הסר
                                </button>
                              </div>
                            ))}
                            <button
                              className="btn btn-ghost btn-small"
                              type="button"
                              onClick={() =>
                                setMtWindows([
                                  ...mtWindows,
                                  { start: "18:00", end: "19:30" },
                                ])
                              }
                            >
                              הוסף טווח שעות
                            </button>
                          </div>
                        )}

                        {!(mtRecurring && mtBands.length > 0) ? (
                        <div style={{ gridColumn: "1 / -1" }}>
                          <div
                            style={{
                              marginBottom: "0.5rem",
                              color: "var(--ink-soft)",
                            }}
                          >
                            דרישות (תפקיד ופק״ל) — סה״כ {reqsTotal() || 0} מתוך{" "}
                            {mtCount} אנשים
                            {reqsTotal() > mtCount ? (
                              <span style={{ color: "var(--danger)" }}>
                                {" "}
                                (חריגה)
                              </span>
                            ) : null}
                          </div>
                          {reqs.map((r, idx) => {
                            const activeQuals = quals.filter((q) => q.is_active);
                            const roleSelected =
                              r.roleId !== "" &&
                              activeRoles.some((o) => o.id === r.roleId)
                                ? r.roleId
                                : activeRoles[0]?.id ?? "";
                            const qualSelected =
                              r.qualId !== "" &&
                              activeQuals.some((o) => o.id === r.qualId)
                                ? r.qualId
                                : "";
                            return (
                              <div
                                key={idx}
                                style={{
                                  display: "flex",
                                  gap: "0.4rem",
                                  flexWrap: "wrap",
                                  marginBottom: "0.5rem",
                                  alignItems: "center",
                                }}
                              >
                                <span
                                  style={{
                                    minWidth: "3.2rem",
                                    color: "var(--ink-soft)",
                                  }}
                                >
                                  תפקיד
                                </span>
                                <select
                                  value={roleSelected}
                                  onChange={(e) => {
                                    const next = [...reqs];
                                    next[idx] = {
                                      ...r,
                                      roleId: e.target.value
                                        ? Number(e.target.value)
                                        : "",
                                    };
                                    setReqsCapped(next);
                                  }}
                                  required
                                  disabled={activeRoles.length === 0}
                                >
                                  {activeRoles.map((item) => (
                                    <option key={item.id} value={item.id}>
                                      {item.name}
                                    </option>
                                  ))}
                                </select>
                                <span style={{ color: "var(--ink-soft)" }}>
                                  פק״ל
                                </span>
                                <select
                                  value={qualSelected}
                                  onChange={(e) => {
                                    const next = [...reqs];
                                    const qualId = e.target.value
                                      ? Number(e.target.value)
                                      : "";
                                    next[idx] = {
                                      ...r,
                                      qualId,
                                      exactQual:
                                        qualId === ""
                                          ? false
                                          : r.qualId === ""
                                            ? true
                                            : Boolean(r.exactQual),
                                    };
                                    setReqsCapped(next);
                                  }}
                                >
                                  <option value="">ללא</option>
                                  {activeQuals.map((item) => (
                                    <option key={item.id} value={item.id}>
                                      {item.name}
                                    </option>
                                  ))}
                                </select>
                                <input
                                  type="number"
                                  min={1}
                                  value={r.count}
                                  style={{ width: 70 }}
                                  onChange={(e) => {
                                    const next = [...reqs];
                                    next[idx] = {
                                      ...r,
                                      count: Number(e.target.value),
                                    };
                                    setReqsCapped(next);
                                  }}
                                />
                                <label
                                  style={{
                                    display: "inline-flex",
                                    gap: "0.3rem",
                                    alignItems: "center",
                                    color: "var(--ink-soft)",
                                    fontSize: "0.88rem",
                                    whiteSpace: "nowrap",
                                  }}
                                  title="בלי יכולות מילוי בין תפקידים — רק מי שתפקידו זה בדיוק"
                                >
                                  <input
                                    type="checkbox"
                                    checked={Boolean(r.exactRole)}
                                    onChange={(e) => {
                                      const next = [...reqs];
                                      next[idx] = {
                                        ...r,
                                        exactRole: e.target.checked,
                                      };
                                      setReqsCapped(next);
                                    }}
                                  />
                                  רק תפקיד זה במדויק
                                </label>
                                <label
                                  style={{
                                    display: "inline-flex",
                                    gap: "0.3rem",
                                    alignItems: "center",
                                    color: "var(--ink-soft)",
                                    fontSize: "0.88rem",
                                    whiteSpace: "nowrap",
                                    opacity: qualSelected === "" ? 0.45 : 1,
                                  }}
                                  title="חובה שהחייל יחזיק בפק״ל שנבחר (בלי זה זו רק העדפה)"
                                >
                                  <input
                                    type="checkbox"
                                    checked={Boolean(r.exactQual)}
                                    disabled={qualSelected === ""}
                                    onChange={(e) => {
                                      const next = [...reqs];
                                      next[idx] = {
                                        ...r,
                                        exactQual: e.target.checked,
                                      };
                                      setReqsCapped(next);
                                    }}
                                  />
                                  רק פק״ל זה במדויק
                                </label>
                                <button
                                  className="btn btn-ghost btn-small"
                                  type="button"
                                  onClick={() =>
                                    setReqsCapped(
                                      reqs.filter((_, i) => i !== idx)
                                    )
                                  }
                                >
                                  הסר
                                </button>
                              </div>
                            );
                          })}
                          <div
                            style={{
                              display: "flex",
                              gap: "0.5rem",
                              flexWrap: "wrap",
                            }}
                          >
                            <button
                              className="btn btn-ghost btn-small"
                              type="button"
                              onClick={() => addRequirement()}
                            >
                              הוסף דרישה
                            </button>
                          </div>
                        </div>
                        ) : null}

                        <div style={{ display: "flex", gap: "0.5rem" }}>
                          <button className="btn btn-primary" type="submit">
                            שמור סוג משימה
                          </button>
                          <button
                            className="btn btn-ghost"
                            type="button"
                            onClick={() => setEditingMtId(null)}
                          >
                            ביטול
                          </button>
                        </div>
                      </form>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      </SettingsAccordion>
    </AppShell>
  );
}
