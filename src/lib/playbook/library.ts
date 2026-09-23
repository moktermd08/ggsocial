import type { ChecklistItem, EnforceLevel, RuleKind, RuleLimits } from "./meta";

/**
 * The master playbook: one rule per kind of content or work, each with the
 * limits the app checks by itself and the points a person or agent confirms.
 *
 * Seeded into `playbook_rules` by `code`, then edited in the app, so a change
 * to the master reaches every brand at once. `code` is permanent: it is what
 * posts carry as their format, what agents address, and what the adjustment
 * history hangs off. Retire a code and add a new one rather than renaming.
 *
 * The numbers are sensible starting points, not platform maxima. Each brand
 * can tune any of them, and the daily tuning job proposes posting times from
 * what actually performed.
 */
export type LibraryRule = {
  code: string;
  kind: RuleKind;
  name: string;
  /** When this rule is the one that applies. */
  description: string;
  /** How to do it well, in full. Shown to writers, reviewers and agents. */
  instructions: string;
  /** Empty = every platform. Formats only resolve where they exist. */
  platforms: string[];
  /** The recurring activities this rule governs, by activity code. */
  activityCodes: string[];
  enforce: EnforceLevel;
  limits: RuleLimits;
  checklist: ChecklistItem[];
};

/** Checklist points keyed `<code>-<n>`, so they stay stable across deploys. */
function points(code: string, items: (string | [string, ChecklistItem["for"]])[]): ChecklistItem[] {
  return items.map((it, i) => {
    const [text, audience] = typeof it === "string" ? [it, "all" as const] : it;
    return { id: `${code}-${i + 1}`, text, for: audience };
  });
}

const BRAND_POINTS = [
  "Sounds like the brand: voice, audience and key messages from the brand book",
  "No banned words; emoji policy followed",
  "Ends with one clear next step (comment, DM, visit, book)",
];

