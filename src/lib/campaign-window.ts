/**
 * When a campaign can be told, from its dates and status. Client-safe.
 * Dates are the brand's local days, as "YYYY-MM-DD", and compare as text.
 */

export type CampaignWindow = {
  status: "planning" | "active" | "paused" | "done";
  startDate: string | null;
  endDate: string | null;
};

/** Posts for it can be booked: running now, or scheduled to start, and not over or paused. */
export function isBookable(c: CampaignWindow, today: string) {
  if (c.status === "paused" || c.status === "done") return false;
  if (c.endDate && c.endDate < today) return false;
  // A campaign still being planned is only told once it has a start date to hold it to.
  if (c.status === "planning") return Boolean(c.startDate);
  return true;
}

/** Running today: bookable and already started. */
export function isLive(c: CampaignWindow, today: string) {
  return isBookable(c, today) && (!c.startDate || c.startDate <= today);
}

/** Whether a day falls inside the campaign's dates. */
export function dayInWindow(c: CampaignWindow, day: string) {
  return (!c.startDate || day >= c.startDate) && (!c.endDate || day <= c.endDate);
}

/** Where the dates should have taken the status: planning → active at the start, active → done after the end. */
export function statusFor(c: CampaignWindow, today: string): CampaignWindow["status"] {
  if (c.status === "paused" || c.status === "done") return c.status;
  if (c.endDate && c.endDate < today) return "done";
  if (c.status === "planning" && c.startDate && c.startDate <= today) return "active";
  return c.status;
}

export const DEFAULT_POSTS_PER_WEEK = 3;
