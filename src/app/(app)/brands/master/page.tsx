import Link from "next/link";
import { BookMarked, Layers, Link2, Unlink } from "lucide-react";
import { requireUser, getMyBrands, can } from "@/lib/auth";
import { db, brands as brandsTable, EMOJI_POLICIES } from "@/lib/db";
import { inArray } from "drizzle-orm";
import { getBookDefaults, bookStates } from "@/server/brand-book";
import { saveBookDefaultsAction, linkBrandBookAction, unlinkBrandBookAction } from "@/server/actions/brand-book";
import { BOOK_FIELD_LABELS, EMOJI_LABELS, type BookField } from "@/lib/brand-book";
import { ChipListField, LinksEditor } from "@/components/brand-profile";
import { Badge, Card, CardHeader, Field, PageHeader, SectionTitle, buttonClass } from "@/components/ui";

const list = (fields: BookField[]) => fields.map((f) => BOOK_FIELD_LABELS[f].toLowerCase()).join(", ");

export default async function MasterBrandBookPage() {
  const user = await requireUser();
  const mine = await getMyBrands(user.id);
  const book = await getBookDefaults(user.id);
  const rows = mine.length ? await db.select().from(brandsTable).where(inArray(brandsTable.id, mine.map((b) => b.id))) : [];
  const states = await bookStates(rows);
  const byId = new Map(rows.map((r) => [r.id, r]));

  return (
    <>
      <PageHeader
        icon={Layers}
        title="Master brand book"
        subtitle="The house voice and rules every linked brand starts from. Identity — name, logo, palette — stays with each brand."
      />

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <CardHeader
            icon={BookMarked}
            title="Defaults"
            subtitle="Linked brands follow each field until they change it. Changing a field here updates every brand still following it."
          />
          <form key={book?.updatedAt.toISOString() ?? "new"} action={saveBookDefaultsAction} className="space-y-4 p-4">
            <SectionTitle title="Voice & messaging" />
            <Field label="Brief" hint="The short version, shown at the top of the composer.">
              <textarea name="brief" rows={3} defaultValue={book?.brief ?? ""} placeholder="Plain English, no hype. Every claim backed by a number or a link." />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Tone of voice">
                <textarea name="voice" rows={3} defaultValue={book?.voice ?? ""} placeholder="Confident, practical, a little dry." />
              </Field>
              <Field label="Audience">
                <textarea name="audience" rows={3} defaultValue={book?.audience ?? ""} placeholder="Owners of small UK businesses." />
              </Field>
            </div>
            <ChipListField label="Key messages" name="valueProps" defaultValue={book?.valueProps ?? []} placeholder={"Built by practitioners\nNo lock-in"} />
            <ChipListField label="Words to avoid" name="bannedWords" defaultValue={book?.bannedWords ?? []} placeholder={"revolutionary\nsynergy\nleverage"} />
            <ChipListField label="Default hashtags" name="defaultHashtags" defaultValue={book?.defaultHashtags ?? []} prefix="#" placeholder={"#smallbusiness"} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Emoji policy">
                <select name="emojiPolicy" defaultValue={book?.emojiPolicy ?? "free"}>
                  {EMOJI_POLICIES.map((p) => <option key={p} value={p}>{EMOJI_LABELS[p]}</option>)}
                </select>
              </Field>
              <Field label="Default call to action">
                <input name="ctaText" defaultValue={book?.ctaText ?? ""} placeholder="Book a call →" />
              </Field>
            </div>
            <Field label="Boilerplate">
              <textarea name="boilerplate" rows={3} defaultValue={book?.boilerplate ?? ""} />
            </Field>

            <SectionTitle title="Visual guidance" />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Heading typeface"><input name="fontHeading" defaultValue={book?.fontHeading ?? ""} /></Field>
              <Field label="Body typeface"><input name="fontBody" defaultValue={book?.fontBody ?? ""} /></Field>
            </div>
            <Field label="Logo usage"><textarea name="logoUsage" rows={2} defaultValue={book?.logoUsage ?? ""} /></Field>
            <Field label="Photography & image style"><textarea name="imageStyle" rows={2} defaultValue={book?.imageStyle ?? ""} /></Field>

            <SectionTitle title="Links" hint="Shared links, such as a group careers page or legal notices." />
            <LinksEditor value={book?.links ?? []} />

            <div className="pt-1">
              <button className={buttonClass("primary", "sm")}>Save master brand book</button>
            </div>
          </form>
        </Card>

        <Card>
          <CardHeader title="Brands" subtitle={book ? "Link a brand to have it follow this book." : "Save the book first, then link brands."} />
          <div className="space-y-1.5 p-3">
            {mine.map((b) => {
              const row = byId.get(b.id)!;
              const state = states.get(b.id);
              const linkedHere = book && row.bookDefaultsId === book.id;
              const linkedElsewhere = row.bookDefaultsId && !linkedHere;
              const admin = can.manageBrand(b.role);
              return (
                <div key={b.id} className="rounded-lg border border-border px-2.5 py-2">
                  <div className="flex items-center gap-2">
                    <span className="size-3 shrink-0 rounded" style={{ background: b.color }} />
                    <Link href={`/brands/${b.id}`} className="min-w-0 flex-1 truncate text-sm font-medium hover:underline">{b.name}</Link>
                    {linkedHere ? <Badge color="#16a34a">Linked</Badge> : linkedElsewhere ? <Badge>Another book</Badge> : null}
                    {admin && book && (
                      <form action={(linkedHere ? unlinkBrandBookAction : linkBrandBookAction).bind(null, b.id)}>
                        <button className={buttonClass("ghost", "sm")} title={linkedHere ? "Unlink" : "Link to this book"}>
                          {linkedHere ? <Unlink className="size-3.5" /> : <Link2 className="size-3.5" />}
                          {linkedHere ? "" : "Link"}
                        </button>
                      </form>
                    )}
                  </div>
                  {linkedHere && state && (
                    <>
                      <p className="mt-1 text-[11px] text-muted">
                        {state.customised.length ? `Customised: ${list(state.customised)}` : "Follows the master"}
                      </p>
                      {state.pending.length > 0 && (
                        <p className="mt-0.5 text-[11px] text-warn">
                          {state.pending.length} change{state.pending.length === 1 ? "" : "s"} waiting: {list(state.pending)}
                        </p>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </>
  );
}
