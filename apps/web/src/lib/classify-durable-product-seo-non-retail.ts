import { retailRelation } from './classify-durable-product-seo-retail-relation';
import type { ProductSeoMoneyCandidate } from './get-product-seo-money-candidates';

const NON_RETAIL_AMOUNT_LABEL =
  /^\s+(?:(?:gift[- ]card\s+)?bonus|cashback|cash\s+back|trade[- ]in\s+credit|store\s+credit|credit(?!\s+cards?\b)|rebates?|rewards?|discounts?)\b/i;
const PRECEDING_NON_RETAIL_LABEL =
  /\b(?:(?:gift[- ]card\s+)?bonus|cashback|cash\s+back|trade[- ]in\s+credit|store\s+credit|credit(?!\s+cards?\b)|rebates?|rewards?|discounts?)(?:\s+(?:of|worth|up\s+to|valued\s+at)){0,2}\s*[:–—-]?\s*(?:(?:just|only|about|around|approximately)\s+){0,2}$/i;

export function isClearlyNonRetailSeoAmount(
  candidate: ProductSeoMoneyCandidate,
  text: string
): boolean {
  const relation = retailRelation(text, candidate.start);
  const precedingClause =
    text
      .slice(Math.max(0, candidate.start - 120), candidate.start)
      .split(/[.!?;\n]/)
      .at(-1) ?? '';
  const hasPrecedingLabel = PRECEDING_NON_RETAIL_LABEL.test(precedingClause);
  const hasLabel =
    NON_RETAIL_AMOUNT_LABEL.test(text.slice(candidate.end)) ||
    hasPrecedingLabel;
  return (
    !relation.strong &&
    !relation.predicate &&
    (!relation.purchase || hasPrecedingLabel) &&
    !relation.commercial &&
    hasLabel
  );
}
