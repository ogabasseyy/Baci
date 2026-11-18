import type { StorefrontAgentUiProduct } from '@/schemas/storefront-agent-ui-contract';
import type { CatalogBudgetLimit } from './ogabassey-catalog-agent-budget';

export const UNGROUNDED_EMPTY_RESULT_CLAIM =
  /[₦$€£]|\b(?:naira|ngn|usd|eur|gbp|cad|aud|ghs|kes|zar|dollars?|euros?)\b/i;

const PRICE_MENTION_PATTERN =
  /(?:(₦|ngn\s*|[$€£]\s*)((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(?:\s*(million|thousand|[km])\b)?|((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(?:\s*(million|thousand|[km])\b)?\s*(?:naira|ngn|₦)|((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*(million|thousand|[km])\b|(\d{1,3}(?:,\d{3})+)(?:\.\d+)?)/giu;

const BARE_PRICE_CANDIDATE_PATTERN = /\b(\d{4,9})\b/gu;
const SHORT_CUED_PRICE_PATTERN =
  /\b(?:costs?|priced?\s+at|retails?\s+(?:at|for)|selling\s+(?:at|for)|yours\s+for)\s+(\d{1,3}(?:\.\d+)?)\b/giu;
const NON_PRICE_SPEC_SUFFIX_PATTERN =
  /^\s*(?:mah|hz|khz|mhz|ghz|nits|ppi|rpm|gb|tb|mb|kb|mp|mm|cm|w|p|x)\b/i;
const RESOLUTION_SPEC_SUFFIX_PATTERN =
  /^\s*(?:displays?|screens?|resolutions?|uhd|oled|amoled|qled|ips|lcd|video|tvs?|monitors?|webcams?|cameras?|streaming)\b/i;
const MODEL_NUMBER_PREFIX_PATTERN =
  /(?:rtx|gtx|rx|arc|ryzen|core|i\d-|snapdragon|dimensity|helio|exynos|tensor|model|gen)\s*$/i;
const PRICE_CUE_PREFIX_PATTERN =
  /(?:costs?|priced?\s+at|for|at|from|only|under|below|within|up\s+to|at\s+most|budget(?:\s+(?:of|is))?)\s*$/i;
const BUDGET_FRAME_PREFIX_PATTERN =
  /\b(?:under|below|within|up\s+to|at\s+most|max(?:imum)?|budget)\b[^.!?\n]{0,24}$/i;
const BUDGET_FRAME_SUFFIX_PATTERN = /^[^.!?\n]{0,16}\b(?:budget|limit|cap)\b/i;

const FOREIGN_CURRENCY_PATTERNS: Record<string, RegExp> = {
  NGN: /[$€£]|\b(?:usd|eur|gbp|cad|aud|ghs|kes|zar|aed|sar|cny|jpy|inr|chf|dollars?|euros?|cedis?|shillings?|rands?|dirhams?|yen|yuan|rupees?|pound\s+sterling)\b|\d[\d,.]*(?:\s*(?:k|m|million|thousand))?\s*pounds?\b|\bpounds?\s+\d/iu,
  USD: /[₦€£]|\b(?:ngn|naira|eur|gbp|cad|aud|ghs|kes|zar|aed|sar|cny|jpy|inr|chf|euros?|cedis?|shillings?|rands?|dirhams?|yen|yuan|rupees?|pound\s+sterling)\b|\d[\d,.]*(?:\s*(?:k|m|million|thousand))?\s*pounds?\b|\bpounds?\s+\d/iu,
  EUR: /[₦$£]|\b(?:ngn|naira|usd|gbp|cad|aud|ghs|kes|zar|aed|sar|cny|jpy|inr|chf|dollars?|cedis?|shillings?|rands?|dirhams?|yen|yuan|rupees?|pound\s+sterling)\b|\d[\d,.]*(?:\s*(?:k|m|million|thousand))?\s*pounds?\b|\bpounds?\s+\d/iu,
  GBP: /[₦$€]|\b(?:ngn|naira|usd|eur|cad|aud|ghs|kes|zar|aed|sar|cny|jpy|inr|chf|dollars?|euros?|cedis?|shillings?|rands?|dirhams?|yen|yuan|rupees?)\b/iu,
};

function applyNumericScale(rawValue: string, unit?: string): number {
  const numeric = Number(rawValue.replaceAll(',', ''));
  if (!Number.isFinite(numeric)) return Number.NaN;
  if (/^(?:m|million)$/i.test(unit ?? '')) {
    return Math.round(numeric * 1_000_000);
  }
  if (/^(?:k|thousand)$/i.test(unit ?? '')) {
    return Math.round(numeric * 1_000);
  }
  return Math.round(numeric);
}

/** Rejects foreign currency symbols, ISO codes, and currency words for the active store currency. */
export function hasForeignCurrencyMention(
  text: string,
  currencyCode: string
): boolean {
  return (
    FOREIGN_CURRENCY_PATTERNS[currencyCode.toUpperCase()]?.test(text) ?? false
  );
}

function isBudgetRestatement(
  text: string,
  start: number,
  end: number
): boolean {
  const before = text.slice(Math.max(0, start - 32), start);
  const after = text.slice(end, Math.min(text.length, end + 24));
  return (
    BUDGET_FRAME_PREFIX_PATTERN.test(before) ||
    BUDGET_FRAME_SUFFIX_PATTERN.test(after)
  );
}

function collectModelNumberTokens(
  products: StorefrontAgentUiProduct[]
): Set<string> {
  const tokens = new Set<string>();
  for (const product of products) {
    for (const source of [product.name, product.slug, product.variantModel]) {
      if (!source) continue;
      for (const match of source.matchAll(/\b(\d{4,9})\b/gu)) {
        if (match[1]) tokens.add(match[1]);
      }
    }
  }
  return tokens;
}

function isBareNonPriceSpec(
  text: string,
  start: number,
  end: number,
  amount: number,
  rawToken: string,
  modelNumberTokens: Set<string>
): boolean {
  const before = text.slice(Math.max(0, start - 24), start);
  const after = text.slice(end, Math.min(text.length, end + 16));
  if (NON_PRICE_SPEC_SUFFIX_PATTERN.test(after)) return true;
  if (MODEL_NUMBER_PREFIX_PATTERN.test(before)) return true;
  if (
    modelNumberTokens.has(rawToken) &&
    !PRICE_CUE_PREFIX_PATTERN.test(before)
  ) {
    return true;
  }
  return (
    amount >= 2010 && amount <= 2035 && !PRICE_CUE_PREFIX_PATTERN.test(before)
  );
}

/** Validates formatted, scaled, bare, and short cued prices against bound products and active budget. */
export function validatePriceSpans(
  text: string,
  budgetLimit: CatalogBudgetLimit | undefined,
  onMatchedAmount: (start: number, amount: number) => boolean,
  products: StorefrontAgentUiProduct[] = []
): { valid: boolean; spans: Array<{ start: number; end: number }> } {
  const spans: Array<{ start: number; end: number }> = [];
  const modelNumberTokens = collectModelNumberTokens(products);
  const activeBudgetAmount =
    budgetLimit && Number.isFinite(budgetLimit.amount)
      ? Math.round(budgetLimit.amount)
      : undefined;
  const isAllowedBudgetEcho = (start: number, end: number, amount: number) =>
    activeBudgetAmount !== undefined &&
    amount === activeBudgetAmount &&
    isBudgetRestatement(text, start, end);

  for (const match of text.matchAll(PRICE_MENTION_PATTERN)) {
    const rawNumber = match[2] ?? match[4] ?? match[6] ?? match[8];
    const unit = match[3] ?? match[5] ?? match[7];
    if (!rawNumber) continue;

    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (
      match[6] !== undefined &&
      unit?.toLowerCase() === 'k' &&
      RESOLUTION_SPEC_SUFFIX_PATTERN.test(text.slice(end, end + 24))
    ) {
      continue;
    }

    const amount = applyNumericScale(rawNumber, unit);
    if (!Number.isFinite(amount) || amount <= 0) {
      return { valid: false, spans };
    }
    spans.push({ start, end });

    if (isAllowedBudgetEcho(start, end, amount)) continue;
    if (!onMatchedAmount(start, amount)) return { valid: false, spans };
  }

  for (const match of text.matchAll(BARE_PRICE_CANDIDATE_PATTERN)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (spans.some((span) => start >= span.start && end <= span.end)) continue;

    const amount = Number(match[1]);
    if (
      isBareNonPriceSpec(text, start, end, amount, match[1], modelNumberTokens)
    ) {
      continue;
    }
    spans.push({ start, end });

    if (isAllowedBudgetEcho(start, end, amount)) continue;
    if (!onMatchedAmount(start, amount)) return { valid: false, spans };
  }

  for (const match of text.matchAll(SHORT_CUED_PRICE_PATTERN)) {
    const rawNumber = match[1];
    if (!rawNumber) continue;
    const numberOffset = match[0].lastIndexOf(rawNumber);
    const start = (match.index ?? 0) + Math.max(0, numberOffset);
    const end = start + rawNumber.length;
    if (spans.some((span) => start >= span.start && end <= span.end)) continue;

    const amount = Math.round(Number(rawNumber));
    if (!Number.isFinite(amount) || amount <= 0) {
      return { valid: false, spans };
    }
    spans.push({ start, end });

    if (isAllowedBudgetEcho(start, end, amount)) continue;
    if (!onMatchedAmount(start, amount)) return { valid: false, spans };
  }

  return { valid: true, spans };
}
