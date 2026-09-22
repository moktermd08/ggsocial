"use server";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { asResult } from "@/lib/action-result";
import { redirect } from "next/navigation";
import { db, brands, memberships, activity, users, invites, media, type Role } from "@/lib/db";
import { requireUser, requireBrandRole } from "@/lib/auth";
import { emojiPolicy, hashtags, hex, links, list, palette, str, year } from "@/server/brand-form";
import { storeUpload, kindFromMime } from "@/server/media";
import { getBookDefaults, linkBrandToBook, syncBrandBook } from "@/server/brand-book";

function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "brand";
}

/**
 * The brand page saves one card at a time, so each form declares which section
 * it owns and only that section's columns are written. Without this a partly
 * rendered form (say, the identity card for a viewer) would blank out every
 * column it happens not to include.
 */
const BRAND_SECTIONS = ["basics", "identity", "visual", "voice", "links", "notes"] as const;
type BrandSection = (typeof BRAND_SECTIONS)[number];

function patchFor(section: BrandSection, fd: FormData) {
  switch (section) {
    case "basics":
      return {
        name: String(fd.get("name") ?? "").trim() || undefined,
        color: hex(fd, "color", "#6366f1"),
        timezone: String(fd.get("timezone") ?? "UTC"),
        website: str(fd, "website"),
        tagline: str(fd, "tagline"),
      };
    case "identity":
      return {
        legalName: str(fd, "legalName"),
        industry: str(fd, "industry"),
        foundedYear: year(fd, "foundedYear"),
        hqLocation: str(fd, "hqLocation"),
        contactEmail: str(fd, "contactEmail"),
        description: str(fd, "description"),
      };
    case "visual":
      return {
        palette: palette(fd),
        fontHeading: str(fd, "fontHeading"),
        fontBody: str(fd, "fontBody"),
        logoUsage: str(fd, "logoUsage"),
        imageStyle: str(fd, "imageStyle"),
      };
    case "voice":
      return {
        brief: str(fd, "brief"),
        voice: str(fd, "voice"),
        audience: str(fd, "audience"),
        valueProps: list(fd, "valueProps"),
        bannedWords: list(fd, "bannedWords").map((w) => w.toLowerCase()),
        defaultHashtags: hashtags(fd, "defaultHashtags"),
        emojiPolicy: emojiPolicy(fd),
        ctaText: str(fd, "ctaText"),
        boilerplate: str(fd, "boilerplate"),
      };
    case "links":
      return { links: links(fd) };
    case "notes":
      return { notes: str(fd, "notes") };
  }
}

/* ---------------------------------------------------------------- actions */

export async function createBrandAction(formData: FormData) {
  const user = await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Give the brand a name.");

  let slug = slugify(name);
  const clash = await db.query.brands.findFirst({ where: eq(brands.slug, slug) });
  if (clash) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;

  const [brand] = await db.insert(brands).values({
    name,
    slug,
    color: hex(formData, "color", "#6366f1"),
    timezone: String(formData.get("timezone") ?? "UTC"),
    website: str(formData, "website"),
    tagline: str(formData, "tagline"),
    industry: str(formData, "industry"),
    description: str(formData, "description"),
    brief: str(formData, "brief"),
  }).returning();

  await db.insert(memberships).values({ userId: user.id, brandId: brand.id, role: "owner" });
  // A new brand starts from your master brand book, if you have one.
  const book = await getBookDefaults(user.id);
  if (book) await linkBrandToBook(brand.id, book.id);
  await db.insert(activity).values({ brandId: brand.id, actorId: user.id, action: "brand.created", entity: "brand", entityId: brand.id });
  revalidatePath("/", "layout");
  redirect(`/brands/${brand.id}`);
}

