import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { signInAction } from "@/server/actions/auth";
import { getCurrentUser } from "@/lib/auth";

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/");
  return (
    <main className="flex min-h-dvh items-center justify-center px-6 py-16">
      <AuthForm mode="signin" action={signInAction} />
    </main>
  );
}
