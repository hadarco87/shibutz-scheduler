import type { Assignment, MissionTypeRequirement } from "@/lib/api";

/** Preferred פק״ל display order within a mission (after commanders). */
const QUAL_ORDER = [
  "נהג",
  "חובש",
  "קשר",
  "צלף",
  "קלע",
  "מטול",
  "מאגיסט",
  "מג״ל",
  'מג"ל',
];

export function roleRank(name: string | null | undefined): number {
  const n = (name || "").trim();
  if (!n) return 50;
  if (/קצין/.test(n)) return 0;
  if (/מ״פ|מ"פ|רס״פ|רס"פ/.test(n) || n === "מפקד") return 1;
  if (/מפקד/.test(n)) return 2;
  if (/זוטר|מש״ק|מש"ק|סמל/.test(n)) return 3;
  if (/חייל/.test(n)) return 40;
  return 30;
}

export function qualRank(name: string | null | undefined): number {
  const n = (name || "").trim();
  if (!n) return 900;
  const idx = QUAL_ORDER.findIndex((q) => n === q || n.includes(q));
  return idx >= 0 ? idx : 500;
}

type NamedRequirement = {
  role_id?: number | null;
  qualification_id?: number | null;
  roleName?: string | null;
  qualName?: string | null;
};

function requirementSortKey(r: NamedRequirement): [number, number, number, string] {
  const roleName = (r.roleName || "").trim();
  const qualName = (r.qualName || "").trim();
  const hasLeader =
    !!r.role_id &&
    roleRank(roleName) <= 3 &&
    !!roleName &&
    !/חייל/.test(roleName);
  const hasQual = !!r.qualification_id;
  const bucket = hasLeader ? 0 : hasQual ? 1 : 2;
  const primary =
    bucket === 0
      ? roleRank(roleName)
      : bucket === 1
        ? qualRank(qualName)
        : roleRank(roleName || "חייל");
  const secondary = bucket === 1 ? roleRank(roleName) : qualRank(qualName);
  const label = [roleName, qualName].filter(Boolean).join("+");
  return [bucket, primary, secondary, label];
}

/**
 * Stable order for mission-type requirement chips/labels:
 * commanders → פק״ל slots (נהג, חובש…) → חיילים/כללי.
 */
export function sortMissionRequirements<T extends MissionTypeRequirement>(
  list: T[],
  resolveNames: (r: T) => { roleName?: string | null; qualName?: string | null }
): T[] {
  return [...list].sort((a, b) => {
    const an = resolveNames(a);
    const bn = resolveNames(b);
    const ka = requirementSortKey({
      role_id: a.role_id,
      qualification_id: a.qualification_id,
      roleName: an.roleName,
      qualName: an.qualName,
    });
    const kb = requirementSortKey({
      role_id: b.role_id,
      qualification_id: b.qualification_id,
      roleName: bn.roleName,
      qualName: bn.qualName,
    });
    for (let i = 0; i < 3; i++) {
      if (ka[i] !== kb[i]) return (ka[i] as number) - (kb[i] as number);
    }
    return ka[3].localeCompare(kb[3], "he");
  });
}

/**
 * Stable visual order for people chips inside a mission:
 * commanders → required פק״לים (נהג, חובש…) → חיילים כלליים → by name.
 */
export function sortAssignmentsForDisplay<T extends Assignment>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const aHasLeaderSlot =
      roleRank(a.slot_role_name) <= 3 &&
      !!a.slot_role_name &&
      !/חייל/.test(a.slot_role_name);
    const bHasLeaderSlot =
      roleRank(b.slot_role_name) <= 3 &&
      !!b.slot_role_name &&
      !/חייל/.test(b.slot_role_name);
    const aHasQualSlot = !!a.slot_qualification_name;
    const bHasQualSlot = !!b.slot_qualification_name;

    const aBucket = aHasLeaderSlot ? 0 : aHasQualSlot ? 1 : 2;
    const bBucket = bHasLeaderSlot ? 0 : bHasQualSlot ? 1 : 2;
    if (aBucket !== bBucket) return aBucket - bBucket;

    if (aBucket === 0) {
      const rr = roleRank(a.slot_role_name) - roleRank(b.slot_role_name);
      if (rr !== 0) return rr;
    }
    if (aBucket === 1) {
      const qr =
        qualRank(a.slot_qualification_name) - qualRank(b.slot_qualification_name);
      if (qr !== 0) return qr;
    }

    if (aBucket === 2) {
      const rr = roleRank(a.person_role_name) - roleRank(b.person_role_name);
      if (rr !== 0) return rr;
      const aq = (a.person_qualification_names || [])[0] || "";
      const bq = (b.person_qualification_names || [])[0] || "";
      const qr = qualRank(aq) - qualRank(bq);
      if (qr !== 0) return qr;
    }

    return (a.person_name || "").localeCompare(b.person_name || "", "he");
  });
}