export const PLAYBOOK_LIBRARY: LibraryRule[] = [
  /* ============================================================= formats */
  {
    code: "post", kind: "format", name: "Feed post",
    description: "A standard post with an image or text, on any social network. The fallback when nothing more specific fits.",
    instructions: "Lead with the problem as the reader lives it: the first line is the hook and often all anyone reads. One idea per post. Use the brand's tracked link where a link belongs. Keep the title to three words — it is the label people scan in the calendar and the headline on platforms that show one.",
    platforms: [], activityCodes: ["D-01", "W-03", "W-05", "W-28", "W-25", "W-26", "W-34", "Y-07", "W-21"],
    enforce: "warn",
    limits: {
      titleRequired: true, titleMaxWords: 3, hashtagsMin: 3, hashtagsMax: 3, bodyMinChars: 80,
      mediaKind: "any", mediaMin: 1, aspectRatio: "4:5, 1:1", minWidth: 1080,
      windows: "08:00-10:00, 12:00-13:00, 18:00-20:00", days: "mon-fri", perWeek: 5,
    },
    checklist: points("post", [
      "The first line works as a hook on its own",
      ...BRAND_POINTS,
      "The image is on-brand (palette, logo usage, image style) and readable on a phone",
      ["Alt text written for the image", "all"],
      ["Facts, prices and names checked against the source", "human"],
    ]),
  },
  {
    code: "reel", kind: "format", name: "Reel",
    description: "A vertical short video on Instagram or Facebook.",
    instructions: "Hook in the first two seconds, on screen and in words. Burned-in captions: most people watch muted. One message, shown not told. The caption adds context and a question to comment on. Cover image readable in the grid.",
    platforms: ["instagram", "facebook"], activityCodes: ["2D-01", "W-33", "D-21"],
    enforce: "warn",
    limits: {
      titleRequired: true, titleMaxWords: 3, hashtagsMin: 3, hashtagsMax: 3,
      mediaKind: "video", mediaMin: 1, mediaMax: 1, aspectRatio: "9:16", minWidth: 1080, minHeight: 1920,
      videoMinSeconds: 7, videoMaxSeconds: 90,
      windows: "11:00-13:00, 19:00-22:00", days: "mon-sun", perWeek: 3,
    },
    checklist: points("reel", [
      "Hook lands in the first 2 seconds",
      "Captions burned in and spelled correctly",
      "Nothing important inside the top and bottom 250px (covered by the app UI)",
      "Audio is licensed for business use",
      "Cover image set and readable in the grid",
      ...BRAND_POINTS,
    ]),
  },
  {
    code: "story", kind: "format", name: "Story",
    description: "A 24-hour vertical story on Instagram or Facebook.",
    instructions: "Casual and in the moment: behind the scenes, a poll, a question box, a link sticker to the offer. One frame, one message. Use interactive stickers — replies are warm leads.",
    platforms: ["instagram", "facebook"], activityCodes: ["D-17", "W-07", "2D-06"],
    enforce: "block",
    limits: {
      hashtagsMax: 1, mediaKind: "any", mediaMin: 1, mediaMax: 1, aspectRatio: "9:16", minWidth: 1080, minHeight: 1920,
      videoMaxSeconds: 60, windows: "08:00-10:00, 20:00-22:00", perWeek: 7,
    },
    checklist: points("story", [
      "Uses a sticker (poll, question, quiz or link) where it fits",
      "Text sits inside the safe area, clear of the profile bar and reply box",
      "Readable in under 3 seconds",
    ]),
  },
  {
    code: "carousel", kind: "format", name: "Carousel",
    description: "Several images or a document swiped through: Instagram carousels, LinkedIn document posts.",
    instructions: "Slide one is the promise, the last slide is the call to action. One point per slide, large type, consistent layout. Number the slides when the order matters.",
    platforms: ["instagram", "linkedin", "facebook", "threads", "x"], activityCodes: ["W-04", "W-21"],
    enforce: "block",
    limits: {
      titleRequired: true, titleMaxWords: 3, hashtagsMin: 3, hashtagsMax: 3,
      mediaKind: "image", mediaMin: 3, mediaMax: 10, aspectRatio: "4:5, 1:1", minWidth: 1080,
      windows: "08:00-10:00, 17:00-19:00", days: "tue-thu", perWeek: 1,
    },
    checklist: points("carousel", [
      "Slide 1 makes a promise worth swiping for",
      "One point per slide; type readable on a phone",
      "Last slide carries the call to action",
      ...BRAND_POINTS,
    ]),
  },
  {
    code: "short", kind: "format", name: "Short video",
    description: "TikTok, YouTube Shorts and other vertical short video.",
    instructions: "Same craft as a reel: hook first, captions on, one message. Use the platform's native sounds and trends where they fit the brand. Reply to the best comment with a video.",
    platforms: ["tiktok", "youtube", "snapchat", "douyin", "kuaishou"], activityCodes: ["2D-01", "W-33"],
    enforce: "block",
    limits: {
      titleRequired: true, titleMaxWords: 3, hashtagsMin: 3, hashtagsMax: 3,
      mediaKind: "video", mediaMin: 1, mediaMax: 1, aspectRatio: "9:16", minWidth: 1080, minHeight: 1920,
      videoMinSeconds: 7, videoMaxSeconds: 60,
      windows: "12:00-14:00, 19:00-23:00", perWeek: 3,
    },
    checklist: points("short", [
      "Hook lands in the first 2 seconds",
      "Captions on",
      "Sound is licensed or from the platform's library",
      ...BRAND_POINTS,
    ]),
  },
  {
    code: "video", kind: "format", name: "Long video",
    description: "A horizontal video: YouTube uploads, Vimeo, Facebook and LinkedIn native video.",
    instructions: "A title that says what the viewer will get, with the keyword people search. Description with chapters, links and the offer. Custom thumbnail with three words at most. End screen pointing to the next video.",
    platforms: ["youtube", "vimeo", "dailymotion", "facebook", "linkedin", "rumble", "bilibili"], activityCodes: ["W-06", "W-27", "M-01"],
    enforce: "block",
    limits: {
      titleRequired: true, titleMaxWords: 10, hashtagsMin: 3, hashtagsMax: 3, bodyMinChars: 200,
      mediaKind: "video", mediaMin: 1, mediaMax: 1, aspectRatio: "16:9", minWidth: 1920, minHeight: 1080,
      videoMinSeconds: 60, windows: "15:00-18:00", days: "thu-sat", perWeek: 1,
    },
    checklist: points("video", [
      "Custom thumbnail, readable at phone size",
      "Chapters in the description",
      "End screen and cards set",
      "Link to the offer in the first two lines of the description",
      ...BRAND_POINTS,
    ]),
  },
  {
    code: "thread", kind: "format", name: "Thread or quick tip",
    description: "A text-first post or thread on X, Threads, Bluesky or Mastodon.",
    instructions: "One sharp thought per post. The first post has to earn the click to read on. End the thread with the takeaway and a question.",
    platforms: ["x", "threads", "bluesky", "mastodon", "farcaster"], activityCodes: ["2D-03", "D-19"],
    enforce: "warn",
    limits: { hashtagsMax: 2, bodyMinChars: 40, windows: "08:00-10:00, 12:00-14:00", perWeek: 4 },
    checklist: points("thread", [
      "The first post stands on its own",
      "Each post in the thread makes one point",
      ...BRAND_POINTS,
    ]),
  },
  {
    code: "article", kind: "format", name: "Article",
    description: "A long-form piece on a blog or publishing platform.",
    instructions: "A headline that promises something specific. Subheadings every few paragraphs. A real example or number in every section. End with what to do next and a link to the offer.",
    platforms: ["wordpress", "ghost", "webflow", "shopify_blog", "devto", "hashnode", "medium", "substack", "notion"],
    activityCodes: ["W-02", "M-02", "M-03"],
    enforce: "warn",
    limits: { titleRequired: true, titleMaxWords: 12, hashtagsMax: 5, bodyMinChars: 2500, mediaMin: 1, windows: "07:00-10:00", days: "tue-thu", perWeek: 1 },
    checklist: points("article", [
      "Headline promises something specific",
      "Subheadings every few paragraphs",
      "Meta description and featured image set",
      "Links checked; the call to action uses a tracked link",
      ...BRAND_POINTS,
    ]),
  },
  {
    code: "newsletter", kind: "format", name: "Newsletter",
    description: "An email to a list: beehiiv, Mailchimp, Brevo, Kit, Klaviyo and the rest.",
    instructions: "The subject line is the title: short, specific, no clickbait. One main story, one call to action. Preview text set. Send a test to yourself first.",
    platforms: ["beehiiv", "mailchimp", "brevo", "convertkit", "klaviyo", "resend", "sendgrid"], activityCodes: ["W-24", "M-24"],
    enforce: "block",
    limits: { titleRequired: true, titleMaxWords: 9, hashtagsMax: 0, bodyMinChars: 300, windows: "07:00-09:00", days: "tue-thu", perWeek: 1 },
    checklist: points("newsletter", [
      "Preview text set",
      "One main call to action, with a tracked link",
      ["Test email sent and checked on a phone", "human"],
      "Unsubscribe link present",
    ]),
  },

  /* ========================================================== activities */
  {
    code: "reply", kind: "activity", name: "Reply to a comment",
    description: "Answering comments on our own posts, videos, reels and stories.",
    instructions: "Reply within the brand's reply SLA. Answer the actual point, add something, and ask one follow-up question so the thread keeps going. Never copy-paste the same reply twice. Move anything sensitive or sales-related to DM.",
    platforms: [], activityCodes: ["D-02", "D-04", "D-10", "D-20", "D-22", "D-25", "W-18"],
    enforce: "warn", limits: {},
    checklist: points("reply", [
      "Every comment answered within the reply SLA",
      "Each reply adds something and ends with a question where it fits",
      "No two replies are identical",
      "Complaints, prices and personal details moved to DM",
      ["Spam and abuse hidden or reported, not argued with", "all"],
    ]),
  },
  {
    code: "dm", kind: "activity", name: "Private message",
    description: "DMs, page messages, WhatsApp, Telegram and messaging-app enquiries, and outbound value-first DMs.",
    instructions: "Answer every message. Qualify buying intent with one question (need, timing, budget) and log real leads. Outbound: lead with something useful for them, never a pitch in the first message.",
    platforms: [], activityCodes: ["D-03", "D-08", "D-09", "D-26", "D-23", "W-08", "W-09", "2D-04"],
    enforce: "warn", limits: {},
    checklist: points("dm", [
      "Every inbound message answered",
      "Buying intent qualified and logged as a lead",
      "Outbound messages personalised; no pitch in the first message",
      ["Anything a person has to promise (price, deadline, refund) handed to a person", "agent"],
    ]),
  },
  {
    code: "prospect-comment", kind: "activity", name: "Comment on others' posts",
    description: "Comments on prospects', industry voices', customers' and partners' posts, and in groups and forums.",
    instructions: "Two sentences or more, with a point of view or an example. Never a link, never a pitch. Pick posts from the last 24 hours so the comment gets seen.",
    platforms: [], activityCodes: ["D-05", "D-06", "D-11", "D-15", "D-14", "D-24", "2D-05", "2D-07", "W-10", "W-31"],
    enforce: "warn", limits: {},
    checklist: points("prospect-comment", [
      "At least two sentences with a point of view",
      "No links and no pitch",
      "On posts from the last 24 hours",
    ]),
  },
  {
    code: "review-reply", kind: "activity", name: "Answer a review",
    description: "Replies to reviews on Google Business, Trustpilot, G2, Clutch, Yelp and the rest.",
    instructions: "Reply to every review within 48 hours. Thank by name and mention something specific. For negative reviews: acknowledge, do not argue, and take it offline with a contact.",
    platforms: [], activityCodes: ["D-13", "M-08"],
    enforce: "warn", limits: {},
    checklist: points("review-reply", [
      "Answered within 48 hours",
      "Thanks by name and mentions something specific",
      "Negative reviews taken offline, never argued in public",
      ["Anything admitting fault checked by a person first", "agent"],
    ]),
  },
  {
    code: "connection", kind: "activity", name: "Connection or follow request",
    description: "Connection requests, follows and invitations to people who fit the ideal customer.",
    instructions: "Only people who match the ideal-customer profile. A short personal note that shows you looked at their profile. No pitch.",
    platforms: [], activityCodes: ["D-07", "D-18", "2D-02", "W-23", "W-29", "M-10", "M-11", "M-25", "Q-08", "H-08"],
    enforce: "warn", limits: {},
    checklist: points("connection", [
      "Each person matches the ideal-customer profile",
      "A personal note, no pitch",
    ]),
  },
];

