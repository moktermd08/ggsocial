/** Role list, importable from client components without pulling in drizzle. */
export const ROLES = ["owner", "admin", "editor", "approver", "viewer"] as const;
export type Role = (typeof ROLES)[number];
