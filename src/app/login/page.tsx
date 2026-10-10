import { redirect } from "next/navigation";
import { CalendarDays, CheckCircle2, Layers } from "lucide-react";
import { AuthForm } from "@/components/auth-form";
import { signInAction } from "@/server/actions/auth";
import { getCurrentUser } from "@/lib/auth";

const POINTS = [
  { icon: Layers, text: "Write a post once, tune it for every channel that should carry it." },
  { icon: CheckCircle2, text: "Approvals, a playbook of platform rules, and checks before anything goes out." },
  { icon: CalendarDays, text: "Every brand on one calendar, published automatically or handed over ready to paste." },
];

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/");
  return (
    <main className="mx-auto flex min-h-dvh max-w-4xl flex-col justify-center gap-10 px-6 py-16 md:flex-row md:items-center md:gap-16">
      <section className="flex-1 space-y-5">
        <span className="grid size-9 place-items-center rounded-lg bg-linear-to-br from-accent to-chart-2 text-base font-bold text-accent-fg shadow-sm">gg</span>
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">ggsocial</h1>
          <p className="mt-2 text-muted">One desk for every brand you run: plan, approve, schedule and publish social content without a tab per company.</p>
        </div>
        <ul className="space-y-3">
          {POINTS.map(({ icon: Icon, text }) => (
            <li key={text} className="flex gap-3 text-sm">
              <Icon className="mt-0.5 size-4 shrink-0 text-accent" /> <span>{text}</span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted">Access is by invitation only.</p>
      </section>
      <div className="flex flex-1 justify-center md:justify-end">
        <AuthForm mode="signin" action={signInAction} />
      </div>
    </main>
  );
}
