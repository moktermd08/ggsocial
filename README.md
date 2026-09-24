# ggsocial

One desk for every brand you run. Plan, approve, schedule and publish social content
for ten companies without ten browser tabs and ten logins.

Built for the way agency-style work actually goes: content is written once per idea,
fanned out to the channels that should carry it, tuned per platform, approved by
whoever signs it off, and then either published automatically or handed to a person
with the copy and files ready to paste.

## What it does

- **Brands** — one per company or project. Its own channels, media, calendar, team and timezone.
- **Composer** — write base copy once, override it per channel, with live character counts
  and per-platform rules (Reddit needs a title and a subreddit, YouTube needs a title,
  Instagram needs media, X caps at 280 and can thread on blank lines).
- **Calendar** — every brand on one month grid, colour-coded, drag a post to move it.
- **Approvals** — draft → needs approval → approved → scheduled, with comments and
  change requests. Approver role can sign off without being able to edit.
- **Playbook** — the master instructions for every format (post, reel, story, carousel,
  short, video, thread, article, newsletter) and every kind of engagement work (replies,
  DMs, comments, reviews). Each rule has limits the app checks by itself — title words,
  hashtag count, copy length, media type, aspect ratio, size and length, posting windows —
  and a checklist people and agents confirm. The composer checks as you type, Claude
  drafts to it, scheduling and approval refuse a broken "must", and each activity shows
  the rule it follows. Every brand follows the master and can tune any limit; editors and
  agents suggest, approvers decide, and a daily job suggests posting times from what
  performed. Every change is logged with who, why and the numbers behind it.
- **Agents** — a crew per brand that does the hourly work so people only set guidelines
  and review. The *content writer* keeps the calendar full from the content plan, books
  each post into an open slot and hands it to the *publish a planned post* workflow, then
  revises anything a reviewer sends back using their note. The *community manager* drafts
  replies to new comments, messages, mentions and reviews, sets tone and priority, and
  flags anything a person must decide. The *performance analyst* reads yesterday's posts
  every morning and ticks the daily check with its note. Each agent is switched on per
  brand and reads that brand's guidelines on every run. Every run is logged with what it
  made, what to check and what it cost. Needs `ANTHROPIC_API_KEY`.
- **Workflows and the Review inbox** — each kind of work runs as a workflow of steps, done
  by an agent, a tool or a person. After an agent's step the run stops for a person only
  where that step's review is on — and review is on for every step until the brand's owner
  switches it off, with a reason that is kept in the log. Safety stops pause a run whatever
  the setting: a broken playbook "must", copy that mentions prices, refunds, legal or health
  matters or apologises for the brand, and a step that keeps failing. Everything waiting on
  a person — reviews, safety stops, and steps only a person can do, like attaching media or
  posting on a manual channel — lands in one Review inbox. Approve, send back with a note
  (the agent redoes it) or stop the run. Approving an agent's post on its own page moves its
  run on too.
- **Publish queue** — anything due on a manual channel, with copy buttons, the media to
  download and platform-specific steps. Tick it off and it is marked published.
- **Channels** — 109 platforms, each either *manual* (works immediately) or *live*
  (the app calls the platform API itself). Searchable, grouped by category.
- **Analytics** — what went out, where, and whatever metrics the platform hands back.

## Channels

**109 platforms in 11 categories. 45 publish by themselves; the other 64 have no write
API for organic content, so ggsocial composes, validates, schedules and queues them with
copy-ready blocks for a person to post.**

