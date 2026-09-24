/**
 * Safety stops: reasons a run pauses for a person whatever the brand's review
 * settings say. They are fixed in code, not settings.
 *
 * This file holds the word screen for copy. It is deliberately cautious — a
 * false alarm costs a person one look, a miss can cost the brand. The other
 * stops (broken playbook "musts", steps that keep failing) are raised by the
 * steps and the engine themselves.
 */

const SCREENS: { reason: string; pattern: RegExp }[] = [
  {
    reason: "mentions a price, discount or offer",
    pattern: /([$£€₹৳¥]\s?\d)|(\d\s?(usd|gbp|eur|bdt|tk)\b)|(\b\d{1,3}\s?%\s?off\b)|\b(discount|promo code|coupon|sale price|special offer|free trial)\b/i,
  },
  {
    reason: "talks about refunds, guarantees or warranties",
    pattern: /\b(refunds?|money[- ]back|guarantee[ds]?|warrant(y|ies))\b/i,
  },
  {
    reason: "touches on legal matters",
    pattern: /\b(lawsuits?|legal action|lawyers?|attorneys?|court|liabilit(y|ies)|compliance|gdpr)\b/i,
  },
  {
    reason: "makes a health or medical claim",
    pattern: /\b(cures?|treats?|diagnos(e|is)|medical(ly)?|clinically proven|heals?)\b/i,
  },
  {
    reason: "apologises or admits fault",
    pattern: /\b(we('| a)re sorry|we apologi[sz]e|our (mistake|fault)|we messed up)\b/i,
  },
];

/** The reasons this text should not go out without a person seeing it. */
export function screenCopy(texts: (string | null | undefined)[]): string[] {
  const all = texts.filter(Boolean).join("\n");
  return SCREENS.filter((s) => s.pattern.test(all)).map((s) => `The copy ${s.reason}.`);
}
