import { notFound } from "next/navigation";
import { requireUser, getMyBrands, can } from "@/lib/auth";
import { getBrandTeam, getBrandChannels } from "@/server/queries";
import { updateBrandAction, archiveBrandAction } from "@/server/actions/brands";
import { TeamManager } from "@/components/team-manager";
import { Card, CardHeader, Field, PageHeader, buttonClass, Badge, LinkButton } from "@/components/ui";
import { PlatformIcon } from "@/components/platform-icon";
import { BrandImageUploader, ChipListField, LinksEditor, PaletteEditor } from "@/components/brand-profile";
import { BRAND_IMAGE_SLOTS, LOGO_SLOTS } from "@/lib/brand-images";
import { COMMON_TIMEZONES } from "@/lib/format";
import { readableOn } from "@/lib/color";
import { EMOJI_POLICIES } from "@/lib/db";
import { Layers } from "lucide-react";
import { getBookDefaults, getBookDefaultsById, bookState } from "@/server/brand-book";
import { linkBrandBookAction, resolveBookFieldAction, unlinkBrandBookAction } from "@/server/actions/brand-book";
import { BOOK_FIELDS, BOOK_FIELD_LABELS, EMOJI_LABELS, bookValues, readableBookValue, type BookField } from "@/lib/brand-book";
import { FromMasterPanel, LabelRow } from "@/components/master-panels";

/**
 * Every profile card is its own form so one save can't clobber another.
 *
 * `revision` is the section's saved values. Re-keying the form on it remounts
 * the inputs after a save, because React otherwise reconciles the existing
 * nodes and re-applies the previous render's `defaultValue` — a saved select
 * would visibly snap back to its old option. Keying per section rather than
 * per brand means saving one card never discards unsaved edits in another.
 */
function SectionForm({
  id, section, title, subtitle, editable, revision, children,
}: {
  id: string; section: string; title: string; subtitle?: string;
  editable: boolean; revision: string; children: React.ReactNode;
}) {
  return (
    <Card id={section}>
      <CardHeader title={title} subtitle={subtitle} />
      <form key={revision} action={updateBrandAction.bind(null, id)} className="space-y-3 p-4">
        <input type="hidden" name="section" value={section} />
        {children}
        {editable && (
          <div className="pt-1">
            <button className={buttonClass("primary", "sm")}>Save {title.toLowerCase()}</button>
          </div>
        )}
      </form>
    </Card>
  );
}

const rev = (...values: unknown[]) => JSON.stringify(values);

