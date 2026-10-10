"use client";
import { useState, useTransition } from "react";
import { UserPlus, X } from "lucide-react";
import { Card, CardHeader, Field, buttonClass } from "./ui";
import { addUserAction, revokeInviteAction, setUserAccessAction } from "@/server/actions/users";
import { ROLES } from "@/lib/db/roles";

type BrandCol = { id: string; name: string; myRole: string };
type Person = { id: string; name: string; email: string; access: Record<string, string> };
type PendingInvite = { token: string; email: string; brandId: string; role: string };

const ROLE_HELP: Record<string, string> = {
  owner: "Everything, including deleting the brand.",
  admin: "Manage channels, team and content.",
  editor: "Write, schedule and publish.",
  approver: "Review and approve, but not edit.",
  viewer: "Read-only.",
};

export function UsersManager({
  currentUserId, brands, people, invites,
}: { currentUserId: string; brands: BrandCol[]; people: Person[]; invites: PendingInvite[] }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ url: string; email: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const brandName = (id: string) => brands.find((b) => b.id === id)?.name ?? "";
  // Only owners may hand out or change ownership, so the others never see it as a choice.
  const rolesFor = (b: BrandCol) => (b.myRole === "owner" ? ROLES : ROLES.filter((r) => r !== "owner"));

  function setAccess(userId: string, brandId: string, role: string) {
    setError(null);
    start(async () => {
      const res = await setUserAccessAction(userId, brandId, role);
      if (!res.ok) setError(res.error);
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Add a user" subtitle="Pick the brands they should see and the role they get on each." />
        <form
          action={(fd) =>
            start(async () => {
              setError(null); setLink(null); setNotice(null);
              const res = await addUserAction(fd);
              if (!res.ok) { setError(res.error); return; }
              if (res.added) setNotice(`${res.email} now has access.`);
              else setLink({ url: `${window.location.origin}${res.inviteUrl}`, email: res.email });
            })
          }
          className="space-y-3 p-4"
        >
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-56 flex-1">
              <Field label="Email">
                <input name="email" type="email" required placeholder="teammate@company.com" />
              </Field>
            </div>
            <Field label="Role">
              <select name="role" defaultValue="editor" className="!w-36">
                {ROLES.filter((r) => r !== "owner" || brands.some((b) => b.myRole === "owner")).map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </Field>
          </div>

          <fieldset>
            <legend className="mb-1 text-xs font-medium text-muted">Brands</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {brands.map((b) => (
                <label key={b.id} className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" name="brandId" value={b.id} className="!w-auto" /> {b.name}
                </label>
              ))}
            </div>
          </fieldset>

          <button className={buttonClass("primary", "sm")} disabled={pending}>
            <UserPlus className="size-3.5" /> Add user
          </button>

          {error && <p className="text-xs text-danger">{error}</p>}
          {notice && <p className="text-xs text-muted">{notice}</p>}
          {link && (
            <p className="rounded-lg border border-border bg-surface-2 px-2.5 py-2 text-xs">
              {link.email} has no account yet. Send them this link; it gives them access when they sign up:{" "}
              <code className="break-all rounded bg-surface px-1 py-0.5">{link.url}</code>
            </p>
          )}
        </form>
      </Card>

      <Card>
        <CardHeader title="People" subtitle={`${people.length} with access to ${brands.length} brand${brands.length === 1 ? "" : "s"} you manage`} />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted">
                <th className="px-4 py-2 font-medium">Person</th>
                {brands.map((b) => <th key={b.id} className="px-2 py-2 font-medium">{b.name}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {people.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-2.5">
                    <p className="truncate">{p.name}{p.id === currentUserId ? " (you)" : ""}</p>
                    <p className="truncate text-[11px] text-muted">{p.email}</p>
                  </td>
                  {brands.map((b) => {
                    const role = p.access[b.id] ?? "none";
                    // An admin cannot edit an owner's row; the server refuses it too.
                    const locked = role === "owner" && b.myRole !== "owner";
                    return (
                      <td key={b.id} className="px-2 py-2.5">
                        <select
                          value={role}
                          disabled={pending || locked}
                          onChange={(e) => setAccess(p.id, b.id, e.target.value)}
                          title={ROLE_HELP[role] ?? "No access to this brand."}
                          className="!w-28 !py-1 !text-xs"
                        >
                          <option value="none">No access</option>
                          {(locked ? ROLES : rolesFor(b)).map((r) => <option key={r} value={r}>{r}</option>)}
                        </select>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {invites.length > 0 && (
        <Card>
          <CardHeader title="Waiting to sign up" subtitle="Invited, but no account yet." />
          <ul className="divide-y divide-border">
            {invites.map((i) => (
              <li key={i.token} className="flex items-center gap-2 px-4 py-2.5 text-sm">
                <span className="min-w-0 flex-1 truncate">{i.email}</span>
                <span className="text-xs text-muted">{brandName(i.brandId)} · {i.role}</span>
                <button
                  disabled={pending}
                  title="Withdraw invite"
                  onClick={() => { setError(null); start(async () => { const res = await revokeInviteAction(i.token); if (!res.ok) setError(res.error); }); }}
                  className={buttonClass("ghost", "sm")}
                >
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
