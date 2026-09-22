"use client";

import { FormEvent, Fragment, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useConfirm } from "@/components/ConfirmDialog";
import { useAuth } from "@/lib/auth";
import {
  api,
  Leave,
  MissionType,
  PeopleImportPreview,
  Person,
  PersonLabel,
  Qualification,
  RecurringRestriction,
  Restriction,
  Role,
} from "@/lib/api";

function formatShortRange(start: string, end: string) {
  const opts: Intl.DateTimeFormatOptions = {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  };
  const s = new Date(start).toLocaleString("he-IL", opts);
  const e = new Date(end).toLocaleString("he-IL", opts);
  return `${s}–${e}`;
}

function leaveTypeLabel(t: string) {
  const map: Record<string, string> = {
    leave: "חופשה",
    home_leave: "בית",
    temporary_absence: "היעדרות",
    medical: "רפואי",
    other: "אחר",
  };
  return map[t] || t;
}

function recurringKindLabel(
  kind: string,
  interval: number,
  weekdays?: string | null
) {
  if (kind === "daily") return "כל יום";
  if (kind === "every_n_days") return `כל ${interval} ימים`;
  if (kind === "weekly") return weekdays ? `שבועי (${weekdays})` : "שבועי";
  return kind;
}

function IconEdit({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 20h9"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconClose({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M6 6l12 12M18 6L6 18"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconPause({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" />
      <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" />
    </svg>
  );
}

function IconPlay({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M8 5v14l11-7L8 5z" fill="currentColor" />
    </svg>
  );
}

function IconTrash({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 7h16M9 7V5h6v2M8 7l1 12h6l1-12"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function isPastEnd(endAt: string | null | undefined) {
  if (!endAt) return false;
  const t = new Date(endAt).getTime();
  return Number.isFinite(t) && t < Date.now();
}

export default function PeoplePage() {
  const { token } = useAuth();
  const confirm = useConfirm();
  const [people, setPeople] = useState<Person[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [quals, setQuals] = useState<Qualification[]>([]);
  const [personLabels, setPersonLabels] = useState<PersonLabel[]>([]);
  const [missionTypes, setMissionTypes] = useState<MissionType[]>([]);
  const [leave, setLeave] = useState<Leave[]>([]);
  const [restrictions, setRestrictions] = useState<Restriction[]>([]);
  const [recurring, setRecurring] = useState<RecurringRestriction[]>([]);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [personalNumber, setPersonalNumber] = useState("");
  const [phone, setPhone] = useState("");
  const [roleId, setRoleId] = useState<number | "">("");
  const [selectedQuals, setSelectedQuals] = useState<number[]>([]);
  const [selectedLabels, setSelectedLabels] = useState<Record<number, number[]>>(
    {}
  );
  const [allowedTypes, setAllowedTypes] = useState<number[]>([]);
  const [newQualName, setNewQualName] = useState("");
  const [qualBusy, setQualBusy] = useState(false);

  const [filterName, setFilterName] = useState("");
  const [filterRoleId, setFilterRoleId] = useState<number | "">("");
  const [filterQualId, setFilterQualId] = useState<number | "">("");
  const [filterLabelOption, setFilterLabelOption] = useState<
    Record<number, number | "">
  >({});
  const [filterMission, setFilterMission] = useState<number | "" | "all" | "limited">(
    ""
  );
  const [filterAfter, setFilterAfter] = useState<"" | "none" | "some">("");
  const [showSuspended, setShowSuspended] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importSheet, setImportSheet] = useState("");
  const [importSheets, setImportSheets] = useState<string[]>([]);
  const [importPreview, setImportPreview] = useState<PeopleImportPreview | null>(
    null
  );
  const [importBusy, setImportBusy] = useState(false);
  const [importMessage, setImportMessage] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkOk, setBulkOk] = useState("");
  const [bulkDialog, setBulkDialog] = useState<
    null | "role" | "qual-add" | "qual-remove" | "label"
  >(null);
  const [bulkRoleId, setBulkRoleId] = useState<number | "">("");
  const [bulkQualId, setBulkQualId] = useState<number | "">("");
  const [bulkLabelId, setBulkLabelId] = useState<number | "">("");
  const [bulkLabelOptionIds, setBulkLabelOptionIds] = useState<number[]>([]);

  async function refresh() {
    if (!token) return;
    const [p, r, q, labels, mt, l, rest, rec] = await Promise.all([
      api.people(token),
      api.roles(token),
      api.qualifications(token),
      api.personLabels(token),
      api.missionTypes(token),
      api.leave(token),
      api.restrictions(token),
      api.recurringRestrictions(token),
    ]);
    setPeople(p);
    setRoles(r);
    setQuals(q.filter((x) => x.is_active));
    setPersonLabels(
      labels
        .filter((x) => x.is_active)
        .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
        .slice(0, 3)
    );
    setMissionTypes(mt.filter((x) => x.is_active));
    setLeave(l);
    setRestrictions(rest);
    setRecurring(rec.filter((x) => x.is_active));
    if (!roleId && r[0]) setRoleId(r[0].id);
  }

  useEffect(() => {
    refresh().catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const availabilityByPerson = useMemo(() => {
    const map = new Map<
      number,
      { leaves: Leave[]; restrictions: Restriction[]; recurring: RecurringRestriction[] }
    >();
    const ensure = (id: number) => {
      if (!map.has(id)) {
        map.set(id, { leaves: [], restrictions: [], recurring: [] });
      }
      return map.get(id)!;
    };
    for (const item of leave) {
      if (isPastEnd(item.end_at)) continue;
      ensure(item.person_id).leaves.push(item);
    }
    for (const item of restrictions) {
      if (isPastEnd(item.end_at)) continue;
      ensure(item.person_id).restrictions.push(item);
    }
    for (const item of recurring) {
      if (!item.is_active) continue;
      if (isPastEnd(item.active_until)) continue;
      ensure(item.person_id).recurring.push(item);
    }
    return map;
  }, [leave, restrictions, recurring]);

  const filteredPeople = useMemo(() => {
    const q = filterName.trim().toLowerCase();
    return people.filter((p) => {
      if (!showSuspended && !p.is_active) return false;
      if (q) {
        const hay = [
          p.full_name,
          p.personal_number || "",
          p.phone || "",
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (filterRoleId !== "" && p.role_id !== filterRoleId) return false;
      if (filterQualId !== "" && !p.qualification_ids.includes(filterQualId)) {
        return false;
      }
      for (const lb of personLabels) {
        const optFilter = filterLabelOption[lb.id];
        if (optFilter === undefined || optFilter === "") continue;
        const assigned =
          (p.label_values || []).find((v) => v.label_id === lb.id)?.option_ids ||
          [];
        if (!assigned.includes(optFilter)) return false;
      }
      const allowed = p.allowed_mission_type_ids || [];
      if (filterMission === "all") {
        if (allowed.length !== 0) return false;
      } else if (filterMission === "limited") {
        if (allowed.length === 0) return false;
      } else if (filterMission !== "") {
        if (allowed.length > 0 && !allowed.includes(filterMission)) return false;
      }
      const afterCount = p.after_count_30d || 0;
      if (filterAfter === "none" && afterCount !== 0) return false;
      if (filterAfter === "some" && afterCount === 0) return false;
      return true;
    });
  }, [
    people,
    personLabels,
    filterName,
    filterRoleId,
    filterQualId,
    filterLabelOption,
    filterMission,
    filterAfter,
    showSuspended,
  ]);

  const suspendedCount = useMemo(
    () => people.filter((p) => !p.is_active).length,
    [people]
  );

  const labelFiltersActive = personLabels.some(
    (lb) => filterLabelOption[lb.id] !== undefined && filterLabelOption[lb.id] !== ""
  );

  const filtersActive =
    !!filterName.trim() ||
    filterRoleId !== "" ||
    filterQualId !== "" ||
    labelFiltersActive ||
    filterMission !== "" ||
    filterAfter !== "" ||
    showSuspended;

  function clearFilters() {
    setFilterName("");
    setFilterRoleId("");
    setFilterQualId("");
    setFilterLabelOption({});
    setFilterMission("");
    setFilterAfter("");
    setShowSuspended(false);
  }

  function splitFullName(full: string): { first: string; last: string } {
    const parts = full.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return { first: "", last: "" };
    if (parts.length === 1) return { first: parts[0], last: "" };
    return { first: parts[0], last: parts.slice(1).join(" ") };
  }

  function composeFullName(first: string, last: string) {
    return [first.trim(), last.trim()].filter(Boolean).join(" ");
  }

  function emptyLabelSelection(): Record<number, number[]> {
    const next: Record<number, number[]> = {};
    for (const lb of personLabels) next[lb.id] = [];
    return next;
  }

  function resetForm() {
    setEditingId(null);
    setFirstName("");
    setLastName("");
    setPersonalNumber("");
    setPhone("");
    setSelectedQuals([]);
    setSelectedLabels(emptyLabelSelection());
    setAllowedTypes([]);
    if (roles[0]) setRoleId(roles[0].id);
  }

  function startEdit(p: Person) {
    if (editingId === p.id) {
      resetForm();
      return;
    }
    setAddOpen(false);
    const { first, last } = splitFullName(p.full_name);
    setEditingId(p.id);
    setFirstName(first);
    setLastName(last);
    setPersonalNumber(p.personal_number || "");
    setPhone(p.phone || "");
    setRoleId(p.role_id);
    setSelectedQuals([...p.qualification_ids]);
    const lv: Record<number, number[]> = emptyLabelSelection();
    for (const v of p.label_values || []) {
      lv[v.label_id] = [...v.option_ids];
    }
    setSelectedLabels(lv);
    setAllowedTypes([...(p.allowed_mission_type_ids || [])]);
  }

  function toggleLabelOption(label: PersonLabel, optionId: number) {
    setSelectedLabels((prev) => {
      const cur = prev[label.id] || [];
      const multi = label.selection_mode === "multi";
      if (multi) {
        return {
          ...prev,
          [label.id]: cur.includes(optionId)
            ? cur.filter((id) => id !== optionId)
            : [...cur, optionId],
        };
      }
      return {
        ...prev,
        [label.id]: cur.includes(optionId) ? [] : [optionId],
      };
    });
  }

  const selectedCount = selectedIds.size;
  const allFilteredSelected =
    filteredPeople.length > 0 &&
    filteredPeople.every((p) => selectedIds.has(p.id));

  function toggleSelectOne(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllFiltered() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        for (const p of filteredPeople) next.delete(p.id);
      } else {
        for (const p of filteredPeople) next.add(p.id);
      }
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  function openBulkDialog(kind: "role" | "qual-add" | "qual-remove" | "label") {
    setBulkOk("");
    setBulkRoleId(roles[0]?.id ?? "");
    setBulkQualId(quals[0]?.id ?? "");
    setBulkLabelId(personLabels[0]?.id ?? "");
    setBulkLabelOptionIds([]);
    setBulkDialog(kind);
  }

  function toggleBulkLabelOption(label: PersonLabel, optionId: number) {
    setBulkLabelOptionIds((prev) => {
      if (label.selection_mode === "multi") {
        return prev.includes(optionId)
          ? prev.filter((id) => id !== optionId)
          : [...prev, optionId];
      }
      return prev.includes(optionId) ? [] : [optionId];
    });
  }

  async function runBulkUpdate(
    body: Parameters<typeof api.bulkUpdatePeople>[1]
  ) {
    if (!token || selectedCount === 0) return;
    setBulkBusy(true);
    setError("");
    setBulkOk("");
    try {
      const res = await api.bulkUpdatePeople(token, {
        ...body,
        person_ids: Array.from(selectedIds),
      });
      setBulkOk(`עודכנו ${res.updated} אנשים`);
      setBulkDialog(null);
      clearSelection();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "עדכון מרוכז נכשל");
    } finally {
      setBulkBusy(false);
    }
  }

  async function submitBulkDialog() {
    if (!bulkDialog) return;
    if (bulkDialog === "role") {
      if (bulkRoleId === "") return;
      await runBulkUpdate({ person_ids: [], role_id: Number(bulkRoleId) });
      return;
    }
    if (bulkDialog === "qual-add") {
      if (bulkQualId === "") return;
      await runBulkUpdate({
        person_ids: [],
        add_qualification_ids: [Number(bulkQualId)],
      });
      return;
    }
    if (bulkDialog === "qual-remove") {
      if (bulkQualId === "") return;
      await runBulkUpdate({
        person_ids: [],
        remove_qualification_ids: [Number(bulkQualId)],
      });
      return;
    }
    if (bulkDialog === "label") {
      if (bulkLabelId === "") return;
      await runBulkUpdate({
        person_ids: [],
        label_value: {
          label_id: Number(bulkLabelId),
          option_ids: bulkLabelOptionIds,
        },
      });
    }
  }

  const bulkLabel = personLabels.find((lb) => lb.id === bulkLabelId);

  function personLabelCell(p: Person, labelId: number) {
    const v = (p.label_values || []).find((x) => x.label_id === labelId);
    if (!v || !v.option_ids.length) return "—";
    if (v.option_names?.length) return v.option_names.join(", ");
    const lb = personLabels.find((x) => x.id === labelId);
    return (
      v.option_ids
        .map((id) => lb?.options.find((o) => o.id === id)?.name)
        .filter(Boolean)
        .join(", ") || "—"
    );
  }

  async function toggleSuspend(p: Person) {
    if (!token) return;
    const nextActive = !p.is_active;
    const ok = await confirm(
      nextActive
        ? {
            title: "הפעלה מחדש",
            message: `להפעיל מחדש את ${p.full_name}?\nיוכל להיכנס שוב לשיבוץ.`,
            confirmLabel: "הפעל",
          }
        : {
            title: "השהיית חייל",
            message: `להשהות את ${p.full_name}?\nמושעה לא ייכנס לשיבוץ חדש. היסטוריה נשמרת.`,
            confirmLabel: "השהה",
            tone: "accent",
          }
    );
    if (!ok) return;
    setError("");
    try {
      const updated = await api.updatePerson(token, p.id, { is_active: nextActive });
      setPeople((prev) => prev.map((row) => (row.id === p.id ? { ...row, ...updated } : row)));
      if (editingId === p.id && !nextActive) resetForm();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה בהשהייה");
    }
  }

  async function deletePerson(p: Person) {
    if (!token) return;
    const ok = await confirm({
      title: "מחיקה לצמיתות",
      message:
        `למחוק את ${p.full_name}?\n\n` +
        `אזהרה: המחיקה בלתי הפיכה.\n` +
        `יימחקו גם שיבוצים, עומס, חופשות ומגבלות הקשורים אליו.\n` +
        `להשהייה (בלי למחוק היסטוריה) השתמשו ב«השהה».`,
      confirmLabel: "המשך למחיקה",
      tone: "danger",
    });
    if (!ok) return;
    const ok2 = await confirm({
      title: "אישור אחרון",
      message: `למחוק לצמיתות את ${p.full_name}?\nלא ניתן לשחזר.`,
      confirmLabel: "מחק לצמיתות",
      tone: "danger",
    });
    if (!ok2) return;
    setError("");
    try {
      await api.deletePerson(token, p.id);
      setPeople((prev) => prev.filter((row) => row.id !== p.id));
      setLeave((prev) => prev.filter((row) => row.person_id !== p.id));
      setRestrictions((prev) => prev.filter((row) => row.person_id !== p.id));
      setRecurring((prev) => prev.filter((row) => row.person_id !== p.id));
      if (editingId === p.id) resetForm();
      try {
        await refresh();
      } catch (refreshErr) {
        setError(
          refreshErr instanceof Error
            ? refreshErr.message
            : "נמחק, אך רענון הרשימה נכשל — רעננו את הדף"
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה במחיקה");
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token || !roleId) return;
    const full_name = composeFullName(firstName, lastName);
    if (!full_name) {
      setError("נא למלא שם פרטי או שם משפחה");
      return;
    }
    setError("");
    try {
      const body = {
        full_name,
        role_id: Number(roleId),
        personal_number: personalNumber.trim() || "",
        phone: phone.trim() || "",
        qualification_ids: selectedQuals,
        allowed_mission_type_ids: allowedTypes,
        label_values: personLabels.map((lb) => ({
          label_id: lb.id,
          option_ids: selectedLabels[lb.id] || [],
        })),
      };
      if (editingId) {
        await api.updatePerson(token, editingId, body);
      } else {
        await api.createPerson(token, body);
        setAddOpen(false);
      }
      resetForm();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה");
    }
  }

  function renderPersonFormFields(mode: "create" | "edit") {
    return (
      <>
        <div className="person-form-row">
          <label>
            שם פרטי
            <input
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              autoComplete="given-name"
              required={!lastName.trim()}
              placeholder="ישראל"
            />
          </label>
          <label>
            שם משפחה
            <input
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              autoComplete="family-name"
              required={!firstName.trim()}
              placeholder="ישראלי"
            />
          </label>
        </div>

        <div className="person-form-row">
          <label>
            מספר אישי
            <span className="field-optional">רשות</span>
            <input
              value={personalNumber}
              onChange={(e) => setPersonalNumber(e.target.value)}
              inputMode="numeric"
              autoComplete="off"
              placeholder="לדוגמה 1234567"
            />
          </label>
          <label>
            טלפון
            <span className="field-optional">רשות</span>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              type="tel"
              autoComplete="tel"
              placeholder="050-0000000"
            />
          </label>
        </div>

        <label>
          תפקיד
          <select
            value={roleId}
            onChange={(e) => setRoleId(Number(e.target.value))}
            required
          >
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>

        {personLabels.map((lb) => {
          const selected = selectedLabels[lb.id] || [];
          const activeOpts = lb.options.filter((o) => o.is_active);
          return (
            <div key={lb.id}>
              <div style={{ marginBottom: "0.4rem", color: "var(--ink-soft)" }}>
                {lb.name}
                <span className="field-optional">
                  {lb.selection_mode === "multi" ? "בחירה מרובה" : "בחירה יחידה"}
                </span>
              </div>
              <div className="people-chips">
                {activeOpts.length === 0 ? (
                  <span style={{ color: "var(--ink-soft)", fontSize: "0.88rem" }}>
                    אין ערכים — הוסיפו בהגדרות
                  </span>
                ) : (
                  activeOpts.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      className={`chip ${selected.includes(o.id) ? "manual" : ""}`}
                      onClick={() => toggleLabelOption(lb, o.id)}
                    >
                      {o.name}
                    </button>
                  ))
                )}
              </div>
            </div>
          );
        })}

        <div>
          <div style={{ marginBottom: "0.4rem", color: "var(--ink-soft)" }}>
            פק״לים
          </div>
          <div className="people-chips">
            {quals.length === 0 ? (
              <span style={{ color: "var(--ink-soft)", fontSize: "0.88rem" }}>
                עדיין אין פק״לים — הוסיפו למטה
              </span>
            ) : (
              quals.map((q) => (
                <button
                  key={q.id}
                  type="button"
                  className={`chip ${selectedQuals.includes(q.id) ? "manual" : ""}`}
                  onClick={() => toggleId(selectedQuals, q.id, setSelectedQuals)}
                >
                  {q.name}
                </button>
              ))
            )}
          </div>
          <div className="qual-add-row">
            <input
              value={newQualName}
              onChange={(e) => setNewQualName(e.target.value)}
              placeholder="פק״ל חדש (לדוגמה: חובש)"
              aria-label="שם פק״ל חדש"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void addQualificationInline();
                }
              }}
            />
            <button
              className="btn btn-ghost btn-small"
              type="button"
              disabled={qualBusy || !newQualName.trim()}
              onClick={() => void addQualificationInline()}
            >
              {qualBusy ? "…" : "הוסף פק״ל"}
            </button>
          </div>
        </div>
        <div>
          <div style={{ marginBottom: "0.4rem", color: "var(--ink-soft)" }}>
            סוגי משימות מותרים בלבד (אופציונלי)
          </div>
          <div className="people-chips">
            {missionTypes.map((mt) => (
              <button
                key={mt.id}
                type="button"
                className={`chip ${allowedTypes.includes(mt.id) ? "manual" : ""}`}
                onClick={() => toggleId(allowedTypes, mt.id, setAllowedTypes)}
              >
                {mt.name}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <button className="btn btn-primary" type="submit">
            {mode === "edit" ? "שמור שינויים" : "הוסף חייל"}
          </button>
          <button
            className="btn btn-ghost"
            type="button"
            onClick={() => {
              resetForm();
              if (mode === "create") setAddOpen(false);
            }}
          >
            ביטול
          </button>
        </div>
      </>
    );
  }

  function toggleId(list: number[], id: number, setter: (v: number[]) => void) {
    setter(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  }

  async function addQualificationInline(e?: FormEvent) {
    e?.preventDefault();
    if (!token) return;
    const name = newQualName.trim();
    if (!name) return;
    const existing = quals.find(
      (q) => q.name.trim().toLowerCase() === name.toLowerCase()
    );
    if (existing) {
      if (!selectedQuals.includes(existing.id)) {
        setSelectedQuals([...selectedQuals, existing.id]);
      }
      setNewQualName("");
      return;
    }
    setQualBusy(true);
    setError("");
    try {
      const created = await api.createQualification(token, { name });
      setQuals((prev) =>
        [...prev, created].sort((a, b) => a.name.localeCompare(b.name, "he"))
      );
      setSelectedQuals((prev) =>
        prev.includes(created.id) ? prev : [...prev, created.id]
      );
      setNewQualName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "יצירת פק״ל נכשלה");
    } finally {
      setQualBusy(false);
    }
  }

  async function onPreviewImport() {
    if (!token || !importFile) return;
    setImportBusy(true);
    setError("");
    setImportMessage("");
    try {
      const preview = await api.previewPeopleImport(
        token,
        importFile,
        importSheet || undefined
      );
      setImportPreview(preview);
      setImportSheets(preview.sheet_options);
      setImportSheet(preview.sheet_name);
    } catch (err) {
      setImportPreview(null);
      setError(err instanceof Error ? err.message : "ייבוא נכשל");
    } finally {
      setImportBusy(false);
    }
  }

  async function onCommitImport() {
    if (!token || !importFile) return;
    setImportBusy(true);
    setError("");
    setImportMessage("");
    try {
      const result = await api.commitPeopleImport(
        token,
        importFile,
        importSheet || importPreview?.sheet_name || undefined
      );
      setImportMessage(
        `יובא מ«${result.sheet_name}»: ${result.created} חדשים, ${result.updated} עודכנו` +
          (result.qualifications_created
            ? `, ${result.qualifications_created} פק״לים חדשים`
            : "")
      );
      setImportPreview(null);
      setImportFile(null);
      setImportSheets([]);
      setImportSheet("");
      setImportOpen(false);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ייבוא נכשל");
    } finally {
      setImportBusy(false);
    }
  }

  function renderAvailability(personId: number) {
    const data = availabilityByPerson.get(personId);
    if (
      !data ||
      (data.leaves.length === 0 &&
        data.restrictions.length === 0 &&
        data.recurring.length === 0)
    ) {
      return <span style={{ color: "var(--ink-soft)" }}>—</span>;
    }
    return (
      <div style={{ fontSize: "0.88rem", lineHeight: 1.45 }}>
        {data.leaves.map((l) => (
          <div key={`l-${l.id}`}>
            <strong>{leaveTypeLabel(l.leave_type)}</strong>{" "}
            {formatShortRange(l.start_at, l.end_at)}
            {l.notes ? ` · ${l.notes}` : ""}
          </div>
        ))}
        {data.restrictions.map((r) => (
          <div key={`r-${r.id}`}>
            <strong>מגבלה: {r.restriction_type}</strong>{" "}
            {formatShortRange(r.start_at, r.end_at)}
            {r.notes ? ` · ${r.notes}` : ""}
          </div>
        ))}
        {data.recurring.map((r) => (
          <div key={`rr-${r.id}`}>
            <strong>רוטיני: {r.restriction_type}</strong>{" "}
            {recurringKindLabel(r.kind, r.interval_days, r.weekdays)} ·{" "}
            {r.time_start}–{r.time_end}
            {r.notes ? ` · ${r.notes}` : ""}
          </div>
        ))}
      </div>
    );
  }

  return (
    <AppShell>
      <header className="page-intro">
        <h1>כוח אדם</h1>
        {error ? <div className="alert alert-danger">{error}</div> : null}
        {importMessage ? (
          <div className="alert">{importMessage}</div>
        ) : null}
      </header>

      <section className="panel panel-list">
        <details
          className="import-details"
          open={importOpen}
          onToggle={(e) => setImportOpen((e.target as HTMLDetailsElement).open)}
        >
          <summary className="import-summary">
            <span>ייבוא מאקסל</span>
            <span className="import-summary-hint">.xlsx / .xlsm · אופציונלי</span>
          </summary>
          <div className="import-panel">
            <div className="import-row">
              <input
                className="import-file"
                type="file"
                accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel.sheet.macroEnabled.12"
                onChange={(e) => {
                  const f = e.target.files?.[0] || null;
                  setImportFile(f);
                  setImportPreview(null);
                  setImportSheets([]);
                  setImportSheet("");
                  setImportMessage("");
                  if (f) setImportOpen(true);
                }}
                aria-label="קובץ אקסל"
              />
              {importSheets.length ? (
                <select
                  className="import-sheet"
                  value={importSheet}
                  onChange={(e) => {
                    setImportSheet(e.target.value);
                    setImportPreview(null);
                  }}
                  aria-label="גיליון"
                >
                  {importSheets.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              ) : null}
              <button
                className="btn btn-ghost btn-small"
                type="button"
                disabled={!importFile || importBusy}
                onClick={onPreviewImport}
              >
                {importBusy ? "…" : "תצוגה"}
              </button>
              <button
                className="btn btn-primary btn-small"
                type="button"
                disabled={!importFile || importBusy}
                onClick={onCommitImport}
              >
                ייבא
              </button>
            </div>
            {importPreview ? (
              <div className="import-preview">
                <p>
                  <strong>{importPreview.sheet_name}</strong>
                  {" · "}
                  {importPreview.create_count} חדשים
                  {" · "}
                  {importPreview.update_count} עדכון
                </p>
                <div className="import-preview-scroll">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>פעולה</th>
                        <th>שם</th>
                        <th>מס׳ אישי</th>
                        <th>טלפון</th>
                        <th>תפקיד</th>
                        <th>פק״לים</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importPreview.rows.slice(0, 25).map((r, i) => (
                        <tr key={`${r.full_name}-${i}`}>
                          <td>{r.action === "create" ? "חדש" : "עדכון"}</td>
                          <td>{r.full_name}</td>
                          <td>{r.personal_number || "—"}</td>
                          <td>{r.phone || "—"}</td>
                          <td>{r.role_name || "—"}</td>
                          <td>
                            {r.qualification_names.length
                              ? r.qualification_names.join(", ")
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </div>
        </details>

        <details
          className="import-details person-add-details"
          open={addOpen}
          onToggle={(e) => {
            const open = (e.target as HTMLDetailsElement).open;
            setAddOpen(open);
            if (open) {
              resetForm();
            }
          }}
        >
          <summary className="import-summary">
            <span>הוספה ידנית</span>
            <span className="import-summary-hint">שם · תפקיד · תוויות · פק״לים</span>
          </summary>
          <div className="import-panel">
            <form
              className="form-grid person-form person-form-compact"
              onSubmit={(e) => {
                if (editingId) {
                  e.preventDefault();
                  return;
                }
                void onSubmit(e);
              }}
            >
              {renderPersonFormFields("create")}
            </form>
          </div>
        </details>
      </section>

      <section className="panel">
        <div className="filter-bar" role="search" aria-label="סינון כוח אדם">
          <input
            className="filter-bar-search"
            value={filterName}
            onChange={(e) => setFilterName(e.target.value)}
            placeholder="חיפוש שם / מס׳ אישי / טלפון…"
            aria-label="חיפוש לפי שם, מספר אישי או טלפון"
          />
          <select
            className={filterRoleId !== "" ? "is-active" : undefined}
            value={filterRoleId}
            onChange={(e) =>
              setFilterRoleId(e.target.value ? Number(e.target.value) : "")
            }
            aria-label="סינון לפי תפקיד"
          >
            <option value="">תפקיד</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <select
            className={filterQualId !== "" ? "is-active" : undefined}
            value={filterQualId}
            onChange={(e) =>
              setFilterQualId(e.target.value ? Number(e.target.value) : "")
            }
            aria-label="סינון לפי פק״ל"
          >
            <option value="">פק״ל</option>
            {quals.map((q) => (
              <option key={q.id} value={q.id}>
                {q.name}
              </option>
            ))}
          </select>
          {personLabels.map((lb) => (
            <select
              key={lb.id}
              className={
                filterLabelOption[lb.id] !== undefined &&
                filterLabelOption[lb.id] !== ""
                  ? "is-active"
                  : undefined
              }
              value={filterLabelOption[lb.id] ?? ""}
              onChange={(e) =>
                setFilterLabelOption((prev) => ({
                  ...prev,
                  [lb.id]: e.target.value ? Number(e.target.value) : "",
                }))
              }
              aria-label={`סינון לפי ${lb.name}`}
            >
              <option value="">{lb.name}</option>
              {lb.options
                .filter((o) => o.is_active)
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
            </select>
          ))}
          <select
            className={filterMission !== "" ? "is-active" : undefined}
            value={filterMission}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "" || v === "all" || v === "limited") {
                setFilterMission(v);
              } else {
                setFilterMission(Number(v));
              }
            }}
            aria-label="סינון לפי משימות מותרות"
          >
            <option value="">משימות</option>
            <option value="all">ללא הגבלה</option>
            <option value="limited">עם הגבלה</option>
            {missionTypes.map((mt) => (
              <option key={mt.id} value={mt.id}>
                {mt.name}
              </option>
            ))}
          </select>
          <select
            className={filterAfter !== "" ? "is-active" : undefined}
            value={filterAfter}
            onChange={(e) =>
              setFilterAfter(e.target.value as "" | "none" | "some")
            }
            aria-label="סינון לפי אפטר"
          >
            <option value="">אפטר</option>
            <option value="none">ללא</option>
            <option value="some">קיבלו</option>
          </select>
          <label
            className={`filter-toggle${showSuspended ? " is-active" : ""}`}
            title={
              suspendedCount
                ? `${suspendedCount} מושעים`
                : "אין מושעים כרגע"
            }
          >
            <input
              type="checkbox"
              checked={showSuspended}
              onChange={(e) => setShowSuspended(e.target.checked)}
            />
            הצג מושעים
            {suspendedCount > 0 ? ` (${suspendedCount})` : ""}
          </label>
          <div className="filter-bar-meta">
            <span>
              {filteredPeople.length}/
              {showSuspended
                ? people.length
                : people.length - suspendedCount}
            </span>
            {filteredPeople.length > 0 ? (
              <button
                className="btn btn-ghost btn-small"
                type="button"
                onClick={toggleSelectAllFiltered}
              >
                {allFilteredSelected ? "בטל בחירת מוצגים" : "בחר את כל המוצגים"}
              </button>
            ) : null}
            {filtersActive ? (
              <button
                className="btn btn-ghost btn-small"
                type="button"
                onClick={clearFilters}
              >
                נקה
              </button>
            ) : null}
          </div>
        </div>

        {bulkOk ? (
          <div className="alert alert-ok" style={{ marginBottom: "0.75rem" }}>
            {bulkOk}
          </div>
        ) : null}

        {selectedCount > 0 ? (
          <div className="bulk-action-bar" role="region" aria-label="פעולות על נבחרים">
            <span className="bulk-action-bar-count">נבחרו {selectedCount}</span>
            <div className="bulk-action-bar-actions">
              <button
                className="btn btn-primary btn-small"
                type="button"
                disabled={bulkBusy || roles.length === 0}
                onClick={() => openBulkDialog("role")}
              >
                שנה תפקיד
              </button>
              <button
                className="btn btn-ghost btn-small"
                type="button"
                disabled={bulkBusy || quals.length === 0}
                onClick={() => openBulkDialog("qual-add")}
              >
                הוסף פק״ל
              </button>
              <button
                className="btn btn-ghost btn-small"
                type="button"
                disabled={bulkBusy || quals.length === 0}
                onClick={() => openBulkDialog("qual-remove")}
              >
                הסר פק״ל
              </button>
              {personLabels.length > 0 ? (
                <button
                  className="btn btn-ghost btn-small"
                  type="button"
                  disabled={bulkBusy}
                  onClick={() => openBulkDialog("label")}
                >
                  הגדר תווית
                </button>
              ) : null}
            </div>
            <div className="bulk-action-bar-spacer" />
            <button
              className="btn btn-ghost btn-small"
              type="button"
              disabled={bulkBusy}
              onClick={clearSelection}
            >
              נקה בחירה
            </button>
          </div>
        ) : null}

        {error ? <div className="alert alert-danger">{error}</div> : null}

        <table className="table people-table">
          <thead>
            <tr>
              <th className="col-select" aria-label="בחירה" />
              <th className="col-name">שם</th>
              <th className="col-id">מס׳ אישי</th>
              <th className="col-role">תפקיד</th>
              {personLabels.map((lb) => (
                <th key={lb.id} className="col-label">
                  {lb.name}
                </th>
              ))}
              <th className="col-quals">פק״לים</th>
              <th className="col-missions">משימות מותרות</th>
              <th className="col-after">אפטר (30 ימים)</th>
              <th className="col-availability">חופשות ומגבלות</th>
              <th className="col-actions" />
            </tr>
          </thead>
          <tbody>
            {filteredPeople.length === 0 ? (
              <tr>
                <td
                  colSpan={9 + personLabels.length}
                  style={{ color: "var(--ink-soft)" }}
                >
                  אין תוצאות לפי הסינון הנוכחי
                </td>
              </tr>
            ) : (
              filteredPeople.map((p) => (
                <Fragment key={p.id}>
                  <tr
                    className={`${p.is_active ? "" : "row-suspended"}${
                      selectedIds.has(p.id) ? " is-selected" : ""
                    }`.trim()}
                  >
                    <td className="col-select">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(p.id)}
                        onChange={() => toggleSelectOne(p.id)}
                        aria-label={`בחר את ${p.full_name}`}
                      />
                    </td>
                    <td className="col-name">
                      <strong>{p.full_name}</strong>
                      {!p.is_active ? (
                        <span className="status-pill status-suspended">מושעה</span>
                      ) : null}
                      {editingId === p.id ? (
                        <div className="person-inline-edit-hint">עריכה מתחת</div>
                      ) : null}
                      {p.phone ? (
                        <div style={{ color: "var(--ink-soft)", fontSize: "0.85rem" }}>
                          {p.phone}
                        </div>
                      ) : null}
                      {(p.after_count_30d || 0) > 0 ? (
                        <div style={{ color: "var(--ink-soft)", fontSize: "0.85rem" }}>
                          פורגן באפטר · {p.after_count_30d}× ב־30 ימים
                          {p.last_after_end
                            ? ` · עד ${new Date(p.last_after_end).toLocaleString("he-IL")}`
                            : ""}
                        </div>
                      ) : null}
                    </td>
                    <td className="col-id">{p.personal_number || "—"}</td>
                    <td className="col-role">{p.role_name}</td>
                    {personLabels.map((lb) => (
                      <td key={lb.id} className="col-label">
                        {personLabelCell(p, lb.id)}
                      </td>
                    ))}
                    <td className="col-quals">
                      {p.qualification_ids
                        .map((id) => quals.find((q) => q.id === id)?.name)
                        .filter(Boolean)
                        .join(", ") || "—"}
                    </td>
                    <td className="col-missions">
                      {(p.allowed_mission_type_ids || []).length === 0
                        ? "הכל"
                        : p.allowed_mission_type_ids
                            .map((id) => missionTypes.find((m) => m.id === id)?.name)
                            .filter(Boolean)
                            .join(", ")}
                    </td>
                    <td className="col-after">{p.after_count_30d || 0}</td>
                    <td className="col-availability">{renderAvailability(p.id)}</td>
                    <td className="col-actions">
                      <div className="row-actions">
                        <button
                          className={`btn btn-ghost btn-icon${
                            editingId === p.id ? " is-active-action" : ""
                          }`}
                          type="button"
                          onClick={() => startEdit(p)}
                          data-tip={editingId === p.id ? "סגור עריכה" : "עריכה"}
                          aria-label={
                            editingId === p.id ? "סגור עריכה" : "עריכה"
                          }
                        >
                          {editingId === p.id ? <IconClose /> : <IconEdit />}
                        </button>
                        <button
                          className="btn btn-ghost btn-icon"
                          type="button"
                          onClick={() => toggleSuspend(p)}
                          data-tip={p.is_active ? "השהה" : "הפעל מחדש"}
                          aria-label={p.is_active ? "השהה" : "הפעל מחדש"}
                        >
                          {p.is_active ? <IconPause /> : <IconPlay />}
                        </button>
                        <button
                          className="btn btn-danger-ghost btn-icon"
                          type="button"
                          onClick={() => deletePerson(p)}
                          data-tip="מחק"
                          aria-label="מחק"
                        >
                          <IconTrash />
                        </button>
                      </div>
                    </td>
                  </tr>
                  {editingId === p.id ? (
                    <tr className="person-inline-edit-row">
                      <td colSpan={9 + personLabels.length}>
                        <form
                          className="form-grid person-form person-form-inline"
                          onSubmit={onSubmit}
                        >
                          <div className="person-form-head">
                            <h3 style={{ margin: 0, fontSize: "1rem" }}>
                              עריכת {p.full_name}
                            </h3>
                          </div>
                          {renderPersonFormFields("edit")}
                        </form>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))
            )}
          </tbody>
        </table>
      </section>

      {bulkDialog ? (
        <div
          className="app-dialog-backdrop"
          role="presentation"
          onClick={() => !bulkBusy && setBulkDialog(null)}
        >
          <div
            className="app-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="bulk-dialog-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="bulk-dialog-title" className="app-dialog-title">
              {bulkDialog === "role"
                ? "שנה תפקיד"
                : bulkDialog === "qual-add"
                  ? "הוסף פק״ל"
                  : bulkDialog === "qual-remove"
                    ? "הסר פק״ל"
                    : "הגדר תווית"}
            </h2>
            <p className="app-dialog-message">
              הפעולה תחול על <strong>{selectedCount}</strong> נבחרים.
            </p>

            {bulkDialog === "role" ? (
              <div className="bulk-dialog-field">
                <label htmlFor="bulk-role">תפקיד</label>
                <select
                  id="bulk-role"
                  value={bulkRoleId}
                  onChange={(e) =>
                    setBulkRoleId(e.target.value ? Number(e.target.value) : "")
                  }
                >
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            {bulkDialog === "qual-add" || bulkDialog === "qual-remove" ? (
              <div className="bulk-dialog-field">
                <label htmlFor="bulk-qual">פק״ל</label>
                <select
                  id="bulk-qual"
                  value={bulkQualId}
                  onChange={(e) =>
                    setBulkQualId(e.target.value ? Number(e.target.value) : "")
                  }
                >
                  {quals.map((q) => (
                    <option key={q.id} value={q.id}>
                      {q.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            {bulkDialog === "label" ? (
              <>
                <div className="bulk-dialog-field">
                  <label htmlFor="bulk-label">תווית</label>
                  <select
                    id="bulk-label"
                    value={bulkLabelId}
                    onChange={(e) => {
                      setBulkLabelId(e.target.value ? Number(e.target.value) : "");
                      setBulkLabelOptionIds([]);
                    }}
                  >
                    {personLabels.map((lb) => (
                      <option key={lb.id} value={lb.id}>
                        {lb.name}
                      </option>
                    ))}
                  </select>
                </div>
                {bulkLabel ? (
                  <div className="bulk-dialog-field">
                    <label>
                      ערך
                      <span className="field-optional">
                        {bulkLabel.selection_mode === "multi"
                          ? "בחירה מרובה"
                          : "בחירה יחידה"}
                      </span>
                    </label>
                    <div className="people-chips">
                      {bulkLabel.options
                        .filter((o) => o.is_active)
                        .map((o) => (
                          <button
                            key={o.id}
                            type="button"
                            className={`chip ${
                              bulkLabelOptionIds.includes(o.id) ? "manual" : ""
                            }`}
                            onClick={() => toggleBulkLabelOption(bulkLabel, o.id)}
                          >
                            {o.name}
                          </button>
                        ))}
                    </div>
                    <button
                      className="btn btn-ghost btn-small"
                      type="button"
                      onClick={() => setBulkLabelOptionIds([])}
                    >
                      נקה ערך (הסר תווית מהנבחרים)
                    </button>
                  </div>
                ) : null}
              </>
            ) : null}

            <div className="app-dialog-actions">
              <button
                className="btn btn-ghost"
                type="button"
                disabled={bulkBusy}
                onClick={() => setBulkDialog(null)}
              >
                ביטול
              </button>
              <button
                className="btn btn-primary"
                type="button"
                disabled={
                  bulkBusy ||
                  (bulkDialog === "role" && bulkRoleId === "") ||
                  ((bulkDialog === "qual-add" || bulkDialog === "qual-remove") &&
                    bulkQualId === "") ||
                  (bulkDialog === "label" && bulkLabelId === "")
                }
                onClick={() => void submitBulkDialog()}
              >
                {bulkBusy ? "מעדכן…" : "החל על הנבחרים"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}
