"use client";
import { useActionState } from "react";
import Link from "next/link";
import { buttonClass, Field } from "./ui";
import type { FormState } from "@/server/actions/auth";

export function AuthForm({
  mode, action, invite,
}: {
  mode: "signin" | "signup";
  action: (prev: FormState, data: FormData) => Promise<FormState>;
  invite?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const isSignup = mode === "signup";

  return (
    <form action={formAction} className="w-full max-w-sm space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {isSignup ? "Create your account" : "Sign in"}
        </h1>
        <p className="mt-1 text-sm text-muted">
          {isSignup ? "One desk for every brand you run." : "Welcome back."}
        </p>
      </div>

      {invite && <input type="hidden" name="invite" value={invite} />}

      {isSignup && (
        <Field label="Your name (optional)">
          <input name="name" autoComplete="name" placeholder="Mo" />
        </Field>
      )}
      <Field label="Email">
        <input name="email" type="email" required autoComplete="email" placeholder="you@company.com" />
      </Field>
      <Field label="Password" hint={isSignup ? "At least 8 characters." : undefined}>
        <input name="password" type="password" required autoComplete={isSignup ? "new-password" : "current-password"} />
      </Field>

      {state.error && (
        <p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{state.error}</p>
      )}

      <button type="submit" disabled={pending} className={`${buttonClass("primary")} w-full`}>
        {pending ? "One moment…" : isSignup ? "Create account" : "Sign in"}
      </button>

      <p className="text-center text-sm text-muted">
        {isSignup ? (
          <>Already have an account? <Link href="/login" className="text-accent hover:underline">Sign in</Link></>
        ) : (
          <>New here? <Link href="/signup" className="text-accent hover:underline">Create an account</Link></>
        )}
      </p>
    </form>
  );
}
