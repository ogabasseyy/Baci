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
  EMPTY_CLAUSE_SPLIT_CAPTURE,
  findBoundProducts,
  hasGroundedProductMentions,
  hasUnreturnedProductPhrase,
  NEGATION_OR_ABSENCE_CUE,
  POSITIVE_EMPTY_RESULT_CLAIM,
} from './ogabassey-catalog-agent-product-matching';

const POSITIVE_STORE_OFFERING_PHRASE =
  /\b(?<!don['’]?t\s)(?<!do\s+not\s)(?<!not\s)(?<!never\s)(?:we|our\s+store)\s+(?:have|stock|carry|sell|offer)\b|\bavailable\s+now\b/i;
const CONTRAST_OR_SENTENCE_BREAK =
  /^(?:[.!?\n;]+|but|however|although|while|though|yet)$/i;
const POSITIVE_CLAUSE_VERB =
  /\b(?:is|are|was|were|have|has|had|stock|carry|sell|offer|can|recommend|try)\b/i;

export function hasPositiveEmptyClauseViolation(text: string): boolean {
  const emptyReturnedTokens = new Set<string>();
  const parts = text.split(EMPTY_CLAUSE_SPLIT_CAPTURE);
  let governingNegation = false;

  for (let i = 0; i < parts.length; i += 2) {
    const clause = (parts[i] ?? '').trim();
    const prevSeparator = i > 0 ? (parts[i - 1] ?? '').trim() : '';
    if (!clause) continue;

    if (
      !prevSeparator ||
      CONTRAST_OR_SENTENCE_BREAK.test(prevSeparator) ||
      POSITIVE_CLAUSE_VERB.test(clause)
    ) {
      governingNegation = false;
    }

    if (POSITIVE_STORE_OFFERING_PHRASE.test(clause)) return true;
    if (NEGATION_OR_ABSENCE_CUE.test(clause)) {
      governingNegation = true;
      continue;
    }
    if (governingNegation) continue;
    if (POSITIVE_EMPTY_RESULT_CLAIM.test(clause)) return true;
    if (hasUnreturnedProductPhrase(clause, emptyReturnedTokens)) return true;
  }

  return false;
}

const STOCK_COUNT_PATTERN =
  /(?:\b(\d+)\s+(?:in[\s-]+stock|left(?:\s+in\s+stock)?|remaining|available(?:\s+now)?|units?\b)|\bonly\s+(\d+)\s+(?:left|remaining|available)\b)/giu;
const OUT_OF_STOCK_ASSERTION =
  /\b(?:out\s+of\s+stock|sold\s+out|currently\s+unavailable|no\s+stock)\b/gi;
const POSITIVE_STOCK_ASSERTION =
  /\b(?:in[\s-]+stock|currently\s+available|available\s+now)\b/gi;
const DIRECT_STOCK_NEGATION =
  /(?:^|\b)(?:not(?:\s+currently)?|never|no\s+longer|isn['’]?t|aren['’]?t|wasn['’]?t|weren['’]?t)\s+$/i;

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
    const before = text.slice(Math.max(0, offset - 24), offset);
    if (DIRECT_STOCK_NEGATION.test(before)) continue;
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
