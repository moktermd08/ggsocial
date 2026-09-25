import type { RuleExample } from "./meta";

/**
 * The master playbook's examples: one or two pieces of work per rule that
 * show the standard. Seeded into each built-in rule once, then edited in the
 * app, where each brand adds its own real work on top.
 *
 * Every example is for Fieldwork, a made-up job-scheduling app for UK
 * plumbing and electrical firms, so nobody mistakes a detail in one for a
 * real brand's fact. What is worth copying is the shape: the hook, the order,
 * the length, the one next step. Ids are `<code>-ex-<n>`, stable across
 * deploys.
 */
type Ex = [title: string, text: string, why: string];

const EXAMPLES: Record<string, Ex[]> = {
  /* ------------------------------------------------------------- formats */
  post: [
    ["LinkedIn post that leads with the reader's problem (fictional brand)",
      "Your best engineer spent 40 minutes yesterday driving to a job that was cancelled at 8am.\n\nNobody told him, because the cancellation came in by text to the office phone.\n\nFieldwork sends every change straight to the engineer's phone the moment the office logs it. Firms using it tell us they win back about a day a week across a team of six.\n\nWhat's the most expensive wasted trip your team made this month?\n\n#FieldService #Plumbing #SmallBusiness",
      "First line is a scene the reader has lived. One concrete number, one proof, one question to reply to. Three hashtags at the end."],
    ["Image for a feed post (layout)",
      "4:5, 1080×1350. Brand background colour. Headline in the heading typeface, top third: \"40 minutes. Wasted.\" Below it a real photo of a van on a driveway, cut into a rounded frame. Icon mark bottom-right with clear space. No more than 8 words on the image.",
      "Readable at thumbnail size, one idea, the brand kit and nothing else."],
  ],
  reel: [
    ["30-second reel, shot list (fictional brand)",
      "0–2s: Close-up of a phone buzzing on a van dashboard. On-screen text: \"Job cancelled. Again.\"\n2–8s: Engineer shrugs to camera: \"Found out when I got there.\"\n8–20s: Screen recording: office moves the job, the engineer's phone updates in real time.\n20–27s: Same engineer, next job, thumbs up.\n27–30s: End card with logo and \"Try it free for 14 days\".\nCaptions on throughout; trending sound at low volume under the voice.",
      "The hook works with the sound off, the product appears by second 8, and it ends on one next step."],
  ],
  story: [
    ["Poll story (fictional brand)",
      "9:16. Plain brand-colour background, heading typeface: \"How do your engineers hear about job changes?\" Poll sticker: \"Text from the office\" / \"They don't 😬\". Small logo top-left.",
      "One frame, one question, an interactive sticker. Every vote is a warm lead to follow up."],
  ],
  carousel: [
    ["5-slide carousel (fictional brand)",
      "1: \"5 signs your job board is costing you money\" (big type, brand colour)\n2: \"Engineers call the office to ask where to go next\"\n3: \"Jobs get double-booked on Mondays\"\n4: \"Customers ring to ask 'is he still coming?'\"\n5: \"Paper timesheets on Fridays\"\n6: \"Fix all five in an afternoon. Link in bio.\"",
      "Slide 1 promises something worth swiping for, one point per slide, and the call to action is on the last slide."],
  ],
  short: [
    ["TikTok / Shorts, 20 seconds (fictional brand)",
      "Hook on screen in second 1: \"POV: the office forgot to tell you the job moved\". Engineer standing at a locked door, deadpan. Cut to the phone updating. Text: \"Not anymore.\" Logo sting in the last second. Native trending sound, captions on.",
      "Relatable in one second, the product is the punchline, and it uses the platform's own sound."],
  ],
  video: [
    ["YouTube video: title, description and chapters (fictional brand)",
      "Title: How a 6-person plumbing firm stopped losing a day a week\nDescription: Try Fieldwork free for 14 days: [tracked link]\nWe followed Dan's team for a week to see where the time went, and what changed when job updates went straight to their phones.\n00:00 The wasted trips\n01:40 Where the time really goes\n04:10 The fix\n07:30 What it saved\nThumbnail: Dan's face, surprised, with \"1 DAY A WEEK\" in the heading typeface.",
      "A specific title with a result, the link in the first line, chapters, and a thumbnail readable on a phone."],
  ],
  thread: [
    ["X thread (fictional brand)",
      "1/ We looked at 1,200 cancelled jobs from small trade firms. 71% were cancelled before 9am, and the engineer found out on the doorstep.\n2/ The fix isn't a better office. It's getting the change to the engineer's phone the second it's logged.\n3/ That's what Fieldwork does. Free for 14 days: [tracked link]",
      "The first post stands on its own with a number; each post makes one point; the link comes last."],
  ],
  article: [
    ["Blog article outline (fictional brand)",
      "Headline: The real cost of a cancelled job (and how to stop paying it)\nMeta description: Cancelled jobs cost small trade firms about a day a week. Here's where the time goes and three ways to win it back.\nH2 Where the time goes · H2 The three fixes · H2 What it looks like in a week · H2 Try it\nOpens with a real story, uses one table of numbers, ends with a tracked link to the free trial.",
      "A headline that promises something specific, scannable subheadings, and one call to action."],
  ],
  newsletter: [
    ["Monthly newsletter (fictional brand)",
      "Subject: The 8am cancellation problem\nPreview: And the 2-minute fix our customers use\n\nHi Sam,\n\nOne story: how Dan's team won back a day a week (3 short paragraphs).\nOne tip: turn on job-change alerts (with a screenshot).\nOne link: the free cancelled-jobs checklist [tracked link].\n\nReply to this email; a real person reads every one.",
      "One story, one tip, one link. The subject and preview work as a pair, and replies are invited."],
  ],
  listing: [
    ["Marketplace listing (fictional brand)",
      "Title: Fieldwork job scheduling for plumbing & electrical firms, 1–25 engineers\nPrice: from £29 a month per engineer, billed monthly\nIncluded: live job board, engineer app (iOS and Android), customer text alerts, timesheets\nSet-up: same day, by video call\nPhotos: the job board on a laptop, the engineer app in a real van, the customer alert on a phone. All real screenshots, no stock.",
      "Price, what's included, set-up terms and real photos. Name and contact details match every other profile."],
  ],
  /* ---------------------------------------------------------- activities */
  reply: [
    ["Reply to a question in the comments (fictional brand)",
      "Comment: \"Does it work if half my team are subcontractors?\"\nReply: \"It does, Sarah. Subcontractors get the same engineer app, and you choose which jobs they can see. Happy to show you in 10 minutes if that's useful 👉 [booking link]\"",
      "Uses their name, answers the question in the first sentence, and offers one easy next step."],
    ["Reply to a complaint (fictional brand)",
      "Comment: \"App crashed twice this morning.\"\nReply: \"Sorry, Mike, that's not good enough on a working morning. We've found the fault and a fix went out at 10:40. I've sent you a DM so we can check your team is back up.\"",
      "Owns it, says what was done and when, and moves the detail to private."],
  ],
  dm: [
    ["Answer to an enquiry DM (fictional brand)",
      "\"Hi Priya, thanks for getting in touch. Yes, Fieldwork works for teams of 3. Most firms your size are set up in an afternoon. Would a 15-minute call tomorrow or Thursday suit? Here's my calendar: [booking link]\"",
      "Answers fast, says yes to the real question, and gives two times plus a link."],
  ],
  "prospect-comment": [
    ["Comment on a prospect's post (fictional brand)",
      "Post: a plumbing firm owner sharing a photo of their new van.\nComment: \"That's a proper upgrade 👏 Is the racking custom or off the shelf?\"",
      "Short, positive, about them, not us. No pitch or link, and it ends in a simple question."],
  ],
  "review-reply": [
    ["Reply to a 5-star review (fictional brand)",
      "\"Thank you, Tom. Really glad the engineer alerts are saving your team those wasted trips. We'll pass your note to Aisha, who set you up.\"",
      "Names the specific thing they praised and the person who helped. Short, and no sales pitch."],
    ["Reply to a 2-star review (fictional brand)",
      "\"Sorry, Jen. A week to fix timesheet exports is too long, and you were right to call it out. It's fixed now, and we've changed how we handle export bugs so it can't sit that long again. I'd like to hear how it's going: support@fieldwork.example reaches me directly.\"",
      "Agrees where they're right, says what changed, and gives a direct contact. Stays calm and public."],
  ],
  connection: [
    ["LinkedIn connection note (fictional brand)",
      "\"Hi Gareth, saw your post about taking on your fourth engineer. Congrats. I work with small trade firms on scheduling, so I'd like to follow how the growth goes.\"",
      "Shows you read their profile, and no pitch. Under 300 characters."],
  ],
  "review-request": [
    ["Review request by email (fictional brand)",
      "Subject: 30 seconds to help another plumbing firm?\n\"Hi Tom, you mentioned the engineer alerts saved your team a day last week. Would you share that in a Google review? It's the thing that helps other small firms find us most. Here's the direct link: [review link]. Thanks either way.\"",
      "Asked at a happy moment, quotes their own words back, and makes it one click."],
  ],
  community: [
    ["Helpful answer in a trades forum (fictional brand)",
      "Question: \"How do you stop double-booking on Mondays?\"\nAnswer: \"Three things worked for us: lock Monday slots after 3pm Friday, give every job a 30-minute buffer, and put engineers' holidays on the same board as jobs. (Disclosure: I work at Fieldwork, but all three work in a spreadsheet too.)\"",
      "Useful without buying anything, and discloses who we are. No link unless the forum allows it."],
  ],
  leads: [
    ["Lead handed from a comment to sales (fictional brand)",
      "Lead: Priya Shah, Shah Electrical, 3 engineers, Birmingham.\nSource: comment on the \"wasted trips\" reel, then a DM.\nNeed: engineers not hearing about job changes.\nNext step: 15-minute demo booked Thursday 10:00. Owner: Aisha.",
      "Who they are, where they came from, what they need, and the one agreed next step with an owner."],
  ],
  /* ------------------------------------------------------------ profiles */
  "brand-details": [
    ["A 'What the company does' paragraph (fictional brand)",
      "Fieldwork is job-scheduling software for UK plumbing and electrical firms with 1–25 engineers. It sends every booking, change and cancellation straight to the engineer's phone and texts the customer when the engineer is on the way. Firms set it up in an afternoon, without an IT person. Founded in Leeds in 2019, it is used by 340 trade firms.",
      "Starts with the name, and says what it sells, to whom and where, with facts that could be checked. Nothing a competitor could also claim."],
    ["A tagline (fictional brand)",
      "Job scheduling for plumbing and electrical firms.",
      "Under 12 words. It says what the brand does and for whom, not a slogan like 'Work smarter'."],
  ],
  registration: [
    ["Completed sign-up for a new directory (fictional brand)",
      "Account email: social@fieldwork.example (shared; 2-step on; in the team password manager; second admin: Aisha)\nName: Fieldwork · Category: Business software · Handle: @fieldworkapp (same as every channel)\nBio, website, phone, address and hours pasted from 'Copy for every profile'.\nProfile picture: icon mark 800×800 · Cover: current cover set\nAdded to Channels the same day with its page URL; ownership verified by domain.",
      "A shared brand account, the same handle everywhere, and every detail pasted rather than typed."],
  ],
  "brand-visuals": [
    ["Quote card designed in Canva (fictional brand)",
      "Canva, 1080×1350. Background: brand navy (#1B2A4A). Quote in the heading typeface, white, 3 lines max: \"We got a day a week back.\" Attribution in the body typeface, brand yellow: \"Dan Hughes, Hughes Plumbing\". Icon mark bottom-right with clear space. Illustration from unDraw, accent recoloured to brand yellow.",
      "Only brand colours and typefaces, a real quote with permission, and stock restyled rather than dropped in."],
  ],
  "profile-info": [
    ["Instagram bio (fictional brand)",
      "Job scheduling for plumbing & electrical firms 🔧\nEngineers see every change the moment it's made\n👇 Try it free for 14 days\n[tracked link]",
      "Line 1 is what and for whom, line 2 is the benefit, line 3 is the next step. It matches the brand page word for word."],
  ],
  "profile-picture": [
    ["Profile picture (fictional brand)",
      "The icon mark alone, centred on the brand navy, 800×800 PNG, with enough padding that it survives a circular crop. Identical on every platform.",
      "Recognisable at 40px and the same everywhere, so people know it's us."],
  ],
  "cover-graphics": [
    ["LinkedIn banner (fictional brand)",
      "1584×396. Left two-thirds: \"Job scheduling for plumbing & electrical firms\" in the heading typeface. Right third: the engineer app on a phone. Nothing important in the bottom-left, where the logo overlaps on desktop.",
      "The tagline plus the product in use, and it respects the platform's safe zones."],
  ],
  ads: [
    ["Meta ad (fictional brand)",
      "Primary text: Engineers turning up to cancelled jobs? Fieldwork puts every change on their phone the moment it's made.\nHeadline: Try it free for 14 days\nCreative: 1:1 Canva design, van on a driveway, \"Job cancelled. Again.\"\nAudience: owners of UK plumbing and electrical firms, 1–25 staff.\nBudget: £20 a day for 7 days; stop if cost per trial is over £40.",
      "One pain, one product line, one offer, a clear audience, and a budget with a stop rule."],
  ],
  /* ---------------------------------------------------------- operations */
  planning: [
    ["A week's plan (fictional brand)",
      "Theme: wasted trips.\nMon: LinkedIn post (problem story) · Tue: reel (engineer POV) · Wed: carousel (5 signs) · Thu: customer quote card · Fri: poll story.\nOne campaign link for the week; all posts point to the free trial.",
      "One theme across formats, every day covered, and one destination to measure."],
  ],
  reporting: [
    ["Weekly report (fictional brand)",
      "Reach 18,400 (+12%). Link clicks 212 (+31%), mostly from the reel. Trials 9 (goal 8).\nWhat worked: problem-first hooks. The reel got 3× the saves of the carousel.\nWhat didn't: Thursday's quote card (0.4% engagement).\nNext week: two reels; drop the quote card for a customer video.",
      "Numbers against last week and the goal, what worked and didn't, and one decision."],
  ],
  accounts: [
    ["Monthly access check (fictional brand)",
      "LinkedIn page: 3 admins (Mo, Aisha, agency until 31 Oct). Instagram: 2-step on, recovery email social@. Facebook: removed ex-freelancer. Canva: brand kit locked to admins. Password manager: all 10 channels present.",
      "Who has access to what, what changed, and nothing left to one person."],
  ],
};

export function libraryExamples(code: string): RuleExample[] {
  return (EXAMPLES[code] ?? []).map(([title, text, why], i) => ({ id: `${code}-ex-${i + 1}`, title, text, url: "", why }));
}
