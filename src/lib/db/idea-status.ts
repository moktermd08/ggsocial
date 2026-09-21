/** Plan statuses, importable from client components without pulling in drizzle. */
export const IDEA_STATUSES = ["backlog", "planned", "drafting", "scheduled", "published", "parked"] as const;
export type IdeaStatus = (typeof IDEA_STATUSES)[number];