/*
 * Products and services, profiles, ads, and the work behind the scenes. These
 * come after the originals so their sort order never pushes an older rule down.
 */
PLAYBOOK_LIBRARY.push(
  {
    code: "listing", kind: "format", name: "Product or service listing",
    description: "A product, service or portfolio item on a marketplace, shop or directory: Etsy, eBay, Daraz, Gumroad, Facebook Marketplace and the rest.",
    instructions: "Title leads with what it is and the words buyers search for, not the brand name. The first two lines answer: what it is, who it is for, and the price or starting price. Then what is included, sizes or variants, delivery or turnaround, and how to buy or book. Real photos first — the product on its own on a plain background, then in use, then detail. Every listing links back to the brand's own page with a tracked link where the platform allows.",
    platforms: ["facebook_marketplace", "etsy", "ebay", "amazon_posts", "olx", "craigslist", "gumtree", "bikroy", "daraz", "gumroad"],
    activityCodes: ["M-07", "M-33", "Q-16"],
    enforce: "warn",
    limits: {
      titleRequired: true, titleMaxWords: 12, hashtagsMax: 0, bodyMinChars: 300,
      mediaKind: "image", mediaMin: 3, mediaMax: 10, aspectRatio: "1:1, 4:5", minWidth: 1000,
    },
    checklist: points("listing", [
      "Price (or starting price) and currency are right and match the website",
      "What's included, variants and sizes are listed",
      "Delivery, turnaround or booking terms are stated",
      "Photos are of the real product or real work — no stock images passed off as ours",
      "Category and attributes are filled in on the platform",
      "Contact details and business name match every other profile",
      ["Prices, stock and claims confirmed with the owner before it goes live", "human"],
    ]),
  },
  {
    code: "profile-info", kind: "profile", name: "Profile information",
    description: "Bios, About sections, contact details, links, categories, pinned posts and handles on every platform.",
    instructions: "Every profile answers three things in the first line: what the brand does, for whom, and what to do next. Name, handle, category, address, phone, email and opening hours are identical everywhere (the brand book is the source). The link in bio is a tracked link to a page that exists. The pinned or featured post is the current best introduction or offer. Anything that changes — a service, a price, an address — is changed on every profile the same day.",
    platforms: [],
    activityCodes: ["W-22", "M-04", "M-06", "M-27", "M-29", "M-31", "Q-03", "Q-04", "Q-19", "H-01", "H-09", "Y-04", "Y-10"],
    enforce: "warn",
    limits: {},
    checklist: points("profile-info", [
      "First line of the bio says what we do, for whom, and the next step",
      "Name, handle, category and contact details match the brand book exactly",
      "Address, phone and opening hours are identical on every listing",
      "Every link opens a live page and uses a tracked link",
      "Pinned or featured post is current",
      "Services and products listed match what we sell today",
      "Legal details (company name, privacy link, terms) are present where the platform asks",
      ["Verification, ownership and recovery details confirmed by the owner", "human"],
    ]),
  },
  {
    code: "profile-picture", kind: "profile", name: "Profile picture",
    description: "The avatar or logo mark on every profile.",
    instructions: "Use the brand's square mark, not the full wordmark: it is shown as a small circle. Keep the mark inside the middle 70% so the circle crop never clips it. Same image on every platform, so people recognise the brand at a glance. Export at 1080×1080 and let each platform shrink it.",
    platforms: [], activityCodes: ["H-02"],
    enforce: "warn",
    limits: { mediaKind: "image", mediaMin: 1, mediaMax: 1, aspectRatio: "1:1", minWidth: 400, minHeight: 400 },
    checklist: points("profile-picture", [
      "The mark is readable at 40px",
      "Nothing important is clipped by the circle crop",
      "Same picture on every platform",
      "Follows the brand book's logo usage and colours",
    ]),
  },
  {
    code: "cover-graphics", kind: "profile", name: "Covers, banners & highlight covers",
    description: "Cover photos, channel banners, header images, story highlight covers, board covers and thumbnails that sit on the profile.",
    instructions: "One message per banner: what the brand does, or the current offer, plus one call to action that matches the profile button. Keep text and logos in the centre safe area — every platform crops differently on phone and desktop. Sizes: LinkedIn page 1128×191; X header 1500×500; Facebook cover 1640×624 (safe 1640×856 on mobile); YouTube channel art 2560×1440 with text inside the central 1546×423; Pinterest board cover 1000×1500; Instagram highlight covers 1080×1920 with the icon in the central circle. Highlight covers share one icon style and one colour palette.",
    platforms: [], activityCodes: ["M-05", "M-28", "M-30", "M-32", "W-32", "Q-13"],
    enforce: "warn",
    limits: { mediaKind: "image", mediaMin: 1, mediaMax: 1, minWidth: 1000 },
    checklist: points("cover-graphics", [
      "Made at the platform's size (see the instructions) and checked on a phone and a desktop",
      "Text and logo sit inside the safe area",
      "One message and a call to action that matches the profile button",
      "Current: no expired offers, old dates or retired products",
      "Brand palette, fonts and image style from the brand book",
      "Highlight covers share one icon style",
    ]),
  },
  {
    code: "ads", kind: "ads", name: "Paid ad",
    description: "Any ad or boosted post on Meta, LinkedIn, TikTok, X, YouTube, Pinterest, Reddit or Google.",
    instructions: "Write down the objective, the one number that says it worked (cost per lead, per sale, per click) and the audience before making anything. The headline is short; the primary text makes its point in the first 125 characters, before the \"more\" cut. Every ad links through a tracked link to a landing page that matches what the ad promised. Set a daily cap and an end date. Check spend and results within 24 hours of launch, then weekly: pause anything spending past the agreed kill number with nothing to show. Answer comments on ads like any other post — they are public.",
    platforms: [], activityCodes: ["Q-18", "W-35", "M-34"],
    enforce: "warn",
    limits: {
      titleRequired: true, titleMaxWords: 6, hashtagsMax: 0, bodyMaxChars: 125,
      mediaKind: "any", mediaMin: 1, aspectRatio: "1:1, 4:5, 9:16", minWidth: 1080,
    },
    checklist: points("ads", [
      "Objective, success number and audience written down",
      "Budget, daily cap and end date approved by a person",
      "Tracked link with UTM; landing page loads and matches the ad",
      "Special ad category or disclosure declared where required (housing, jobs, credit, politics, branded content)",
      "Creative follows the platform's ad policy and the brand book",
      "Kill rule agreed: pause when cost passes the limit with no result",
      "Spend and results checked within 24 hours of launch",
      ["Launch, budget changes and billing are done by a person", "human"],
      ["Agents draft ads and report on them; never launch, raise spend or change billing", "agent"],
    ]),
  },
  {
    code: "review-request", kind: "activity", name: "Ask for or give a review",
    description: "Asking happy customers for reviews, testimonials and recommendations, and giving them to partners.",
    instructions: "Ask within a week of a good result, by name, with one direct link to the review page. Ask once and follow up once — never offer anything in return for a review, and never ask only the people you expect to be positive on platforms that forbid it. Thank everyone who leaves one. When giving a review, be specific about what the partner did.",
    platforms: [], activityCodes: ["W-13", "W-14", "M-09", "M-26", "Q-05", "H-06", "Y-06", "Y-09"],
    enforce: "warn", limits: {},
    checklist: points("review-request", [
      "Asked within a week of a good result, personally",
      "One direct link to the review page",
      "Nothing offered in exchange for a review",
      "At most one follow-up",
      "Every new review thanked",
      ["Testimonials used in content have the customer's written permission", "human"],
    ]),
  },
  {
    code: "community", kind: "activity", name: "Groups & communities",
    description: "Joining, posting in, hosting and moderating groups, subreddits, forums and the brand's own community.",
    instructions: "Read each group's rules before the first post and follow them to the letter. Give far more than you ask: most contributions are answers and useful posts with no link. Post as a person with a real point of view. In the brand's own community, welcome newcomers, answer within a day, and remove spam and bots quickly.",
    platforms: [], activityCodes: ["W-11", "W-12", "W-30", "M-12", "M-13", "M-22", "Q-09"],
    enforce: "warn", limits: {},
    checklist: points("community", [
      "The group's rules were read and followed",
      "The post is useful on its own; a link only where the rules allow",
      "No copy-pasting the same post across groups",
      "Replies to comments on it within a day",
      "Spam and fake accounts removed or reported",
    ]),
  },
  {
    code: "leads", kind: "activity", name: "Leads & offers",
    description: "Logging, reviewing and handing off leads from social, re-engaging past leads, and inviting followers to offers and events.",
    instructions: "Every enquiry is logged the same day with the platform, the post it came from, what they need and the next step. A lead with no next step is not a lead. Hand-offs name who owns it and by when. Offers and invitations go to people who have engaged, with one clear reason to say yes now.",
    platforms: [], activityCodes: ["D-12", "W-17", "M-17", "M-23", "Q-07", "Q-15"],
    enforce: "warn", limits: {},
    checklist: points("leads", [
      "Logged the same day, with platform and source post",
      "Need, timing and next step recorded",
      "Owner and due date set on every hand-off",
      "Offers go only to people who engaged, with one clear reason to act",
      ["Personal data kept in the CRM, not in chats or notes", "all"],
    ]),
  },
  {
    code: "planning", kind: "operations", name: "Content planning",
    description: "Weekly scheduling, quarterly pillars and campaigns, the annual calendar, repurposing, audits, content kits and experiments.",
    instructions: "Plan from the goals and last period's learnings, not from a blank page. Each week mixes the pillars (roughly: teach, prove, show the people, sell), and every planned post links to an idea in the content plan. Schedule a week ahead so there is time for approval. Reuse what worked in a new format before inventing something new. Try one new format or platform at a time, with a number that says whether it worked.",
    platforms: [], activityCodes: ["W-01", "W-19", "M-20", "M-21", "Q-02", "Q-06", "Q-14", "Q-17", "H-05", "Y-03"],
    enforce: "warn", limits: {},
    checklist: points("planning", [
      "Next week is scheduled before this week ends",
      "Every planned post links to an idea and a pillar",
      "The pillar mix is balanced — not all selling",
      "Last period's best post is being reused in another format",
      "Experiments have a success number set in advance",
    ]),
  },
  {
    code: "reporting", kind: "operations", name: "Reports & reviews",
    description: "Daily glances, weekly and monthly reports, quarterly and annual reviews, competitor watching, audience and hashtag analysis, and the playbook's daily review.",
    instructions: "Every report compares against the goal and the last period, not just this period's numbers. Lead with what changed and why, then three actions. Use numbers from the platform or ggsocial, with the date range stated. Record learnings in the content plan so they change what gets made. Competitors are watched for what works, never copied.",
    platforms: [], activityCodes: ["D-16", "D-27", "W-15", "W-16", "W-20", "M-14", "M-15", "M-16", "Q-01", "Q-11", "Q-12", "H-03", "Y-01", "Y-02", "Y-11"],
    enforce: "warn", limits: {},
    checklist: points("reporting", [
      "Compared with the goal and the previous period",
      "Date range and source of every number stated",
      "Leads with what changed and why",
      "Ends with no more than three actions, each with an owner",
      "Learnings written into the content plan",
    ]),
  },
  {
    code: "accounts", kind: "operations", name: "Access & security",
    description: "Checking pages are live, who has access, connected channels, security reviews, tools and subscriptions, backups and ownership.",
    instructions: "Every account is owned by the business, not a person, and has at least two admins. Two-factor authentication is on everywhere; passwords live in a password manager, never in chats. Anyone who leaves loses access the same day. Tokens and connections in ggsocial are checked before they expire. Content and analytics are exported and backed up twice a year.",
    platforms: [], activityCodes: ["D-00", "M-18", "M-19", "Q-10", "H-04", "H-07", "Y-05", "Y-08"],
    enforce: "warn", limits: {},
    checklist: points("accounts", [
      "Every page loads and is ours",
      "At least two admins on every account; owner is the business",
      "Two-factor authentication on everywhere",
      "Leavers removed; no shared passwords",
      "Connected channels in ggsocial are healthy and not near expiry",
      ["Recovery email, phone and billing owner confirmed", "human"],
      ["Agents never change passwords, admins or billing — they report what needs doing", "agent"],
    ]),
  },
);

export const PLAYBOOK_CODES = new Set(PLAYBOOK_LIBRARY.map((r) => r.code));