| Category | Auto-publishing | Manual-only |
| --- | --- | --- |
| Social networks | Instagram, Facebook Pages, LinkedIn, X, Threads, Pinterest, Reddit, Bluesky, Mastodon, Tumblr, VK, Farcaster | Snapchat, Nextdoor, Facebook Groups, Instagram Broadcast |
| Messaging & broadcast | Telegram, WhatsApp Business, Messenger, Discord, Slack, LINE, Viber | WhatsApp Channels |
| Video, audio & live | YouTube, TikTok, Vimeo, Dailymotion, Twitch | YouTube Community, Rumble, Kick, SoundCloud, Spotify for Creators, Apple Podcasts, Restream |
| Publishing & blogs | WordPress, Ghost, Webflow, Shopify Blog, DEV.to, Hashnode, Notion | Medium, Substack, SlideShare, Issuu, Flipboard |
| Communities & forums | Discourse, Lemmy | Quora, Hacker News, Indie Hackers, Skool, Circle, Mighty Networks |
| Email, SMS & push | beehiiv, Mailchimp, Brevo, Kit (ConvertKit), Klaviyo, Resend, SendGrid, Twilio SMS, OneSignal | — |
| Local, maps & reviews | Google Business Profile | Apple Business Connect, Bing Places, Yelp, Tripadvisor, Trustpilot, G2, Capterra, Clutch |
| Marketplaces & classifieds | — | Facebook Marketplace, Etsy, eBay, Amazon Posts, OLX, Craigslist, Gumtree, Bikroy, Daraz, Gumroad |
| Developer, design & directories | GitHub | Product Hunt, Behance, Dribbble, Figma Community, AlternativeTo, BetaList, SaaSHub, Crunchbase, Wellfound, Upwork, Fiverr, Glassdoor |
| Regional | — | WeChat, Weibo, Douyin, Xiaohongshu, Kuaishou, Bilibili, Zhihu, Naver, KakaoTalk, Zalo, ShareChat |
| Automation & custom | Webhook / Zapier | — |

A manual-only channel is not a stub: it gets the same composer validation, calendar slot,
approval flow and publish-queue checklist — it just ends with a person clicking publish,
because the platform offers no API to do it for them.

## Running it locally

```bash
cp .env.example .env.local   # then fill in DATABASE_URL and APP_SECRET
npm install
npm run db:push              # creates the tables
npm run seed                 # optional demo data
npm run dev
```

Open http://localhost:3000 and create an account (or sign in with the seeded
`demo@ggsocial.app` / `demo1234`).

Scheduled posts are dispatched by a scheduler tick, not by the web request. In
development, run this in a second terminal:

```bash
npm run scheduler
```

## Environment

| Variable | What it is |
| --- | --- |
| `DATABASE_URL` | Postgres connection string. |
| `APP_SECRET` | 32+ random characters. Signs sessions and encrypts stored platform tokens. Changing it logs everyone out and invalidates saved credentials. |
| `CRON_SECRET` | Bearer token the `/api/cron/publish` endpoint requires. |
| `APP_URL` | Public base URL. **Platform APIs fetch media from here**, so in production it must be reachable from the internet. |
| `MEDIA_DRIVER` | `local` (default, writes to `.data/uploads`) or `s3`. |
| `S3_BUCKET`, `S3_REGION`, `S3_PUBLIC_BASE` | Only for `MEDIA_DRIVER=s3`. |
| `CANVA_CLIENT_ID`, `CANVA_CLIENT_SECRET` | Optional. Enables importing Canva designs into Media. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Optional. Enables importing from Google Photos into Media. |
| `ANTHROPIC_API_KEY` | Optional. Enables drafting with Claude and the brand agents, which run from `/api/cron/agents` every five minutes (the scheduler and `vercel.json` both call it). |
| `CLAUDE_WRITING_MODEL`, `CLAUDE_ANALYSIS_MODEL` | Optional. The model that writes posts and replies, and the one that writes the analyst's reports. Both default to `claude-sonnet-5`; set `claude-opus-5` to trade cost for a bigger model. |

## Media sources: Canva and Google Photos

Each person connects their own account from the **Media** page. After that, every
brand library has a **Canva** / **Google Photos** button. The file is copied into
the brand's storage, so a post never depends on the outside link staying valid.

