"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth";
import { api, MissionType, WorkloadDashboard } from "@/lib/api";

function formatDifficulty(value: number) {
  return Number.isInteger(value) ? String(value) : String(value);
}

export default function WorkloadPage() {
  const { token } = useAuth();
  const [data, setData] = useState<WorkloadDashboard | null>(null);
  const [catalog, setCatalog] = useState<MissionType[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) return;
    Promise.all([api.workload(token), api.missionTypes(token)])
      .then(([workload, types]) => {
        setData(workload);
        setCatalog(types);
      })
      .catch((e) => setError(e.message));
  }, [token]);

  const max = useMemo(
    () => Math.max(1, ...(data?.people.map((p) => p.total) || [1])),
    [data]
  );

  const maxDifficulty = useMemo(
    () => Math.max(1, ...catalog.map((t) => t.difficulty_weight), 1),
    [catalog]
  );

  const difficultyByName = useMemo(() => {
    const map = new Map<string, number>();
    catalog.forEach((t) => map.set(t.name, t.difficulty_weight));
    return map;
  }, [catalog]);

  const missionTypes = useMemo(() => {
    const set = new Set<string>();
    data?.people.forEach((p) =>
      Object.keys(p.by_mission_type).forEach((k) => set.add(k))
    );
    return Array.from(set);
  }, [data]);

  return (
    <AppShell>
      <section className="panel">
        <h1 style={{ marginTop: 0 }}>מדד עומס</h1>
        <p style={{ color: "var(--ink-soft)" }}>
          מדד העומס = קושי המשימה × שעות שירות.
          מבוסס רק על שיבוצים שפורסמו — טיוטות לא משפיעות.
          העבירו עכבר על שם משימה כדי לראות את רמת הקושי שלה.
        </p>
        {error ? <div className="alert alert-danger">{error}</div> : null}
      </section>

      <section className="panel">
        <table className="table">
          <thead>
            <tr>
              <th>חייל</th>
              {missionTypes.map((t) => {
                const difficulty = difficultyByName.get(t);
                const tip =
                  difficulty != null
                    ? `קושי ${formatDifficulty(difficulty)}/${formatDifficulty(maxDifficulty)}`
                    : undefined;
                return (
                  <th key={t} title={tip} style={{ cursor: tip ? "help" : undefined }}>
                    {t}
                  </th>
                );
              })}
              <th>סה״כ</th>
              <th>ויזואלי</th>
            </tr>
          </thead>
          <tbody>
            {(data?.people || []).map((p) => (
              <tr key={p.person_id}>
                <td>{p.person_name}</td>
                {missionTypes.map((t) => (
                  <td key={t}>{p.by_mission_type[t] || 0}</td>
                ))}
                <td>
                  <strong>{p.total}</strong>
                </td>
                <td style={{ minWidth: 140 }}>
                  <div className="bar">
                    <span style={{ width: `${(p.total / max) * 100}%` }} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </AppShell>
  );
}
