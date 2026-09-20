import { createBrandAction } from "@/server/actions/brands";
import { Card, CardHeader, Field, PageHeader, buttonClass } from "@/components/ui";
import { COMMON_TIMEZONES } from "@/lib/format";
import { requireUser } from "@/lib/auth";

const SWATCHES = ["#6366f1", "#ec4899", "#f97316", "#10b981", "#0ea5e9", "#a855f7", "#ef4444", "#eab308", "#14b8a6", "#8b5cf6"];

export default async function NewBrandPage() {
  await requireUser();
  return (
    <>
      <PageHeader
        title="Add a brand"
        subtitle="A company, a client or a side project — anything with its own accounts. Only the name is required; the full brand profile opens as soon as you create it."
      />
      <Card className="max-w-2xl">
        <CardHeader title="Details" />
        <form action={createBrandAction} className="space-y-4 p-4">
          <Field label="Brand name">
            <input name="name" required placeholder="Acme Robotics" autoFocus />
          </Field>

          <Field label="Tagline (optional)" hint="One line. Shown under the brand name everywhere.">
            <input name="tagline" placeholder="Robots that do the boring bits" />
          </Field>

          <Field label="Calendar colour" hint="Used to tell brands apart on the shared calendar.">
            <div className="flex flex-wrap gap-2">
              {SWATCHES.map((c, i) => (
                <label key={c} className="cursor-pointer">
                  <input type="radio" name="color" value={c} defaultChecked={i === 0} className="peer sr-only" />
                  <span
                    className="block size-8 rounded-lg ring-offset-2 ring-offset-surface peer-checked:ring-2 peer-checked:ring-accent peer-focus-visible:ring-2"
                    style={{ background: c, boxShadow: "inset 0 0 0 1px rgba(0,0,0,.08)" }}
                  />
                </label>
              ))}
            </div>
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Timezone" hint="Scheduling for this brand is shown in this zone.">
              <select name="timezone" defaultValue="Europe/London">
                {COMMON_TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
              </select>
            </Field>
            <Field label="Industry (optional)">
              <input name="industry" placeholder="Industrial automation" />
            </Field>
          </div>

          <Field label="Website (optional)">
            <input name="website" type="url" placeholder="https://acme.com" />
          </Field>

          <Field label="What the company does (optional)" hint="A paragraph of context behind every post.">
            <textarea name="description" rows={3} placeholder="Acme builds pick-and-place arms for small workshops…" />
          </Field>

          <Field label="Brief (optional)" hint="Voice, tone, banned words — shown to whoever writes for this brand.">
            <textarea name="brief" rows={3} placeholder="Dry, technical, no emoji. Always link the docs." />
          </Field>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button className={buttonClass("primary")}>Create brand</button>
            <p className="text-xs text-muted">
              Logo, palette, typography, key messages and links come next, on the brand&apos;s own page.
            </p>
          </div>
        </form>
      </Card>
    </>
  );
}
