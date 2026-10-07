/**
 * Where an agent writes and a person sends. LinkedIn's User Agreement
 * prohibits bots and automated activity on the site, and accounts doing it at
 * volume get restricted, so on LinkedIn the agent drafts and queues and a
 * person approves each one with a tap. Like the safety stops this is fixed in
 * code: no brand review setting turns it off.
 *
 * Fully automated on LinkedIn, because they go through the official API:
 * drafting, checklist checks, scheduling and publishing the brand's own posts,
 * analytics collection and reports.
 */
export const PERSON_SENDS = {
  platforms: ["linkedin"],
  /** Playbook rule codes. */
  rules: ["prospect-comment", "dm", "connection"],
};

export const PERSON_SENDS_LABEL = "Agent drafts, person sends";

export const PERSON_SENDS_REASON =
  "LinkedIn does not allow automated activity on the site, so the agent has drafted this and a person sends it.";

export function personSends(platform: string | null | undefined, ruleCode: string) {
  return Boolean(platform) && PERSON_SENDS.platforms.includes(platform!) && PERSON_SENDS.rules.includes(ruleCode);
}

/** The playbook rule behind each kind of inbound item, for the send step. */
export const RULE_FOR_INTERACTION: Record<string, string> = { message: "dm", comment: "reply", reply: "reply", review: "review-reply" };
