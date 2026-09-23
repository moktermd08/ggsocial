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
    platforms: [], activityCodes: ["D-01", "W-03", "W-05", "W-28", "W-25"],
    enforce: "block",
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
    enforce: "block",
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
    platforms: [], activityCodes: ["D-02", "D-04", "D-20", "D-22", "D-25", "W-18"],
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
    platforms: [], activityCodes: ["D-05", "D-06", "D-15", "D-14", "D-24", "2D-05", "2D-07", "W-10", "W-31"],
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
    platforms: [], activityCodes: ["D-07", "D-18", "W-23", "W-29", "M-10"],
    enforce: "warn", limits: {},
    checklist: points("connection", [
      "Each person matches the ideal-customer profile",
      "A personal note, no pitch",
    ]),
  },
];

export const PLAYBOOK_CODES = new Set(PLAYBOOK_LIBRARY.map((r) => r.code));
