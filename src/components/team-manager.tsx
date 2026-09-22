"use client";
import { useState, useTransition } from "react";
import { UserPlus, X } from "lucide-react";
import { Card, CardHeader, Field, buttonClass } from "./ui";
import { inviteMemberAction, removeMemberAction, setMemberRoleAction } from "@/server/actions/brands";
import { ROLES } from "@/lib/db/roles";

export type MemberRow = { userId: string; name: string; email: string; role: string };

const ROLE_HELP: Record<string, string> = {
  owner: "Everything, including deleting the brand.",
  admin: "Manage channels, team and content.",
  editor: "Write, schedule and publish.",
  approver: "Review and approve, but not edit.",
  viewer: "Read-only.",
};

export function TeamManager({
  brandId, members, canManage, currentUserId,
}: { brandId: string; members: MemberRow[]; canManage: boolean; currentUserId: string }) {
  const [pending, start] = useTransition();
  const [invite, setInvite] = useState<{ url: string; email: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader title="Team" subtitle={`${members.length} member${members.length === 1 ? "" : "s"}`} />

      <ul className="divide-y divide-border">
        {members.map((m) => (
          <li key={m.userId} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-surface-2 text-[11px] font-semibold">
              {m.name.slice(0, 2).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">{m.name}{m.userId === currentUserId ? " (you)" : ""}</p>
              <p className="truncate text-[11px] text-muted">{m.email}</p>
            </div>
            {canManage ? (
              <select
                value={m.role}
                disabled={pending}
                onChange={(e) => { const role = e.target.value; setError(null); start(async () => { const res = await setMemberRoleAction(brandId, m.userId, role); if (!res.ok) setError(res.error); }); }}
                className="!w-32 !py-1 !text-xs"
                title={ROLE_HELP[m.role]}
              >
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            ) : (
              <span className="text-xs text-muted">{m.role}</span>
            )}
            {canManage && m.userId !== currentUserId && (
              <button
                disabled={pending}
                onClick={() => { if (confirm(`Remove ${m.name}?`)) { setError(null); start(async () => { const res = await removeMemberAction(brandId, m.userId); if (!res.ok) setError(res.error); }); } }}
                className={buttonClass("ghost", "sm")}
              >
                <X className="size-3.5" />
              </button>
            )}
          </li>
        ))}
      </ul>

      {canManage && (
        <form
          action={(fd) =>
            start(async () => {
              setError(null);
              try {
                const res = await inviteMemberAction(brandId, fd);
                if (!res.ok) { setError(res.error); return; }
                setInvite(res.added ? null : { url: res.inviteUrl, email: res.email });
              } catch (e) {
                setError(e instanceof Error ? e.message : "Could not invite.");
              }
            })
          }
          className="space-y-2 border-t border-border p-3"
        >
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-44 flex-1">
              <Field label="Invite by email">
                <input name="email" type="email" required placeholder="teammate@company.com" className="!py-1 !text-sm" />
              </Field>
            </div>
            <select name="role" defaultValue="editor" className="!w-32 !py-1.5 !text-sm">
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <button className={buttonClass("subtle", "sm")} disabled={pending}>
              <UserPlus className="size-3.5" /> Invite
            </button>
          </div>

          {error && <p className="text-xs text-danger">{error}</p>}
          {invite && (
            <p className="rounded-lg border border-border bg-surface-2 px-2.5 py-2 text-xs">
              {invite.email} has no account yet. Send them this link:{" "}
              <code className="rounded bg-surface px-1 py-0.5">{invite.url}</code>
            </p>
          )}
        </form>
      )}
    </Card>
  );
}
