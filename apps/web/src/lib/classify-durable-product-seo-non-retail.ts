import { retailRelation } from './classify-durable-product-seo-retail-relation';
import type { ProductSeoMoneyCandidate } from './get-product-seo-money-candidates';

const NON_RETAIL_AMOUNT_LABEL =
  /^\s+(?:(?:gift[- ]card\s+)?bonus|cashback|cash\s+back|trade[- ]in\s+credit|store\s+credit|credit(?!\s+cards?\b)|rebate|reward|discount)\b/i;

export function isClearlyNonRetailSeoAmount(
  candidate: ProductSeoMoneyCandidate,
  text: string
): boolean {
  const relation = retailRelation(text, candidate.start);
  return (
    !relation.strong &&
    !relation.predicate &&
    !relation.purchase &&
    !relation.commercial &&
    NON_RETAIL_AMOUNT_LABEL.test(text.slice(candidate.end))
  );
}
