import "server-only";

/**
 * Google Photos Picker API — https://developers.google.com/photos/picker
 *
 * Since April 2025 Google no longer lets apps browse a user's whole library;
 * the Picker is the supported way in. We open a session, the user picks
 * photos in Google's own UI, and we download exactly what they chose.
 */
const API = "https://photospicker.googleapis.com/v1";

async function call<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init?.headers },
  });
  if (res.status === 204) return {} as T;
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Google Photos: ${json.error?.message ?? res.status}`);
  return json as T;
}

export async function getAccountEmail(token: string) {
  try {
    const res = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${token}` } });
    const json = (await res.json()) as { email?: string };
    return json.email ?? null;
  } catch {
    return null;
  }
}

type Session = { id: string; pickerUri: string; mediaItemsSet?: boolean; expireTime?: string };

export async function createSession(token: string) {
  const s = await call<Session>(token, "/sessions", { method: "POST", body: "{}" });
  // "/autoclose" closes Google's tab once the user hits Done.
  return { sessionId: s.id, pickerUri: `${s.pickerUri.replace(/\/$/, "")}/autoclose` };
}

export async function isSessionReady(token: string, sessionId: string) {
  const s = await call<Session>(token, `/sessions/${encodeURIComponent(sessionId)}`);
  return Boolean(s.mediaItemsSet);
}

export async function deleteSession(token: string, sessionId: string) {
  await call(token, `/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" }).catch(() => {});
}

type PickedItem = {
  id: string;
  type: "PHOTO" | "VIDEO" | "TYPE_UNSPECIFIED";
  mediaFile: { baseUrl: string; mimeType: string; filename: string; mediaFileMetadata?: { width?: string | number; height?: string | number } };
};

export async function listPicked(token: string, sessionId: string) {
  const items: PickedItem[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ sessionId, pageSize: "100" });
    if (pageToken) params.set("pageToken", pageToken);
    const json = await call<{ mediaItems?: PickedItem[]; nextPageToken?: string }>(token, `/mediaItems?${params}`);
    items.push(...(json.mediaItems ?? []));
    pageToken = json.nextPageToken;
  } while (pageToken);
  return items;
}

/** Full-resolution bytes. baseUrl needs the same bearer token and a size suffix. */
export async function downloadItem(token: string, item: PickedItem) {
  const suffix = item.type === "VIDEO" ? "=dv" : "=d";
  const res = await fetch(`${item.mediaFile.baseUrl}${suffix}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Could not download ${item.mediaFile.filename} (${res.status}).`);
  return {
    buffer: Buffer.from(await res.arrayBuffer()),
    mimeType: item.mediaFile.mimeType,
    filename: item.mediaFile.filename,
    // int64 fields arrive as strings.
    width: Number(item.mediaFile.mediaFileMetadata?.width) || null,
    height: Number(item.mediaFile.mediaFileMetadata?.height) || null,
  };
}
