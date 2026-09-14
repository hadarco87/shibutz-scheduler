"use client";

import { FormEvent, Fragment, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth";
import {
  api,
  KanimRule,
  MissionType,
  MissionTypeRequirement,
  Qualification,
  Role,
} from "@/lib/api";
import {
  buildRoutineSegments,
  formatMinute,
  formatSegmentLabel,
  parseTimeToMinute,
  RemainderPolicy,
  routineCoversFullDay,
} from "@/lib/routine";

type ReqDraft = {
  roleId: number | "";
  qualId: number | "";
  count: number;
};

type WindowDraft = { start: string; end: string };

type BandDraft = {
  label: string;
  start: string;
  end: string;
  personnel: number;
  reqs: ReqDraft[];
};

export default function SettingsPage() {
  const { token } = useAuth();
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

  const [editingMtId, setEditingMtId] = useState<number | null>(null);
  const [mtName, setMtName] = useState("");
  const [mtDifficulty, setMtDifficulty] = useState(1);
  const [mtCount, setMtCount] = useState(1);
  const [mtDuration, setMtDuration] = useState(8);
  const [mtRecurring, setMtRecurring] = useState(false);
  const [mtStartHour, setMtStartHour] = useState(8);
  const [mtRemainderPolicy, setMtRemainderPolicy] =
    useState<RemainderPolicy>("include_short");
  const [mtSleep, setMtSleep] = useState(0);
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

  const activeRoles = useMemo(() => roles.filter((r) => r.is_active), [roles]);

  const routinePreview = useMemo(() => {
    if (!mtRecurring || mtDuration <= 0) return [];
    return buildRoutineSegments(mtDuration, mtStartHour, mtRemainderPolicy);
  }, [mtRecurring, mtDuration, mtStartHour, mtRemainderPolicy]);

  const routineUneven = mtRecurring && !routineCoversFullDay(mtDuration);

  const refresh = useCallback(async () => {
    if (!token) return;
    const [q, r, mt, kr] = await Promise.all([
      api.qualifications(token),
      api.roles(token),
      api.missionTypes(token),
      api.kanimRules(token),
    ]);
    setQuals(q);
    setRoles(r);
    setMissionTypes(mt);
    setKanimRules(kr);
  }, [token]);

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
    setMtSleep(mt.required_sleep_hours_before_after || 0);
    setMtWindows(
      (mt.time_windows || []).length
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
        reqs: (b.requirements || []).map((r) => ({
          roleId: (r.role_id || "") as number | "",
          qualId: (r.qualification_id || "") as number | "",
          count: r.count,
        })),
      }))
    );
    setReqs(
      (mt.default_requirements || []).map((r) => ({
        roleId: (r.role_id || "") as number | "",
        qualId: (r.qualification_id || "") as number | "",
        count: r.count,
      }))
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
    const default_requirements: MissionTypeRequirement[] = reqs
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
        };
      })
      .filter((r) => r.role_id != null || r.qualification_id != null);
    const reqSum = default_requirements.reduce((s, r) => s + r.count, 0);
    const useBands = mtRecurring && mtBands.length > 0;
    if (!useBands && default_requirements.length && reqSum !== mtCount) {
      setError(
        `סכום הדרישות (${reqSum}) חייב להיות שווה למספר האנשים (${mtCount})`
      );
      return;
    }
    if (mtRecurring && (mtStartHour < 0 || mtStartHour > 23)) {
      setError("שעת התחלה חייבת להיות בין 0 ל־23");
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
        const bandReqs = b.reqs
          .map((r) => ({
            role_id:
              r.roleId !== ""
                ? Number(r.roleId)
                : activeRoles[0]?.id != null
                  ? activeRoles[0].id
                  : null,
            qualification_id: r.qualId !== "" ? Number(r.qualId) : null,
            count: r.count,
          }))
          .filter((r) => r.role_id != null || r.qualification_id != null);
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
        recurring_start_hour: mtRecurring ? mtStartHour : null,
        recurring_end_hour: null,
        routine_remainder_policy: mtRecurring ? mtRemainderPolicy : "include_short",
        required_sleep_hours_before_after: mtSleep,
        default_requirements: useBands ? [] : default_requirements,
        time_windows: mtRecurring ? [] : time_windows,
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

  function kanimKindLabel(kind: KanimRule["kind"]) {
    if (kind === "weekday") return "ימי חול (א׳–ה׳)";
    if (kind === "weekend") return "סופ״ש (ו׳–ש׳)";
    return "תאריך ספציפי";
  }

  function reqLabel(mt: MissionType) {
    return (mt.default_requirements || [])
      .map((r) => {
        const parts: string[] = [];
        if (r.role_id) {
          const role = roles.find((x) => x.id === r.role_id);
          if (role) parts.push(role.name);
        }
        if (r.qualification_id) {
          const q = quals.find((x) => x.id === r.qualification_id);
          if (q) parts.push(q.name);
        }
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
      <section className="panel">
        <h1 style={{ marginTop: 0 }}>הגדרות</h1>
        <p style={{ color: "var(--ink-soft)" }}>
          תפקידים, פק״לים וקטלוג סוגי משימות. בחירת משימות לחלון נעשית במסך השיבוץ.
        </p>
        {error ? <div className="alert alert-danger">{error}</div> : null}
        {ok ? <div className="alert alert-ok">{ok}</div> : null}
      </section>

      <section className="panel">
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
                      if (!confirm(`למחוק את התפקיד «${role.name}»?`)) return;
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
      </section>

      <section className="panel">
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
                      if (!confirm(`למחוק את הפק״ל «${q.name}»?`)) return;
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
      </section>

      <section className="panel">
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
                      if (!confirm("למחוק את כלל הקנים?")) return;
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
      </section>

      <section className="panel">
        <h2 style={{ marginTop: 0 }}>סוגי משימות (קטלוג)</h2>
        <p style={{ color: "var(--ink-soft)", marginTop: 0 }}>
          כאן מגדירים את סוגי המשימות הקבועים לפי הסדר: שם, קושי, מספר אנשים,
          רוטיני כן/לא (ואז משך+שעת התחלה או טווחי שעות), דרישות, ושעות שינה
          לפני אפטר. סמנו «בשיבוץ» ליד משימה כדי שתופיע במסך השיבוץ.
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
                    ? `כן · מ־${String(mt.recurring_start_hour ?? "—").padStart(2, "0")}:00 · כל ${mt.default_duration_hours || "—"} ש׳`
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
                        if (!confirm(`למחוק את סוג המשימה «${mt.name}»?`)) return;
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
                            רוטיני = משמרות שחוזרות ביום לפי שעת התחלה ומשך. לא
                            רוטיני = טווחי שעות קבועים (למשל 05:30–07:00 ו־18:00–19:30),
                            כולל חציית חצות.
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
                                            reqs[rIdx] = {
                                              ...r,
                                              qualId: e.target.value
                                                ? Number(e.target.value)
                                                : "",
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
                                    next[idx] = {
                                      ...r,
                                      qualId: e.target.value
                                        ? Number(e.target.value)
                                        : "",
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

                        <label>
                          שעות שינה נדרשות לפני אפטר
                          <input
                            type="number"
                            min={0}
                            step={0.5}
                            value={mtSleep}
                            onChange={(e) => setMtSleep(Number(e.target.value))}
                          />
                        </label>

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
      </section>
    </AppShell>
  );
}