export function assignmentsForMission(
  assignments: Assignment[],
  missionId: number
): Assignment[] {
  return sortAssignmentsForDisplay(
    assignments.filter((a) => a.mission_id === missionId)
  );
}

export type OpenStaffingSlot = {
  key: string;
  requirementId?: number;
  roleName?: string | null;
  qualificationName?: string | null;
  label: string;
};

function slotLabel(
  roleName?: string | null,
  qualificationName?: string | null,
  fallback?: string | null
): string {
  const parts = [roleName, qualificationName].filter(Boolean);
  if (parts.length) return parts.join(" · ");
  if (fallback?.trim()) return fallback.trim();
  return "איוש כללי";
}

/**
 * Unfilled requirement seats for a mission, in the same display order as people chips.
 */
export function openSlotsForMission(
  mission: {
    id: number;
    personnel_count: number;
    requirements?: {
      id: number;
      count: number;
      label?: string | null;
      role_name?: string | null;
      qualification_name?: string | null;
      role_id?: number | null;
      qualification_id?: number | null;
    }[];
  },
  assignments: Assignment[]
): OpenStaffingSlot[] {
  const assigned = assignments.filter((a) => a.mission_id === mission.id);
  const reqs = [...(mission.requirements || [])];
  const used = new Set<number>();
  const open: OpenStaffingSlot[] = [];

  const sortedReqs = [...reqs].sort((a, b) => {
    const ka = requirementSortKey({
      role_id: a.role_id,
      qualification_id: a.qualification_id,
      roleName: a.role_name,
      qualName: a.qualification_name,
    });
    const kb = requirementSortKey({
      role_id: b.role_id,
      qualification_id: b.qualification_id,
      roleName: b.role_name,
      qualName: b.qualification_name,
    });
    for (let i = 0; i < 3; i++) {
      if (ka[i] !== kb[i]) return (ka[i] as number) - (kb[i] as number);
    }
    return ka[3].localeCompare(kb[3], "he");
  });

  for (const req of sortedReqs) {
    let filled = 0;
    for (const a of assigned) {
      if (used.has(a.id)) continue;
      if (a.requirement_id === req.id) {
        used.add(a.id);
        filled += 1;
      }
    }
    const missing = Math.max(0, req.count - filled);
    for (let i = 0; i < missing; i++) {
      open.push({
        key: `req-${req.id}-${i}`,
        requirementId: req.id,
        roleName: req.role_name,
        qualificationName: req.qualification_name,
        label: slotLabel(req.role_name, req.qualification_name, req.label),
      });
    }
  }

  const leftoverShortfall = Math.max(
    0,
    mission.personnel_count - assigned.length - open.length
  );
  for (let i = 0; i < leftoverShortfall; i++) {
    open.push({
      key: `general-${mission.id}-${i}`,
      label: "איוש כללי",
    });
  }

  return open;
}
