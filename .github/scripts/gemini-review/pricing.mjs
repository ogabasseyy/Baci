// Paid-tier prices in USD per 1M tokens, from aistudio.google.com/docs/pricing (2026-11-11).
// Thinking tokens are billed as output. Google doubles the 3.6 / 3.8 Flash prices on 2027-01-01.
// Unknown models (aliases, future ids) return null: the review just omits the estimate.
const FLASH = { now: [0.75, 3.75], from2027: [1.5, 7.5] };
const PRICES = {
  'gemini-3.8-flash': FLASH,
  'gemini-3.6-flash': FLASH,
  'gemini-3.5-flash-lite': { now: [0.3, 2.5], from2027: [0.3, 2.5] },
  'gemini-3.1-flash-lite': { now: [0.25, 1.5], from2027: [0.25, 1.5] },
  'gemini-2.5-flash-lite': { now: [0.1, 0.4], from2027: [0.1, 0.4] },
};

export function estimateCostUsd(model, usage, dateIso = new Date().toISOString()) {
  const entry = PRICES[model];
  if (!entry) return null;
  const [inputPrice, outputPrice] = dateIso >= '2027-01-01' ? entry.from2027 : entry.now;
  const output = (usage.outputTokens ?? 0) + (usage.thoughtTokens ?? 0);
  const dollars = ((usage.promptTokens ?? 0) * inputPrice + output * outputPrice) / 1_000_000;
  return Math.round(dollars * 10_000) / 10_000;
}