**Canva** ([Connect API](https://www.canva.dev/docs/connect/)):

1. Create an integration at canva.com/developers/integrations.
2. Scopes: `design:meta:read`, `design:content:read`, `profile:read`.
3. Authorized redirect: `APP_URL/api/integrations/canva/callback`. Canva rejects
   `localhost`, so for local work set `APP_URL=http://127.0.0.1:3000` and open the app there.
4. Copy the client ID and secret into `CANVA_CLIENT_ID` / `CANVA_CLIENT_SECRET`.

Designs export as PNG, JPG or PDF. A multi-page design becomes one file per page.
Each imported file keeps an "edit in Canva" link.

**Google Photos** ([Picker API](https://developers.google.com/photos/picker)):

1. In Google Cloud, enable the **Google Photos Picker API**.
2. Create an OAuth client of type *Web application* with the redirect
   `APP_URL/api/integrations/google_photos/callback`.
3. On the consent screen, add the scope `…/auth/photospicker.mediaitems.readonly`,
   and add yourself as a test user until the app is verified.
4. Copy the client ID and secret into `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.

Since 2025, Google no longer lets apps browse a whole Photos library. Instead,
clicking the button opens Google's own picker in a new tab, and only the photos
and videos picked there are imported.

## Deploying

Vercel plus any hosted Postgres (Neon, Supabase, RDS) works out of the box:

1. Push the repo, import it into Vercel.
2. Set the environment variables above. Use `MEDIA_DRIVER=s3` — serverless filesystems
   are wiped between invocations, so local uploads will not survive.
3. `vercel.json` already registers a cron that hits `/api/cron/publish` every five
   minutes. Vercel sends `Authorization: Bearer $CRON_SECRET` automatically.
4. Run `npm run db:push` once against the production database.

Anywhere else: any Node host works — just make sure something pings
`/api/cron/publish` on a schedule.

## Manual vs live channels

Every channel starts in **manual** mode and is useful immediately: scheduled posts land
in the publish queue at the right time with the copy, the first comment, the files and
the steps for that platform.

**Live** mode means the app publishes by itself. That needs credentials from the
platform, and most platforms gate posting behind their own app review:

| Platform | What you need | Review? |
| --- | --- | --- |
| Instagram | Meta app, `instagram_content_publish`, IG Business account linked to a Page | yes |
| Facebook | Meta app, `pages_manage_posts`, long-lived Page token | yes |
| Threads | Meta app with `threads_content_publish` | yes |
| LinkedIn | Community Management API (`w_organization_social`) | yes, slowest |
| X | API Basic tier or above, OAuth 2.0 with `tweet.write` | no, but paid |
| TikTok | Content Posting API, `video.publish`, audited app | yes |
| YouTube | Google Cloud project, `youtube.upload` (restricted scope) | yes |
| Pinterest | Pinterest app; trial access works on your own account | for standard access |
| Reddit | Script/web app at reddit.com/prefs/apps, `submit` scope | no |
| Telegram | A bot from @BotFather, added to the channel as admin | no |
| Bluesky | An App Password from account settings | no |
| Mastodon | An application token from your instance | no |
| Discord | A channel webhook URL | no |
| Slack | Bot token with `chat:write` | no |
| WhatsApp Business | Meta app + business verification + approved templates | verification |
| Google Business Profile | Business Profile API access in Google Cloud | yes, days |
| WordPress / Ghost / Webflow / Shopify | An application password or admin API key | no |
| DEV.to / Hashnode / Notion / GitHub | A personal API token | no |
| Mailchimp / Brevo / Kit / Klaviyo / Resend / SendGrid | An API key | no |
| Twilio SMS / OneSignal | Account SID + token, or REST key + App ID | no |
| Webhook / Zapier | Any https endpoint | no |

Platforms needing more than a token (Twitch's client id, Twilio's Account SID, WhatsApp's
Phone Number ID, Farcaster's signer UUID…) declare those fields themselves, and the
Connect form renders them.

To connect one: **Channels → Connect**, paste the access token and the account id.
Tokens are encrypted with `APP_SECRET` before they are stored and are never sent back
to the browser. Switch a channel back to manual at any time — nothing else changes.

Adding platform 110 means one file in `src/lib/platforms/adapters/` implementing the
`Platform` contract, and one line in the registry. Everything else — composer fields,
validation, queue steps, calendar, filters — is driven off that contract. Channels with no
write API skip the file entirely: add a row to `adapters/_catalog.ts` and the
`manualPlatform()` factory builds the rest. The registry is typed
`Record<PlatformId, Platform>`, so a missing adapter is a compile error, not a runtime one.

## Layout

```
src/
  app/(app)/          dashboard, calendar, posts, queue, library, channels, analytics, brands
  app/api/cron/       the scheduler endpoint
  components/         composer, calendar grid, queue cards, channel manager
  lib/db/             drizzle schema + client
  lib/platforms/      the platform contract, one adapter per network, validation
  lib/auth/           sessions, password hashing, role checks
  server/             queries, publish engine, server actions
```

## Roles

`owner` (everything, can archive the brand) · `admin` (channels, team, content) ·
`editor` (write, schedule, publish) · `approver` (review only, cannot edit) · `viewer` (read-only).

Roles are per brand — someone can be an editor on one company and a viewer on another.
Every server action re-checks the role; the UI hiding a button is not the security boundary.
