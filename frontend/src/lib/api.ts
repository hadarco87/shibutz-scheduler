const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api";

export type TokenResponse = { access_token: string; token_type: string };

async function request<T>(
  path: string,
  options: RequestInit = {},
  token?: string | null
): Promise<T> {
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  if (token) {
    (headers as Record<string, string>)["Authorization"] = `Bearer ${token}`;
  }
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...options, headers });
  } catch {
    throw new Error(
      "אין חיבור לשרת. ודאו שה־API רץ ופתחו את האתר ב־http://localhost:3000"
    );
  }
  if (!res.ok) {
    let detail = "שגיאה בשרת";
    try {
      const data = await res.json();
      detail = data.detail || detail;
      if (Array.isArray(detail)) {
        detail = detail.map((d: { msg?: string }) => d.msg || JSON.stringify(d)).join(", ");
      }
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

async function uploadForm<T>(
  path: string,
  form: FormData,
  token: string
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) {
    let detail = "שגיאה בשרת";
    try {
      const data = await res.json();
      detail = data.detail || detail;
      if (Array.isArray(detail)) {
        detail = detail.map((d: { msg?: string }) => d.msg || JSON.stringify(d)).join(", ");
      }
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return res.json();
}

export const api = {
  login: (email: string, password: string) =>
    request<TokenResponse>("/auth/login-json", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  register: (body: {
    email: string;
    password: string;
    full_name: string;
    company_name: string;
  }) =>
    request<TokenResponse>("/auth/register", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  me: (token: string) => request<User>("/auth/me", {}, token),
  people: (token: string) => request<Person[]>("/people", {}, token),
  previewPeopleImport: (token: string, file: File, sheet?: string) => {
    const form = new FormData();
    form.append("file", file);
    if (sheet) form.append("sheet", sheet);
    return uploadForm<PeopleImportPreview>("/people/import/preview", form, token);
  },
  commitPeopleImport: (token: string, file: File, sheet?: string) => {
    const form = new FormData();
    form.append("file", file);
    if (sheet) form.append("sheet", sheet);
    return uploadForm<PeopleImportResult>("/people/import", form, token);
  },
  createPerson: (token: string, body: object) =>
    request<Person>("/people", { method: "POST", body: JSON.stringify(body) }, token),
  updatePerson: (token: string, id: number, body: object) =>
    request<Person>(`/people/${id}`, { method: "PUT", body: JSON.stringify(body) }, token),
  deletePerson: (token: string, id: number) =>
    request(`/people/${id}`, { method: "DELETE" }, token),
  roles: (token: string) => request<Role[]>("/roles", {}, token),
  createRole: (token: string, body: object) =>
    request<Role>("/roles", { method: "POST", body: JSON.stringify(body) }, token),
  updateRole: (token: string, id: number, body: object) =>
    request<Role>(`/roles/${id}`, { method: "PUT", body: JSON.stringify(body) }, token),
  deleteRole: (token: string, id: number) =>
    request(`/roles/${id}`, { method: "DELETE" }, token),
  qualifications: (token: string) => request<Qualification[]>("/qualifications", {}, token),
  createQualification: (token: string, body: object) =>
    request<Qualification>("/qualifications", { method: "POST", body: JSON.stringify(body) }, token),
  updateQualification: (token: string, id: number, body: object) =>
    request<Qualification>(`/qualifications/${id}`, { method: "PUT", body: JSON.stringify(body) }, token),
  deleteQualification: (token: string, id: number) =>
    request(`/qualifications/${id}`, { method: "DELETE" }, token),
  missionTypes: (token: string) => request<MissionType[]>("/mission-types", {}, token),
  createMissionType: (token: string, body: object) =>
    request<MissionType>("/mission-types", { method: "POST", body: JSON.stringify(body) }, token),
  updateMissionType: (token: string, id: number, body: object) =>
    request<MissionType>(`/mission-types/${id}`, { method: "PUT", body: JSON.stringify(body) }, token),
  deleteMissionType: (token: string, id: number) =>
    request(`/mission-types/${id}`, { method: "DELETE" }, token),
  leave: (token: string) => request<Leave[]>("/leave", {}, token),
  createLeave: (token: string, body: object) =>
    request<Leave>("/leave", { method: "POST", body: JSON.stringify(body) }, token),
  deleteLeave: (token: string, id: number) =>
    request(`/leave/${id}`, { method: "DELETE" }, token),
  restrictions: (token: string) => request<Restriction[]>("/restrictions", {}, token),
  createRestriction: (token: string, body: object) =>
    request<Restriction>("/restrictions", { method: "POST", body: JSON.stringify(body) }, token),
  deleteRestriction: (token: string, id: number) =>
    request(`/restrictions/${id}`, { method: "DELETE" }, token),
  recurringRestrictions: (token: string) =>
    request<RecurringRestriction[]>("/recurring-restrictions", {}, token),
  createRecurringRestriction: (token: string, body: object) =>
    request<RecurringRestriction>(
      "/recurring-restrictions",
      { method: "POST", body: JSON.stringify(body) },
      token
    ),
  deleteRecurringRestriction: (token: string, id: number) =>
    request(`/recurring-restrictions/${id}`, { method: "DELETE" }, token),
  schedules: (token: string) => request<Schedule[]>("/schedules", {}, token),
  getSchedule: (token: string, id: number) => request<Schedule>(`/schedules/${id}`, {}, token),
  createSchedule: (token: string, body: object) =>
    request<Schedule>("/schedules", { method: "POST", body: JSON.stringify(body) }, token),
  syncScheduleMissions: (token: string, id: number) =>
    request<Schedule>(`/schedules/${id}/sync-missions`, { method: "POST" }, token),
  generate: (token: string, id: number) =>
    request<SchedulingResult>(`/schedules/${id}/generate`, { method: "POST" }, token),
  publish: (token: string, id: number) =>
    request<Schedule>(`/schedules/${id}/publish`, { method: "POST" }, token),
  replaceAssignment: (
    token: string,
    scheduleId: number,
    assignmentId: number,
    body: { person_id: number; override_reason?: string }
  ) =>
    request<Assignment>(
      `/schedules/${scheduleId}/assignments/${assignmentId}/replace`,
      { method: "POST", body: JSON.stringify(body) },
      token
    ),
  replacementCandidates: (
    token: string,
    scheduleId: number,
    assignmentId: number
  ) =>
    request<ReplacementCandidate[]>(
      `/schedules/${scheduleId}/assignments/${assignmentId}/replacements`,
      {},
      token
    ),
  createMission: (token: string, body: object) =>
    request<Mission>("/missions", { method: "POST", body: JSON.stringify(body) }, token),
  updateMission: (token: string, id: number, body: object) =>
    request<Mission>(`/missions/${id}`, { method: "PUT", body: JSON.stringify(body) }, token),
  deleteMission: (token: string, id: number) =>
    request(`/missions/${id}`, { method: "DELETE" }, token),
  workload: (token: string) => request<WorkloadDashboard>("/workload", {}, token),
  historySummary: (token: string, days?: number) =>
    request<HistorySummary>(
      days != null ? `/history/summary?days=${days}` : "/history/summary",
      {},
      token
    ),
  kanimRules: (token: string) => request<KanimRule[]>("/kanim-rules", {}, token),
  createKanimRule: (token: string, body: object) =>
    request<KanimRule>("/kanim-rules", { method: "POST", body: JSON.stringify(body) }, token),
  updateKanimRule: (token: string, id: number, body: object) =>
    request<KanimRule>(`/kanim-rules/${id}`, { method: "PUT", body: JSON.stringify(body) }, token),
  deleteKanimRule: (token: string, id: number) =>
    request(`/kanim-rules/${id}`, { method: "DELETE" }, token),
  afterPreview: (token: string, scheduleId: number) =>
    request<AfterPreview>(`/schedules/${scheduleId}/after`, {}, token),
  saveAfterDrafts: (token: string, scheduleId: number, items: AfterDraftItem[]) =>
    request<AfterPreview>(
      `/schedules/${scheduleId}/after`,
      { method: "PUT", body: JSON.stringify({ items }) },
      token
    ),
};

export type User = {
  id: number;
  email: string;
  full_name: string;
  role: string;
  company_id: number;
  is_active: boolean;
  company_name?: string | null;
};

export type Person = {
  id: number;
  company_id: number;
  full_name: string;
  role_id: number;
  rank?: string | null;
  personal_number?: string | null;
  phone?: string | null;
  notes?: string | null;
  is_active: boolean;
  qualification_ids: number[];
  allowed_mission_type_ids: number[];
  role_name?: string | null;
  after_count_30d?: number;
  last_after_end?: string | null;
};

export type PeopleImportPreview = {
  sheet_name: string;
  sheet_options: string[];
  column_mapping: Record<string, string>;
  rows: {
    full_name: string;
    personal_number?: string | null;
    phone?: string | null;
    role_name?: string | null;
    qualification_names: string[];
    notes?: string | null;
    action: string;
    match_person_id?: number | null;
    warnings: string[];
  }[];
  create_count: number;
  update_count: number;
  skip_count: number;
};

export type PeopleImportResult = {
  created: number;
  updated: number;
  skipped: number;
  qualifications_created: number;
  sheet_name: string;
  warnings: string[];
};

export type Role = {
  id: number;
  name: string;
  description?: string | null;
  is_active: boolean;
  can_fulfill_role_ids: number[];
};

export type Qualification = {
  id: number;
  name: string;
  description?: string | null;
  is_active: boolean;
};

export type MissionTypeRequirement = {
  id?: number;
  role_id?: number | null;
  qualification_id?: number | null;
  count: number;
};

export type MissionTypeWindow = {
  id?: number;
  start_minute: number;
  end_minute: number;
  sort_order?: number;
};

export type MissionTypeStaffingBand = {
  id?: number;
  label?: string | null;
  start_minute: number;
  end_minute: number;
  personnel_count: number;
  sort_order?: number;
  requirements: MissionTypeRequirement[];
};

export type MissionType = {
  id: number;
  name: string;
  description?: string | null;
  difficulty_weight: number;
  default_personnel_count: number;
  default_duration_hours?: number;
  is_recurring_template: boolean;
  recurring_start_hour?: number | null;
  recurring_end_hour?: number | null;
  required_sleep_hours_before_after?: number;
  routine_remainder_policy?: "include_short" | "full_only";
  is_active: boolean;
  default_requirements: MissionTypeRequirement[];
  time_windows?: MissionTypeWindow[];
  staffing_bands?: MissionTypeStaffingBand[];
};

export type KanimRule = {
  id: number;
  company_id: number;
  kind: "weekday" | "weekend" | "specific_date";
  min_count: number;
  specific_date?: string | null;
  notes?: string | null;
};

export type AfterDraftItem = {
  person_id: number;
  start_at: string;
  end_at: string;
};

export type AfterCandidate = {
  person_id: number;
  person_name: string;
  after_count_30d: number;
  sleep_warning: boolean;
  sleep_warning_message?: string | null;
  recommended_rank: number;
};

export type AfterDraft = {
  id: number;
  schedule_id: number;
  person_id: number;
  start_at: string;
  end_at: string;
  person_name?: string | null;
};

export type AfterPreview = {
  total_active: number;
  min_kanim: number;
  after_quota: number;
  candidates: AfterCandidate[];
  drafts: AfterDraft[];
};

export type Leave = {
  id: number;
  person_id: number;
  leave_type: string;
  start_at: string;
  end_at: string;
  notes?: string | null;
};

export type Restriction = {
  id: number;
  person_id: number;
  start_at: string;
  end_at: string;
  restriction_type: string;
  unavailable: boolean;
  notes?: string | null;
};

export type RecurringRestriction = {
  id: number;
  person_id: number;
  kind: "daily" | "every_n_days" | "weekly";
  interval_days: number;
  weekdays?: string | null;
  time_start: string;
  time_end: string;
  anchor_date?: string | null;
  active_from?: string | null;
  active_until?: string | null;
  restriction_type: string;
  unavailable: boolean;
  is_active: boolean;
  notes?: string | null;
};

export type Mission = {
  id: number;
  name: string;
  start_at: string;
  end_at: string;
  difficulty_weight: number;
  personnel_count: number;
  mission_type_id: number;
  mission_type_name?: string | null;
  is_adhoc: boolean;
  requirements: {
    id: number;
    role_id?: number | null;
    qualification_id?: number | null;
    count: number;
    label?: string | null;
  }[];
};

export type Assignment = {
  id: number;
  schedule_id: number;
  mission_id: number;
  person_id: number;
  requirement_id?: number | null;
  is_manual: boolean;
  override_reason?: string | null;
  difficulty_at_assignment: number;
  person_name?: string | null;
  mission_name?: string | null;
};

export type ReplacementCandidate = {
  person_id: number;
  person_name: string;
  role_name?: string | null;
  soft_warnings?: string[];
};

export type Schedule = {
  id: number;
  window_start: string;
  window_end: string;
  status: "draft" | "published";
  published_at?: string | null;
  notes?: string | null;
  share_token?: string | null;
  assignments: Assignment[];
  missions: Mission[];
};

export type SchedulingResult = {
  status: string;
  schedule: Schedule;
  warnings: { severity: string; code: string; message: string }[];
  conflicts: { mission_id: number; mission_name: string; message: string }[];
  explanations: string[];
};

export type WorkloadDashboard = {
  people: {
    person_id: number;
    person_name: string;
    total: number;
    by_mission_type: Record<string, number>;
  }[];
  snapshot_at?: string | null;
};

export type HistorySummary = {
  people: {
    person_id: number;
    person_name: string;
    total_hours: number;
    by_mission_type: Record<string, number>;
  }[];
  mission_types: string[];
  from_at?: string | null;
  to_at?: string | null;
  published_schedules: number;
};