export default async function BrandPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const brands = await getMyBrands(user.id);
  const brand = brands.find((b) => b.id === id);
  if (!brand) notFound();

  const [team, channels, linkedBook, myBook] = await Promise.all([
    getBrandTeam(id), getBrandChannels([id]),
    brand.bookDefaultsId ? getBookDefaultsById(brand.bookDefaultsId) : null,
    getBookDefaults(user.id),
  ]);
  const book = linkedBook ? { row: linkedBook, state: bookState(brand, linkedBook), values: bookValues(linkedBook) } : null;
  const readable: Partial<Record<BookField, string>> = {};
  if (book) for (const f of BOOK_FIELDS) readable[f] = readableBookValue(f, book.values[f]);
  /** "From master" or "Customised" beside a field that follows the master brand book. */
  const t = (f: BookField) => book ? (
    book.state.customised.includes(f)
      ? <span className="text-[11px] font-normal text-accent">Customised</span>
      : <span className="text-[11px] font-normal text-muted">From master</span>
  ) : null;
  const L = (text: string, f: BookField) => <LabelRow text={text} tag={t(f)} />;
  const editable = can.manageBrand(brand.role);
  const ro = !editable;

  return (
    <>
      <PageHeader
        title={brand.name}
        subtitle={
          <>
            {brand.tagline && <span className="block text-text">{brand.tagline}</span>}
            {channels.length} channel{channels.length === 1 ? "" : "s"} · {brand.timezone} · you are {brand.role}
            {!editable && " (read-only — admins can edit the profile)"}
          </>
        }
        action={<LinkButton href="/channels" size="sm">Manage channels</LinkButton>}
      />

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          <SectionForm
            id={id}
            section="basics"
            revision={rev(brand.name, brand.tagline, brand.color, brand.timezone, brand.website)}
            title="Basics"
            subtitle="How this brand shows up across the calendar and queue."
            editable={editable}
          >
            <Field label="Name">
              <input name="name" defaultValue={brand.name} disabled={ro} required />
            </Field>
            <Field label="Tagline" hint="One line. Shown under the brand name everywhere.">
              <input name="tagline" defaultValue={brand.tagline ?? ""} disabled={ro} placeholder="Robots that do the boring bits" />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Calendar colour" hint="Used to tell brands apart on the shared calendar.">
                <input name="color" type="color" defaultValue={brand.color} disabled={ro} />
              </Field>
              <Field label="Timezone" hint="Scheduling for this brand is shown in this zone.">
                <select name="timezone" defaultValue={brand.timezone} disabled={ro}>
                  {COMMON_TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Website">
              <input name="website" type="url" defaultValue={brand.website ?? ""} disabled={ro} placeholder="https://acme.com" />
            </Field>
          </SectionForm>

          <SectionForm
            id={id}
            section="identity"
            revision={rev(brand.legalName, brand.industry, brand.foundedYear, brand.hqLocation, brand.contactEmail, brand.description)}
            title="Company profile"
            subtitle="The background a new writer or freelancer needs on day one."
            editable={editable}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Legal name" hint="If it differs from the trading name.">
                <input name="legalName" defaultValue={brand.legalName ?? ""} disabled={ro} placeholder="Acme Robotics Ltd" />
              </Field>
              <Field label="Industry">
                <input name="industry" defaultValue={brand.industry ?? ""} disabled={ro} placeholder="Industrial automation" />
              </Field>
              <Field label="Founded">
                <input name="foundedYear" type="number" min={1800} max={new Date().getFullYear() + 1}
                  defaultValue={brand.foundedYear ?? ""} disabled={ro} placeholder="2019" />
              </Field>
              <Field label="Headquarters">
                <input name="hqLocation" defaultValue={brand.hqLocation ?? ""} disabled={ro} placeholder="Manchester, UK" />
              </Field>
            </div>
            <Field label="Contact email" hint="Where press or partnership replies should go.">
              <input name="contactEmail" type="email" defaultValue={brand.contactEmail ?? ""} disabled={ro} placeholder="press@acme.com" />
            </Field>
            <Field label="What the company does" hint="A paragraph or two. This is the context behind every post.">
              <textarea name="description" rows={5} defaultValue={brand.description ?? ""} disabled={ro}
                placeholder="Acme builds pick-and-place arms for small workshops…" />
            </Field>
          </SectionForm>

          <SectionForm
            id={id}
            section="visual"
            revision={rev(brand.palette, brand.fontHeading, brand.fontBody, brand.logoUsage, brand.imageStyle)}
            title="Visual identity"
            subtitle="Logos, key images, palette and type — what the brand is allowed to look like."
            editable={editable}
          >
            <Field label="Logos" hint="Up to three versions, stored in this brand's media library. PNG or SVG with transparency works best.">
              <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-4">
                {LOGO_SLOTS.map((slot) => (
                  <div key={slot} className="space-y-1.5">
                    <p className="text-xs font-medium">{BRAND_IMAGE_SLOTS[slot].label}</p>
                    <p className="text-[11px] text-muted">{BRAND_IMAGE_SLOTS[slot].hint}</p>
                    <BrandImageUploader
                      brandId={id}
                      slot={slot}
                      url={brand[BRAND_IMAGE_SLOTS[slot].column]}
                      brandName={brand.name}
                      brandColor={brand.color}
                      canEdit={editable}
                    />
                  </div>
                ))}
              </div>
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              {(["social", "default"] as const).map((slot) => (
                <Field key={slot} label={BRAND_IMAGE_SLOTS[slot].label} hint={BRAND_IMAGE_SLOTS[slot].hint}>
                  <BrandImageUploader
                    brandId={id}
                    slot={slot}
                    url={brand[BRAND_IMAGE_SLOTS[slot].column]}
                    brandName={brand.name}
                    brandColor={brand.color}
                    canEdit={editable}
                  />
                </Field>
              ))}
            </div>

            <Field label="Palette" hint="Name each colour so people know when to reach for it.">
              <PaletteEditor value={brand.palette} disabled={ro} />
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={L("Heading typeface", "fontHeading")}>
                <input name="fontHeading" defaultValue={brand.fontHeading ?? ""} disabled={ro} placeholder="Söhne Bold" />
              </Field>
              <Field label={L("Body typeface", "fontBody")}>
                <input name="fontBody" defaultValue={brand.fontBody ?? ""} disabled={ro} placeholder="Inter Regular" />
              </Field>
            </div>

            <Field label={L("Logo usage", "logoUsage")} hint="Clear space, which mark on which background, what never to do.">
              <textarea name="logoUsage" rows={3} defaultValue={brand.logoUsage ?? ""} disabled={ro}
                placeholder="Full lockup on light backgrounds, icon only below 32px. Never recolour." />
            </Field>
            <Field label={L("Photography & image style", "imageStyle")}>
              <textarea name="imageStyle" rows={3} defaultValue={brand.imageStyle ?? ""} disabled={ro}
                placeholder="Real workshops, natural light, no stock handshakes." />
            </Field>
          </SectionForm>

          <SectionForm
            id={id}
            section="voice"
            revision={rev(brand.brief, brand.voice, brand.audience, brand.valueProps, brand.bannedWords, brand.defaultHashtags, brand.emojiPolicy, brand.ctaText, brand.boilerplate)}
            title="Voice & messaging"
            subtitle="Surfaced in the composer whenever someone writes for this brand."
            editable={editable}
          >
            <Field label={L("Brief", "brief")} hint="The short version, shown at the top of the composer.">
              <textarea name="brief" rows={3} defaultValue={brand.brief ?? ""} disabled={ro}
                placeholder="Dry, technical, no hype. Always link the docs." />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={L("Tone of voice", "voice")}>
                <textarea name="voice" rows={3} defaultValue={brand.voice ?? ""} disabled={ro}
                  placeholder="Plain, confident, slightly dry. We explain, we don't sell." />
              </Field>
              <Field label={L("Audience", "audience")}>
                <textarea name="audience" rows={3} defaultValue={brand.audience ?? ""} disabled={ro}
                  placeholder="Workshop owners and machinists, 5–50 staff." />
              </Field>
            </div>

            <ChipListField
              label={L("Key messages", "valueProps")}
              name="valueProps"
              hint="The handful of things every post should ladder back to."
              defaultValue={brand.valueProps}
              disabled={ro}
              placeholder={"Setup in an afternoon\nNo integrator needed"}
            />

            <ChipListField
              label={L("Words to avoid", "bannedWords")}
              name="bannedWords"
              hint="Flagged in the composer as you type. One per line, or comma separated."
              defaultValue={brand.bannedWords}
              disabled={ro}
              placeholder={"revolutionary\ngame-changer\nsynergy"}
            />

            <ChipListField
              label={L("Default hashtags", "defaultHashtags")}
              name="defaultHashtags"
              hint="Offered as one-click inserts in the composer."
              defaultValue={brand.defaultHashtags}
              disabled={ro}
              prefix="#"
              placeholder={"#automation\n#manufacturing"}
            />

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={L("Emoji policy", "emojiPolicy")}>
                <select name="emojiPolicy" defaultValue={brand.emojiPolicy} disabled={ro}>
                  {EMOJI_POLICIES.map((p) => <option key={p} value={p}>{EMOJI_LABELS[p]}</option>)}
                </select>
              </Field>
              <Field label={L("Default call to action", "ctaText")}>
                <input name="ctaText" defaultValue={brand.ctaText ?? ""} disabled={ro} placeholder="Book a 20-minute demo →" />
              </Field>
            </div>

            <Field label={L("Boilerplate", "boilerplate")} hint="The standing 'about us' paragraph for press and long-form posts.">
              <textarea name="boilerplate" rows={3} defaultValue={brand.boilerplate ?? ""} disabled={ro} />
            </Field>
          </SectionForm>

          <SectionForm
            id={id}
            section="links"
            revision={rev(brand.links)}
            title="Links"
            subtitle={`Press kit, docs, app listings — whatever gets pasted into posts.${book ? (book.state.customised.includes("links") ? " Customised for this brand." : " From the master brand book.") : ""}`}
            editable={editable}
          >
            <LinksEditor value={brand.links} disabled={ro} />
          </SectionForm>

          <SectionForm
            id={id}
            section="notes"
            revision={rev(brand.notes)}
            title="Internal notes"
            subtitle="Only ever visible here. Never published anywhere."
            editable={editable}
          >
            <Field label="Notes">
              <textarea name="notes" rows={4} defaultValue={brand.notes ?? ""} disabled={ro}
                placeholder="Legal sign-off needed on anything mentioning safety certification." />
            </Field>
          </SectionForm>
        </div>

        <div className="space-y-5">
          {book ? (
            <FromMasterPanel
              href="/brands/master"
              masterTitle="Master brand book"
              guidelines={null}
              notes={null}
              pending={book.state.pending}
              customised={book.state.customised}
              masterValues={readable}
              fieldLabels={BOOK_FIELD_LABELS}
              canEdit={editable}
              resolve={resolveBookFieldAction.bind(null, id)}
              unlink={unlinkBrandBookAction.bind(null, id)}
              unlinkConfirm="Stop following the master brand book? This brand keeps its current voice and rules."
            />
          ) : editable && myBook ? (
            <Card>
              <CardHeader icon={Layers} title="Master brand book" subtitle="Follow the house voice and rules. Empty fields fill in; anything written here stays." />
              <form action={linkBrandBookAction.bind(null, id)} className="p-3">
                <button className={buttonClass("primary", "sm")}>Link to master brand book</button>
              </form>
            </Card>
          ) : null}
          <Card>
            <CardHeader title="At a glance" />
            <div className="space-y-3 p-4">
              <div className="flex items-center gap-3">
                <span
                  className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-xl border border-border"
                  style={brand.logoUrl ? undefined : { background: brand.color, color: readableOn(brand.color) }}
                >
                  {brand.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={brand.logoUrl} alt="" className="size-full object-contain" />
                  ) : (
                    <span className="text-sm font-bold">{brand.name.slice(0, 2).toUpperCase()}</span>
                  )}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{brand.legalName ?? brand.name}</p>
                  <p className="truncate text-xs text-muted">{brand.industry ?? "No industry set"}</p>
                </div>
              </div>

              {brand.palette.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {brand.palette.map((c) => (
                    <span
                      key={`${c.name}-${c.hex}`}
                      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium"
                      style={{ background: c.hex, color: readableOn(c.hex) }}
                      title={c.hex}
                    >
                      {c.name}
                    </span>
                  ))}
                </div>
              )}

              <dl className="space-y-1.5 text-xs">
                {[
                  ["Website", brand.website],
                  ["Contact", brand.contactEmail],
                  ["HQ", brand.hqLocation],
                  ["Founded", brand.foundedYear?.toString() ?? null],
                  ["Type", [brand.fontHeading, brand.fontBody].filter(Boolean).join(" / ") || null],
                ].map(([label, value]) =>
                  value ? (
                    <div key={label} className="flex justify-between gap-3">
                      <dt className="text-muted">{label}</dt>
                      <dd className="min-w-0 truncate text-right">{value}</dd>
                    </div>
                  ) : null,
                )}
              </dl>

              {brand.links.length > 0 && (
                <ul className="space-y-1 border-t border-border pt-2 text-xs">
                  {brand.links.map((l) => (
                    <li key={l.url}>
                      <a href={l.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                        {l.label}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>

          <TeamManager
            brandId={id}
            canManage={can.manageTeam(brand.role)}
            currentUserId={user.id}
            members={team.map((t) => ({
              userId: t.user.id, name: t.user.name, email: t.user.email, role: t.membership.role,
            }))}
          />

          <Card>
            <CardHeader title="Channels" action={<LinkButton href="/channels" size="sm">Add</LinkButton>} />
            <ul className="divide-y divide-border">
              {channels.map((c) => (
                <li key={c.id} className="flex items-center gap-2 px-4 py-2.5">
                  <PlatformIcon platform={c.platform} />
                  <span className="min-w-0 flex-1 truncate text-sm">{c.handle}</span>
                  <Badge color={c.mode === "live" ? "#15803d" : "#8b8b96"}>{c.mode}</Badge>
                </li>
              ))}
              {channels.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted">No channels yet.</li>}
            </ul>
          </Card>

          {brand.role === "owner" && (
            <Card>
              <CardHeader title="Danger zone" />
              <form action={archiveBrandAction.bind(null, id)} className="p-4">
                <button className={buttonClass("danger", "sm")}>Archive this brand</button>
                <p className="mt-1.5 text-[11px] text-muted">
                  Archiving hides the brand and its calendar. Nothing is deleted.
                </p>
              </form>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
