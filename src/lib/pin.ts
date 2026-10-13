/**
 * An idea's pin: the day (and optionally the time) a person dragged it to.
 * Stored as "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM", in the brand's own timezone.
 */
export type Pin = { day: string; time: string | null };

export function parsePin(text: string | null | undefined): Pin | null {
  const m = text?.match(/^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?$/);
  return m ? { day: m[1], time: m[2] ?? null } : null;
}

export function formatPin(day: string, time?: string | null) {
  const t = time?.match(/^(\d{1,2}):(\d{2})$/);
  return t ? `${day}T${t[1].padStart(2, "0")}:${t[2]}` : day;
}
