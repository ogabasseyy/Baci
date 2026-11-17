import type {
  StorefrontAgentUiEvent,
  StorefrontAgentUiProduct,
} from '@/schemas/storefront-agent-ui-contract';
import { hasGroundedSpecAndPolicyClaims } from './ogabassey-catalog-agent-attributes';
import {
  type CatalogBudgetLimit,
  isProductWithinBudget,
} from './ogabassey-catalog-agent-budget';
import {
  hasForeignCurrencyMention,
  UNGROUNDED_EMPTY_RESULT_CLAIM,
  validatePriceSpans,
} from './ogabassey-catalog-agent-prices';
import {
  findBoundProducts,
  hasGroundedProductMentions,
  hasPositiveEmptyClauseViolation,
  NEGATION_OR_ABSENCE_CUE,
} from './ogabassey-catalog-agent-product-matching';

const STOCK_COUNT_PATTERN =
  /(?:\b(\d+)\s+(?:in[\s-]+stock|left(?:\s+in\s+stock)?|remaining|available(?:\s+now)?|units?\b)|\bonly\s+(\d+)\s+(?:left|remaining|available)\b)/giu;
const OUT_OF_STOCK_ASSERTION =
  /\b(?:out\s+of\s+stock|sold\s+out|currently\s+unavailable|no\s+stock)\b/gi;
const POSITIVE_STOCK_ASSERTION =
  /\b(?:in[\s-]+stock|currently\s+available|available\s+now)\b/gi;

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
    if (!bound.every((product) => product.stock === claimedStock)) {
      return false;
    }
  }

  for (const match of text.matchAll(OUT_OF_STOCK_ASSERTION)) {
    const offset = match.index ?? 0;
    const before = text.slice(Math.max(0, offset - 20), offset);
    if (/\b(?:not|never)\s+$/i.test(before)) continue;
    const bound = findBoundProducts(text, offset, products);
    if (
      bound.length === 0 ||
      !bound.every(
        (product) =>
          product.manageStock &&
          (typeof product.stock !== 'number' || product.stock <= 0)
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
      bound.length === 0 ||
      !bound.every(
        (product) =>
          !product.manageStock ||
          (typeof product.stock === 'number' && product.stock > 0)
      )
    ) {
      return false;
    }
  }

  return true;
}

export function hasGroundedEmptyCatalogText(
  text: string,
  currencyCode = 'NGN',
  budgetLimit?: CatalogBudgetLimit
): boolean {
  if (hasForeignCurrencyMention(text, currencyCode)) return false;

  const priceCheck = validatePriceSpans(text, budgetLimit, () => false);
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
  if (hasForeignCurrencyMention(text, currencyCode)) return false;

  const priceCheck = validatePriceSpans(
    text,
    budgetLimit,
    (start, amount) => {
      const bound = findBoundProducts(text, start, products);
      return bound.every((product) => Math.round(product.price) === amount);
    },
    products
  );
  if (!priceCheck.valid) return false;

  if (!hasGroundedStockClaims(text, products)) return false;
  if (!hasGroundedSpecAndPolicyClaims(text, products)) return false;

  return true;
}
