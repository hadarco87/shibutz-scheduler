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
    res = await fetch(`${API_URL}${path}`, {
      ...options,
      headers,
      cache: "no-store",
    });
  } catch {
    const isLocalApi =
      API_URL.includes("localhost") || API_URL.includes("127.0.0.1");
    throw new Error(
      isLocalApi
        ? "אין חיבור לשרת. ודאו שה־API רץ ופתחו את האתר ב־http://localhost:3000"
        : "אין חיבור לשרת כרגע. נסו לרענן בעוד כמה שניות — אם זה נמשך, ייתכן שה־API בענן בתהליך עדכון."
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
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
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
  previewInvite: (token: string) =>
    request<InvitePreview>(`/auth/invite/${token}`, {}),
  registerInvite: (body: {
    token: string;
    email: string;
    password: string;
    full_name: string;
  }) =>
    request<TokenResponse>("/auth/register-invite", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  companyMembers: (token: string) =>
    request<CompanyMember[]>("/company/members", {}, token),
  companyInvites: (token: string) =>
    request<CompanyInvite[]>("/company/invites", {}, token),
  createCompanyInvite: (token: string, email: string) =>
    request<CompanyInvite>(
      "/company/invites",
      { method: "POST", body: JSON.stringify({ email }) },
      token
    ),
  revokeCompanyInvite: (token: string, id: number) =>
    request(`/company/invites/${id}`, { method: "DELETE" }, token),
  wipeCompanyData: (
    token: string,
    body: { operational: boolean; catalog: boolean; people: boolean }
  ) =>
    request<{
      ok: boolean;
      operational: boolean;
      catalog: boolean;
      people: boolean;
      deleted: Record<string, unknown>;
    }>("/company/wipe", { method: "POST", body: JSON.stringify(body) }, token),
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
  activeSchedulePlan: (token: string) =>
    request<SchedulePlan | null>("/schedule-plans/active", {}, token),
  getSchedulePlan: (token: string, planId: number) =>
    request<SchedulePlan>(`/schedule-plans/${planId}`, {}, token),
  createSchedulePlan: (
    token: string,
    body: {
      days_count: number;
      start_kind: "today" | "tomorrow" | "date";
      start_date?: string;
      instantiate_recurring?: boolean;
      generate?: boolean;
      notes?: string;
    }
  ) =>
    request<SchedulePlan>(
      "/schedule-plans",
      { method: "POST", body: JSON.stringify(body) },
      token
    ),
  generateSchedulePlan: (
    token: string,
    planId: number,
    body: { scope: "all_draft" | "day"; day_schedule_id?: number }
  ) =>
    request<SchedulePlan>(
      `/schedule-plans/${planId}/generate`,
      { method: "POST", body: JSON.stringify(body) },
      token
    ),
  publishSchedulePlan: (token: string, planId: number) =>
    request<SchedulePlan>(`/schedule-plans/${planId}/publish`, { method: "POST" }, token),
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
  replacementCandidates: async (
    token: string,
    scheduleId: number,
    assignmentId: number,
    mode: "matching" | "all" = "matching"
  ): Promise<ReplacementOptions> => {
    const data = await request<ReplacementOptions | ReplacementCandidate[]>(
      `/schedules/${scheduleId}/assignments/${assignmentId}/replacements?mode=${mode}`,
      {},
      token
    );
    // Harden against older API responses (plain array) so the UI never crashes.
    if (Array.isArray(data)) {
      return {
        mode,
        slot_label: "איוש",
        empty_message: "אין חיילים זמינים למשבצת הזו כרגע",
        candidates: data,
      };
    }
    return {
      mode: data.mode === "all" ? "all" : "matching",
      slot_label: data.slot_label || "איוש",
      required_role_name: data.required_role_name ?? null,
      required_qualification_name: data.required_qualification_name ?? null,
      empty_message:
        data.empty_message || "אין חיילים זמינים למשבצת הזו כרגע",
      candidates: Array.isArray(data.candidates) ? data.candidates : [],
    };
  },
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
  schedulingRules: (token: string) =>
    request<SchedulingRule[]>("/scheduling-rules", {}, token),
  createSchedulingRule: (token: string, body: object) =>
    request<SchedulingRule>(
      "/scheduling-rules",
      { method: "POST", body: JSON.stringify(body) },
      token
    ),
  updateSchedulingRule: (token: string, id: number, body: object) =>
    request<SchedulingRule>(
      `/scheduling-rules/${id}`,
      { method: "PUT", body: JSON.stringify(body) },
      token
    ),
  deleteSchedulingRule: (token: string, id: number) =>
    request(`/scheduling-rules/${id}`, { method: "DELETE" }, token),
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

export type CompanyMember = {
  id: number;
  email: string;
  full_name: string;
  role: string;
  is_active: boolean;
};

export type CompanyInvite = {
  id: number;
  email: string;
  token: string;
  created_at: string;
  accepted_at?: string | null;
  invited_by_name?: string | null;
};

export type InvitePreview = {
  company_name: string;
  email: string;
  invited_by_name?: string | null;
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
  exact_role?: boolean;
  exact_qualification?: boolean;
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
  recurrence_kind?: "daily" | "every_n_days" | "weekly";
  recurrence_interval_days?: number;
  recurrence_weekdays?: string | null;
  recurrence_anchor_date?: string | null;
  routine_hours_mode?: "uniform" | "custom";
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

export type SchedulingRule = {
  id: number;
  company_id: number;
  name?: string | null;
  rule_kind: "transition" | "min_presence" | "sleep_before_after";
  source_mission_type_ids: number[];
  blocked_mission_type_ids: number[];
  source_mission_type_names: string[];
  blocked_mission_type_names: string[];
  min_source_hours: number;
  cooldown_hours: number;
  min_count: number;
  presence_scope: "not_at_home" | "on_mission" | "on_mission_types";
  severity: "hard" | "soft";
  applies_to_all_roles: boolean;
  role_ids: number[];
  role_names: string[];
  qualification_ids: number[];
  qualification_names: string[];
  is_active: boolean;
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
    role_name?: string | null;
    qualification_name?: string | null;
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
  person_role_name?: string | null;
  person_qualification_names?: string[];
  slot_role_name?: string | null;
  slot_qualification_name?: string | null;
};

export type ReplacementCandidate = {
  person_id: number;
  person_name: string;
  role_name?: string | null;
  soft_warnings?: string[];
  requires_override?: boolean;
};

export type ReplacementOptions = {
  mode: "matching" | "all";
  slot_label: string;
  required_role_name?: string | null;
  required_qualification_name?: string | null;
  empty_message: string;
  candidates: ReplacementCandidate[];
};

export type Schedule = {
  id: number;
  plan_id?: number | null;
  day_index?: number;
  window_start: string;
  window_end: string;
  status: "draft" | "published";
  published_at?: string | null;
  notes?: string | null;
  share_token?: string | null;
  assignments: Assignment[];
  missions: Mission[];
};

export type ScheduleDaySummary = {
  id: number;
  plan_id?: number | null;
  day_index: number;
  window_start: string;
  window_end: string;
  status: "draft" | "published";
  published_at?: string | null;
  assignment_count: number;
  mission_count: number;
  staffing_needed?: number;
  staffing_filled?: number;
};

export type SchedulePlan = {
  id: number;
  company_id: number;
  start_date: string;
  days_count: number;
  status: "draft" | "published";
  created_by_id?: number | null;
  published_at?: string | null;
  notes?: string | null;
  days: ScheduleDaySummary[];
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
    is_active?: boolean;
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
