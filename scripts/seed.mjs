/**
 * Optional demo data: one account, three brands, channels and a week of posts.
 * Run with `npm run seed`. Safe to skip — the app works from an empty database.
 */
import postgres from "postgres";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";

const sql = postgres(process.env.DATABASE_URL, { max: 4 });
const id = () => nanoid(16);
const EMAIL = "demo@ggsocial.app";
const PASSWORD = "demo1234";

const BRANDS = [
  { name: "Acme Robotics", color: "#6366f1", tz: "Europe/London", brief: "Technical, dry, no emoji. Always link the docs.",
    channels: [["linkedin", "Acme Robotics"], ["x", "@acmerobotics"], ["youtube", "Acme Robotics"]] },
  { name: "Harbour Coffee", color: "#f97316", tz: "Europe/London", brief: "Warm and short. Emoji fine. Never discount-led.",
    channels: [["instagram", "@harbourcoffee"], ["facebook", "Harbour Coffee"], ["tiktok", "@harbourcoffee"]] },
  { name: "Northwind Legal", color: "#0ea5e9", tz: "America/New_York", brief: "Formal. No claims without a source.",
    channels: [["linkedin", "Northwind Legal"], ["x", "@northwindlegal"]] },
];

const POSTS = [
  { title: "Series A announcement", body: "We raised $12M to put force-feedback in every warehouse arm.\n\nThe full story is on the blog.", status: "scheduled", inDays: 1, hour: 9 },
  { title: "Hiring: staff firmware engineer", body: "We are hiring a staff firmware engineer. Remote across EU/UK.", status: "in_review", inDays: 3, hour: 14 },
  { title: "New single-origin", body: "Ethiopian Guji landed this morning. Blueberry, jasmine, a bit of a show-off.", status: "scheduled", inDays: 0, hour: 8 },
  { title: "Saturday opening hours", body: "We are open 8–4 every Saturday through winter.", status: "draft", inDays: 5, hour: 10 },
  { title: "Q3 regulatory roundup", body: "Three changes to UK employment law that take effect this quarter.", status: "published", inDays: -4, hour: 11 },
];

const user = { id: id(), email: EMAIL, name: "Demo User", hash: await bcrypt.hash(PASSWORD, 12) };

const existing = await sql`select id from users where email = ${EMAIL}`;
if (existing.length) {
  console.log(`Demo account already exists: ${EMAIL} / ${PASSWORD}`);
  await sql.end();
  process.exit(0);
}

await sql`insert into users (id, email, name, password_hash) values (${user.id}, ${EMAIL}, ${user.name}, ${user.hash})`;

const brandIds = [];
for (const b of BRANDS) {
  const bid = id();
  brandIds.push(bid);
  const slug = b.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  await sql`insert into brands (id, name, slug, color, timezone, brief) values (${bid}, ${b.name}, ${slug}, ${b.color}, ${b.tz}, ${b.brief})`;
  await sql`insert into memberships (id, user_id, brand_id, role) values (${id()}, ${user.id}, ${bid}, 'owner')`;
  for (const [platform, handle] of b.channels) {
    await sql`insert into channels (id, brand_id, platform, handle, mode, status)
              values (${id()}, ${bid}, ${platform}, ${handle}, 'manual', 'connected')`;
  }
}

for (const [i, p] of POSTS.entries()) {
  const brandId = brandIds[i < 2 ? 0 : i < 4 ? 1 : 2];
  const channels = await sql`select id from channels where brand_id = ${brandId}`;
  const when = new Date();
  when.setDate(when.getDate() + p.inDays);
  when.setHours(p.hour, 0, 0, 0);
  const pid = id();

  await sql`insert into posts (id, brand_id, title, body, status, scheduled_at, published_at, created_by)
            values (${pid}, ${brandId}, ${p.title}, ${p.body}, ${p.status}, ${when},
                    ${p.status === "published" ? when : null}, ${user.id})`;

  for (const c of channels.slice(0, 2)) {
    const targetStatus =
      p.status === "published" ? "published"
      : p.status === "scheduled" ? "scheduled"
      : "pending";
    await sql`insert into post_targets (id, post_id, channel_id, status, scheduled_at, published_at)
              values (${id()}, ${pid}, ${c.id}, ${targetStatus}, ${when}, ${p.status === "published" ? when : null})`;
  }
}

console.log(`Seeded ${BRANDS.length} brands and ${POSTS.length} posts.`);
console.log(`Sign in with  ${EMAIL}  /  ${PASSWORD}`);
await sql.end();
