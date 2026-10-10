import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { signUpAction } from "@/server/actions/auth";
import { getCurrentUser } from "@/lib/auth";
import { findOpenInvite } from "@/lib/auth/invite";
import { buttonClass } from "@/components/ui";

/** Sign-up is by invitation only: without a live invite link there is no form at all. */
export default async function SignupPage({ searchParams }: { searchParams: Promise<{ invite?: string }> }) {
  if (await getCurrentUser()) redirect("/");
  const { invite } = await searchParams;
  const open = await findOpenInvite(invite);

  return (
    <main className="flex min-h-dvh items-center justify-center px-6 py-16">
      {open ? (
        <AuthForm mode="signup" action={signUpAction} invite={invite} email={open.email} />
      ) : (
        <div className="w-full max-w-sm space-y-4">
          <h1 className="text-2xl font-semibold tracking-tight">Invitation only</h1>
          <p className="text-sm text-muted">
            This link is missing, already used or no longer valid. Ask whoever runs your workspace for a new invite.
          </p>
          <Link href="/login" className={`${buttonClass("primary")} w-full`}>Sign in</Link>
        </div>
      )}
    </main>
  );
}
