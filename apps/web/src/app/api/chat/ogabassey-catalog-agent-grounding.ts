import type {
  StorefrontAgentUiEvent,
  StorefrontAgentUiProduct,
} from '@/schemas/storefront-agent-ui-contract';
import {
  type CatalogBudgetLimit,
  type CatalogChatMessage,
  isProductWithinBudget,
} from './ogabassey-catalog-agent-budget';
import {
  findBoundProducts,
  hasGroundedProductMentions,
  hasPositiveEmptyClauseViolation,
  NEGATION_OR_ABSENCE_CUE,
} from './ogabassey-catalog-agent-product-matching';

export const UNGROUNDED_EMPTY_RESULT_CLAIM = /[₦$€£]|\b(?:naira|ngn)\b/i;

const PRICE_MENTION_PATTERN =
  /(?:(₦|ngn\s*|[$€£]\s*)((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(?:\s*(million|thousand|[km])\b)?|((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(?:\s*(million|thousand|[km])\b)?\s*(?:naira|ngn|₦)|((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*(million|thousand|[km])\b|(\d{1,3}(?:,\d{3})+)(?:\.\d+)?)/giu;

// Only treat explicit currency, scaled, or budget-cued numbers from user turns
// as valid budget references so model numbers (e.g. "iPhone 16") never enter.
const USER_BUDGET_MENTION_PATTERN =
  /(?:(₦|ngn\s*|[$€£]\s*)((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(?:\s*(million|thousand|[km]))?|((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*(?:(million|thousand|[km])\b|(?=(?:\s*(?:naira|ngn|₦))))|(?:under|below|within|up\s+to|at\s+most|max(?:imum)?|budget(?:\s+(?:of|is))?)\s+((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(?:\s*(million|thousand|[km]))?)/giu;

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

const STOCK_COUNT_PATTERN =
  /(?:\b(\d+)\s+(?:in[\s-]+stock|left(?:\s+in\s+stock)?|remaining|available(?:\s+now)?|units?\b)|\bonly\s+(\d+)\s+(?:left|remaining|available)\b)/giu;
const OUT_OF_STOCK_ASSERTION =
  /\b(?:out\s+of\s+stock|sold\s+out|currently\s+unavailable|no\s+stock)\b/gi;
const POSITIVE_STOCK_ASSERTION =
  /\b(?:in[\s-]+stock|currently\s+available|available\s+now)\b/gi;

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

function extractUserPriceMentions(messages: CatalogChatMessage[]): Set<number> {
  const values = new Set<number>();
  for (const message of messages) {
    if (message.role !== 'user') continue;
    for (const match of message.content.matchAll(USER_BUDGET_MENTION_PATTERN)) {
      const rawNumber = match[2] ?? match[4] ?? match[6];
      const unit = match[3] ?? match[5] ?? match[7];
      if (!rawNumber) continue;
      const parsed = applyNumericScale(rawNumber, unit);
      if (Number.isFinite(parsed) && parsed > 0) {
        values.add(parsed);
      }
    }
  }
  return values;
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

function isBareNonPriceSpec(
  text: string,
  start: number,
  end: number,
  amount: number
): boolean {
  const before = text.slice(Math.max(0, start - 24), start);
  const after = text.slice(end, Math.min(text.length, end + 16));
  if (NON_PRICE_SPEC_SUFFIX_PATTERN.test(after)) return true;
  if (MODEL_NUMBER_PREFIX_PATTERN.test(before)) return true;
  if (
    amount >= 2010 &&
    amount <= 2035 &&
    !PRICE_CUE_PREFIX_PATTERN.test(before)
  ) {
    return true;
  }
  return false;
}

function hasForeignCurrencySymbol(text: string, currencyCode: string): boolean {
  const code = currencyCode.toUpperCase();
  if (code === 'NGN') return /[$€£]/.test(text);
  if (code === 'USD') return /[₦€£]/.test(text);
  if (code === 'EUR') return /[₦$£]/.test(text);
  if (code === 'GBP') return /[₦$€]/.test(text);
  return false;
}

function validatePriceSpans(
  text: string,
  userAmounts: Set<number>,
  onMatchedAmount: (start: number, amount: number) => boolean
): { valid: boolean; spans: Array<{ start: number; end: number }> } {
  const spans: Array<{ start: number; end: number }> = [];

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

    if (isBudgetRestatement(text, start, end) && userAmounts.has(amount)) {
      continue;
    }
    if (!onMatchedAmount(start, amount)) {
      return { valid: false, spans };
    }
  }

  for (const match of text.matchAll(BARE_PRICE_CANDIDATE_PATTERN)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (spans.some((span) => start >= span.start && end <= span.end)) {
      continue;
    }
    const amount = Number(match[1]);
    if (isBareNonPriceSpec(text, start, end, amount)) continue;
    spans.push({ start, end });

    if (isBudgetRestatement(text, start, end) && userAmounts.has(amount)) {
      continue;
    }
    if (!onMatchedAmount(start, amount)) {
      return { valid: false, spans };
    }
  }

  for (const match of text.matchAll(SHORT_CUED_PRICE_PATTERN)) {
    const rawNumber = match[1];
    if (!rawNumber) continue;
    const numberOffset = match[0].lastIndexOf(rawNumber);
    const start = (match.index ?? 0) + Math.max(0, numberOffset);
    const end = start + rawNumber.length;
    if (spans.some((span) => start >= span.start && end <= span.end)) {
      continue;
    }
    const amount = Math.round(Number(rawNumber));
    if (!Number.isFinite(amount) || amount <= 0) {
      return { valid: false, spans };
    }
    spans.push({ start, end });
    if (isBudgetRestatement(text, start, end) && userAmounts.has(amount)) {
      continue;
    }
    if (!onMatchedAmount(start, amount)) {
      return { valid: false, spans };
    }
  }

  return { valid: true, spans };
}

function hasGroundedStockClaims(
  text: string,
  products: StorefrontAgentUiProduct[]
): boolean {
  for (const match of text.matchAll(STOCK_COUNT_PATTERN)) {
    const rawCount = match[1] ?? match[2];
    if (!rawCount) continue;
    const claimedStock = Number(rawCount);
    const offset = match.index ?? 0;
    const bound = findBoundProducts(text, offset, products);
    if (!bound.some((product) => product.stock === claimedStock)) {
      return false;
    }
  }

  for (const match of text.matchAll(OUT_OF_STOCK_ASSERTION)) {
    const offset = match.index ?? 0;
    const before = text.slice(Math.max(0, offset - 20), offset);
    if (/\b(?:not|never)\s+$/i.test(before)) continue;
    const bound = findBoundProducts(text, offset, products);
    if (
      bound.every(
        (product) =>
          !product.manageStock ||
          (typeof product.stock === 'number' && product.stock > 0)
      )
    ) {
      return false;
    }
  }

  for (const match of text.matchAll(POSITIVE_STOCK_ASSERTION)) {
    const offset = match.index ?? 0;
    const before = text.slice(Math.max(0, offset - 20), offset);
    if (NEGATION_OR_ABSENCE_CUE.test(before)) continue;
    const bound = findBoundProducts(text, offset, products);
    if (
      bound.every(
        (product) =>
          product.manageStock &&
          (typeof product.stock !== 'number' || product.stock <= 0)
      )
    ) {
      return false;
    }
  }

  return true;
}

export function hasGroundedEmptyCatalogText(
  text: string,
  userMessages: CatalogChatMessage[] = [],
  currencyCode = 'NGN'
): boolean {
  if (hasForeignCurrencySymbol(text, currencyCode)) return false;

  const userAmounts = extractUserPriceMentions(userMessages);
  const priceCheck = validatePriceSpans(text, userAmounts, () => false);
  if (!priceCheck.valid) return false;

  let withoutBudgetRestatements = text;
  for (let i = priceCheck.spans.length - 1; i >= 0; i -= 1) {
    const { start, end } = priceCheck.spans[i];
    withoutBudgetRestatements =
      withoutBudgetRestatements.slice(0, start) +
      ' ' +
      withoutBudgetRestatements.slice(end);
  }

  if (UNGROUNDED_EMPTY_RESULT_CLAIM.test(withoutBudgetRestatements)) {
    return false;
  }
  if (!NEGATION_OR_ABSENCE_CUE.test(text)) return false;

  return !hasPositiveEmptyClauseViolation(text);
}

export function hasGroundedCatalogResultText(
  text: string,
  events: StorefrontAgentUiEvent[],
  userMessages: CatalogChatMessage[],
  currencyCode: string,
  budgetLimit?: CatalogBudgetLimit
): boolean {
  const products = events.flatMap((event) => event.products);
  if (
    !products.every((product) =>
      isProductWithinBudget(product.price, budgetLimit)
    )
  ) {
    return false;
  }

  if (!hasGroundedProductMentions(text, events)) return false;
  if (hasForeignCurrencySymbol(text, currencyCode)) return false;

  const userAmounts = extractUserPriceMentions(userMessages);
  const priceCheck = validatePriceSpans(text, userAmounts, (start, amount) => {
    const bound = findBoundProducts(text, start, products);
    return bound.some((product) => Math.round(product.price) === amount);
  });
  if (!priceCheck.valid) return false;

  if (!hasGroundedStockClaims(text, products)) return false;

  return true;
}
