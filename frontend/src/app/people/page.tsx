"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth";
import {
  api,
  Leave,
  MissionType,
  PeopleImportPreview,
  Person,
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

export default function PeoplePage() {
  const { token } = useAuth();
  const [people, setPeople] = useState<Person[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [quals, setQuals] = useState<Qualification[]>([]);
  const [missionTypes, setMissionTypes] = useState<MissionType[]>([]);
  const [leave, setLeave] = useState<Leave[]>([]);
  const [restrictions, setRestrictions] = useState<Restriction[]>([]);
  const [recurring, setRecurring] = useState<RecurringRestriction[]>([]);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);

  const [fullName, setFullName] = useState("");
  const [roleId, setRoleId] = useState<number | "">("");
  const [selectedQuals, setSelectedQuals] = useState<number[]>([]);
  const [allowedTypes, setAllowedTypes] = useState<number[]>([]);

  const [filterName, setFilterName] = useState("");
  const [filterRoleId, setFilterRoleId] = useState<number | "">("");
  const [filterQualId, setFilterQualId] = useState<number | "">("");
  const [filterMission, setFilterMission] = useState<number | "" | "all" | "limited">(
    ""
  );
  const [filterAfter, setFilterAfter] = useState<"" | "none" | "some">("");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importSheet, setImportSheet] = useState("");
  const [importSheets, setImportSheets] = useState<string[]>([]);
  const [importPreview, setImportPreview] = useState<PeopleImportPreview | null>(
    null
  );
  const [importBusy, setImportBusy] = useState(false);
  const [importMessage, setImportMessage] = useState("");

  async function refresh() {
    if (!token) return;
    const [p, r, q, mt, l, rest, rec] = await Promise.all([
      api.people(token),
      api.roles(token),
      api.qualifications(token),
      api.missionTypes(token),
      api.leave(token),
      api.restrictions(token),
      api.recurringRestrictions(token),
    ]);
    setPeople(p);
    setRoles(r);
    setQuals(q.filter((x) => x.is_active));
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
    for (const item of leave) ensure(item.person_id).leaves.push(item);
    for (const item of restrictions) ensure(item.person_id).restrictions.push(item);
    for (const item of recurring) ensure(item.person_id).recurring.push(item);
    return map;
  }, [leave, restrictions, recurring]);

  const filteredPeople = useMemo(() => {
    const q = filterName.trim().toLowerCase();
    return people.filter((p) => {
      if (q && !p.full_name.toLowerCase().includes(q)) return false;
      if (filterRoleId !== "" && p.role_id !== filterRoleId) return false;
      if (filterQualId !== "" && !p.qualification_ids.includes(filterQualId)) {
        return false;
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
  }, [people, filterName, filterRoleId, filterQualId, filterMission, filterAfter]);

  const filtersActive =
    !!filterName.trim() ||
    filterRoleId !== "" ||
    filterQualId !== "" ||
    filterMission !== "" ||
    filterAfter !== "";

  function clearFilters() {
    setFilterName("");
    setFilterRoleId("");
    setFilterQualId("");
    setFilterMission("");
    setFilterAfter("");
  }

  function resetForm() {
    setEditingId(null);
    setFullName("");
    setSelectedQuals([]);
    setAllowedTypes([]);
    if (roles[0]) setRoleId(roles[0].id);
  }

  function startEdit(p: Person) {
    setEditingId(p.id);
    setFullName(p.full_name);
    setRoleId(p.role_id);
    setSelectedQuals([...p.qualification_ids]);
    setAllowedTypes([...(p.allowed_mission_type_ids || [])]);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token || !roleId) return;
    setError("");
    try {
      const body = {
        full_name: fullName,
        role_id: Number(roleId),
        qualification_ids: selectedQuals,
        allowed_mission_type_ids: allowedTypes,
      };
      if (editingId) {
        await api.updatePerson(token, editingId, body);
      } else {
        await api.createPerson(token, body);
      }
      resetForm();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה");
    }
  }

  function toggleId(list: number[], id: number, setter: (v: number[]) => void) {
    setter(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
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
      <section className="panel">
        <h1 style={{ marginTop: 0 }}>כוח אדם</h1>
        <p style={{ color: "var(--ink-soft)", marginTop: 0 }}>
          אם לא בוחרים סוגי משימות מותרים — החייל יכול לכל המשימות.
          אם בוחרים — הוא מורשה רק לסוגים שנבחרו (לדוגמה רק ש״ג).
        </p>
        {error ? <div className="alert alert-danger">{error}</div> : null}
        {importMessage ? (
          <div className="alert" style={{ marginBottom: "1rem" }}>
            {importMessage}
          </div>
        ) : null}

        <div className="import-box">
          <h2 style={{ marginTop: 0, fontSize: "1.05rem" }}>ייבוא מאקסל</h2>
          <p style={{ color: "var(--ink-soft)", marginTop: 0 }}>
            העלו .xlsx / .xlsm (למשל לוח יציאות). המערכת מזהה אוטומטית עמודות כמו
            שם, מספר אישי, טלפון, פק״ל, מחלקה וכיתה.
          </p>
          <div className="form-grid" style={{ maxWidth: 560 }}>
            <label>
              קובץ
              <input
                type="file"
                accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel.sheet.macroEnabled.12"
                onChange={(e) => {
                  const f = e.target.files?.[0] || null;
                  setImportFile(f);
                  setImportPreview(null);
                  setImportSheets([]);
                  setImportSheet("");
                  setImportMessage("");
                }}
              />
            </label>
            {importSheets.length ? (
              <label>
                גיליון
                <select
                  value={importSheet}
                  onChange={(e) => {
                    setImportSheet(e.target.value);
                    setImportPreview(null);
                  }}
                >
                  {importSheets.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <button
                className="btn btn-ghost"
                type="button"
                disabled={!importFile || importBusy}
                onClick={onPreviewImport}
              >
                {importBusy ? "קורא..." : "תצוגה מקדימה"}
              </button>
              <button
                className="btn btn-primary"
                type="button"
                disabled={!importFile || importBusy}
                onClick={onCommitImport}
              >
                ייבא לכוח אדם
              </button>
            </div>
          </div>
          {importPreview ? (
            <div style={{ marginTop: "1rem" }}>
              <p style={{ color: "var(--ink-soft)", marginTop: 0 }}>
                גיליון: <strong>{importPreview.sheet_name}</strong>
                {" · "}
                חדשים: {importPreview.create_count}
                {" · "}
                עדכון: {importPreview.update_count}
                {" · "}
                עמודות:{" "}
                {Object.entries(importPreview.column_mapping)
                  .map(([k, v]) => `${k}←${v}`)
                  .join(", ")}
              </p>
              <div style={{ maxHeight: 220, overflow: "auto" }}>
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
                    {importPreview.rows.slice(0, 40).map((r, i) => (
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
                {importPreview.rows.length > 40 ? (
                  <p style={{ color: "var(--ink-soft)" }}>
                    מוצגים 40 מתוך {importPreview.rows.length}…
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        <form className="form-grid" onSubmit={onSubmit} style={{ maxWidth: 560, marginTop: "1.25rem" }}>
          <h2 style={{ margin: 0, fontSize: "1.05rem" }}>הוספה ידנית</h2>
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
          <div>
            <div style={{ marginBottom: "0.4rem", color: "var(--ink-soft)" }}>פק״לים</div>
            <div className="people-chips">
              {quals.map((q) => (
                <button
                  key={q.id}
                  type="button"
                  className={`chip ${selectedQuals.includes(q.id) ? "manual" : ""}`}
                  onClick={() => toggleId(selectedQuals, q.id, setSelectedQuals)}
                >
                  {q.name}
                </button>
              ))}
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
              {editingId ? "שמור שינויים" : "הוסף חייל"}
            </button>
            {editingId ? (
              <button className="btn btn-ghost" type="button" onClick={resetForm}>
                ביטול
              </button>
            ) : null}
          </div>
        </form>
      </section>

      <section className="panel">
        <div className="filter-bar" role="search" aria-label="סינון כוח אדם">
          <input
            className="filter-bar-search"
            value={filterName}
            onChange={(e) => setFilterName(e.target.value)}
            placeholder="חיפוש שם…"
            aria-label="חיפוש לפי שם"
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
          <div className="filter-bar-meta">
            <span>
              {filteredPeople.length}/{people.length}
            </span>
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

        <table className="table">
          <thead>
            <tr>
              <th>שם</th>
              <th>מס׳ אישי</th>
              <th>תפקיד</th>
              <th>פק״לים</th>
              <th>משימות מותרות</th>
              <th>אפטר (30 ימים)</th>
              <th>חופשות ומגבלות</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filteredPeople.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ color: "var(--ink-soft)" }}>
                  אין תוצאות לפי הסינון הנוכחי
                </td>
              </tr>
            ) : (
              filteredPeople.map((p) => (
                <tr key={p.id}>
                  <td>
                    <strong>{p.full_name}</strong>
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
                  <td>{p.personal_number || "—"}</td>
                  <td>{p.role_name}</td>
                  <td>
                    {p.qualification_ids
                      .map((id) => quals.find((q) => q.id === id)?.name)
                      .filter(Boolean)
                      .join(", ") || "—"}
                  </td>
                  <td>
                    {(p.allowed_mission_type_ids || []).length === 0
                      ? "הכל"
                      : p.allowed_mission_type_ids
                          .map((id) => missionTypes.find((m) => m.id === id)?.name)
                          .filter(Boolean)
                          .join(", ")}
                  </td>
                  <td>{p.after_count_30d || 0}</td>
                  <td>{renderAvailability(p.id)}</td>
                  <td>
                    <button
                      className="btn btn-ghost btn-small"
                      type="button"
                      onClick={() => startEdit(p)}
                    >
                      עריכה
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </AppShell>
  );
}