/** Saves one section of the brand profile. Everything else is left alone. */
export async function updateBrandAction(brandId: string, formData: FormData) {
  const { user } = await requireBrandRole(brandId, "admin");
  const raw = String(formData.get("section") ?? "basics");
  if (!(BRAND_SECTIONS as readonly string[]).includes(raw)) throw new Error("Unknown brand section.");
  const section = raw as BrandSection;

  const patch = patchFor(section, formData);
  // `name: undefined` means the field came through blank — keep the old name.
  const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  if (Object.keys(clean).length === 0) return;

  await db.update(brands).set(clean).where(eq(brands.id, brandId));
  // Fields saved back to the master's value are in step with it again.
  await syncBrandBook(brandId);
  await db.insert(activity).values({
    brandId, actorId: user.id, action: "brand.updated", entity: "brand", entityId: brandId, meta: { section },
  });
  revalidatePath("/", "layout");
}

const MAX_LOGO_BYTES = 10 * 1024 * 1024;

/** Uploads a logo into the brand's media library and points the brand at it. */
export async function uploadBrandLogoAction(brandId: string, formData: FormData) {
  return asResult(async () => {
    const { user } = await requireBrandRole(brandId, "admin");
    const file = formData.get("logo");
    if (!(file instanceof File) || file.size === 0) throw new Error("Choose an image to upload.");
    if (file.size > MAX_LOGO_BYTES) throw new Error("Logos are capped at 10 MB.");
    if (!file.type.startsWith("image/")) throw new Error("A logo has to be an image.");

    const stored = await storeUpload(file);
    await db.insert(media).values({
      brandId,
      kind: kindFromMime(file.type),
      url: stored.url,
      originalName: file.name,
      mimeType: file.type,
      size: stored.size,
      uploadedBy: user.id,
      tags: ["logo"],
    });
    await db.update(brands).set({ logoUrl: stored.url }).where(eq(brands.id, brandId));
    revalidatePath("/", "layout");
    return { url: stored.url };
  });
}

export async function clearBrandLogoAction(brandId: string) {
  return asResult(async () => {
    await requireBrandRole(brandId, "admin");
    await db.update(brands).set({ logoUrl: null }).where(eq(brands.id, brandId));
    revalidatePath("/", "layout");
  });
}

export async function archiveBrandAction(brandId: string) {
  await requireBrandRole(brandId, "owner");
  await db.update(brands).set({ archivedAt: new Date() }).where(eq(brands.id, brandId));
  revalidatePath("/", "layout");
  redirect("/");
}

export async function inviteMemberAction(brandId: string, formData: FormData) {
  return asResult(async () => {
    const { user } = await requireBrandRole(brandId, "admin");
    const email = String(formData.get("email") ?? "").toLowerCase().trim();
    const role = String(formData.get("role") ?? "editor") as Role;
    if (!email) throw new Error("Enter an email address.");

    const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
    if (existing) {
      const already = await db.query.memberships.findFirst({
        where: and(eq(memberships.userId, existing.id), eq(memberships.brandId, brandId)),
      });
      if (!already) await db.insert(memberships).values({ userId: existing.id, brandId, role });
      revalidatePath(`/brands/${brandId}`);
      return { added: true as const, email };
    }

    // No account yet: hand back a link the admin can send however they like.
    // Nothing is emailed from here — wire an email provider if you want that.
    const [invite] = await db.insert(invites).values({ email, brandId, role, invitedBy: user.id }).returning();
    revalidatePath(`/brands/${brandId}`);
    return { added: false as const, email, inviteUrl: `/signup?invite=${invite.token}` };
  });
}

export async function removeMemberAction(brandId: string, userId: string) {
  return asResult(async () => {
    await requireBrandRole(brandId, "admin");
    await db.delete(memberships).where(and(eq(memberships.brandId, brandId), eq(memberships.userId, userId)));
    revalidatePath(`/brands/${brandId}`);
  });
}

export async function setMemberRoleAction(brandId: string, userId: string, role: string) {
  return asResult(async () => {
    await requireBrandRole(brandId, "admin");
    await db.update(memberships)
      .set({ role: role as Role })
      .where(and(eq(memberships.brandId, brandId), eq(memberships.userId, userId)));
    revalidatePath(`/brands/${brandId}`);
  });
}
