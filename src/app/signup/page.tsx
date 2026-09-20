import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { signUpAction } from "@/server/actions/auth";
import { getCurrentUser } from "@/lib/auth";

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ invite?: string }> }) {
  if (await getCurrentUser()) redirect("/");
  const { invite } = await searchParams;
  return (
    <main className="flex min-h-dvh items-center justify-center px-6 py-16">
      <AuthForm mode="signup" action={signUpAction} invite={invite} />
    </main>
  );
}
