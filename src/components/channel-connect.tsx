"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plug } from "lucide-react";
import { Button, Card, CardHeader } from "./ui";
import { pickChannelAccountAction } from "@/server/actions/channels";

/**
 * A sign-in reached several accounts — Pages, Instagram accounts, YouTube
 * channels — and none plainly matched the channel. The person picks one.
 */
export function ConnectPicker({ connectionId, channelLabel, accounts }: {
  connectionId: string; channelLabel: string; accounts: { externalId: string; name: string; handle: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pick = (externalId: string) => {
    setError(null);
    setBusy(externalId);
    start(async () => {
      try {
        const r = await pickChannelAccountAction(connectionId, externalId);
        if (!r.ok) { setError(r.error); return; }
        router.replace("/channels?connected=1");
      } catch {
        setError("Could not reach the server. Check your connection and try again.");
      } finally {
        setBusy(null);
      }
    });
  };

  return (
    <Card className="mb-5 border-accent/40">
      <CardHeader icon={Plug} title={`Which account is ${channelLabel}?`}
        subtitle="Your sign-in can manage more than one. Pick the one this channel posts as and reads comments from." />
      <ul className="divide-y divide-border">
        {accounts.map((a) => (
          <li key={a.externalId} className="flex items-center gap-3 px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-text">{a.name}</p>
              <p className="truncate text-xs text-muted">{a.handle}</p>
            </div>
            <Button size="sm" variant="primary" disabled={pending} onClick={() => pick(a.externalId)}>
              {busy === a.externalId && <Loader2 className="size-3.5 animate-spin" />} Use this one
            </Button>
          </li>
        ))}
      </ul>
      {error && <p className="px-4 pb-3 text-xs text-danger">{error}</p>}
    </Card>
  );
}
