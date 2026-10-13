import type { PostStatus } from "@/lib/db";

/**
 * What the calendar filters by and what each entry asks of someone. Client-safe.
 */

export const CALENDAR_FILTERS = [
  { key: "all", label: "Everything", color: "#8b8b96" },
  { key: "action", label: "Needs someone", color: "#b45309" },
  { key: "review", label: "In review", color: "#b45309" },
  { key: "scheduled", label: "Scheduled", color: "#4f46e5" },
  { key: "published", label: "Published", color: "#15803d" },
  { key: "ideas", label: "Ideas", color: "#a855f7" },
] as const;
export type CalendarFilter = (typeof CALENDAR_FILTERS)[number]["key"];

/**
 * What this entry needs from a person right now, or null when nothing does.
 * `targetStatuses` are the statuses of the channels posting at this time.
 */
export function calendarAction(status: PostStatus, targetStatuses: string[]): string | null {
  if (status === "in_review") return "Needs approval";
  if (status === "changes_requested") return "Changes requested";
  if (status === "failed" || targetStatuses.includes("failed")) return "Failed — check it";
  if (targetStatuses.includes("awaiting_manual")) return "Post it by hand";
  if (status === "draft") return "Draft";
  if (status === "approved") return "Approved — needs a date";
  return null;
}

export function inFilter(filter: CalendarFilter, status: PostStatus, action: string | null, projected = false) {
  if (filter === "ideas") return projected;
  if (projected) return filter === "all";
  switch (filter) {
    case "all": return true;
    case "action": return action !== null;
    case "review": return status === "in_review" || status === "changes_requested";
    case "scheduled": return status === "scheduled" || status === "publishing" || status === "approved";
    case "published": return status === "published" || status === "partially_published";
    default: return false;
  }
}
