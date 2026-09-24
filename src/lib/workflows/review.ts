/** The reviewer's verdict, importable from client components. See `src/server/reviewer.ts`. */

export const REVIEW_FLAGS = [
  "price_or_offer", "refund_or_guarantee", "legal", "health_claim",
  "admits_fault", "complaint_or_crisis", "sensitive_topic", "unverifiable_claim",
] as const;
export type ReviewFlag = (typeof REVIEW_FLAGS)[number];

export const REVIEW_FLAG_LABELS: Record<ReviewFlag, string> = {
  price_or_offer: "mentions a price, discount or offer",
  refund_or_guarantee: "promises a refund, guarantee or warranty",
  legal: "touches on legal matters",
  health_claim: "makes a health or safety claim",
  admits_fault: "apologises or admits fault",
  complaint_or_crisis: "deals with a complaint or something that could escalate",
  sensitive_topic: "touches a sensitive topic",
  unverifiable_claim: "makes a claim the brand book cannot back up",
};

export type ReviewVerdict = {
  score: number;
  flags: ReviewFlag[];
  summary: string;
  fixes: string[];
  model: string;
  reviewedAt: string;
};

/** Where the reviewer could not run, the word screen stood in. */
export type ReviewRecord = ReviewVerdict | { skipped: string };

export function isVerdict(r: unknown): r is ReviewVerdict {
  return typeof r === "object" && r !== null && typeof (r as ReviewVerdict).score === "number";
}
