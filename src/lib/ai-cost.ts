/**
 * What a Claude call cost, from its token counts. Importable from client
 * components. Prices are US dollars per million tokens (Anthropic's list
 * prices, September 2026); cache writes cost 1.25× input, cache reads 0.1×.
 * A model not listed is priced as Opus, so an unknown one never looks cheap.
 */

type Price = { input: number; output: number };

const PRICES: [prefix: string, price: Price][] = [
  ["claude-haiku-4-5", { input: 1, output: 5 }],
  ["claude-sonnet-5", { input: 2, output: 10 }],
  ["claude-sonnet-4-6", { input: 3, output: 15 }],
  ["claude-opus-5-5", { input: 4, output: 20 }],
  ["claude-opus", { input: 5, output: 25 }],
  ["claude-fable", { input: 10, output: 50 }],
  ["claude-mythos", { input: 10, output: 50 }],
];
const FALLBACK: Price = { input: 5, output: 25 };

export type TokenUsage = { input: number; output: number; cacheRead: number; cacheWrite: number; model: string };

export function priceOf(model: string): Price {
  return PRICES.find(([prefix]) => model.startsWith(prefix))?.[1] ?? FALLBACK;
}

/** US dollars. */
export function costOf(u: TokenUsage | null | undefined): number {
  if (!u) return 0;
  const p = priceOf(u.model);
  return (u.input * p.input + u.cacheWrite * p.input * 1.25 + u.cacheRead * p.input * 0.1 + u.output * p.output) / 1_000_000;
}

export function formatUsd(n: number) {
  if (n === 0) return "$0";
  if (n < 0.01) return "<$0.01";
  return `$${n.toFixed(n < 10 ? 2 : 0)}`;
}
