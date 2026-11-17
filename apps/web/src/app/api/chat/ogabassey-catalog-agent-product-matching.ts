import type {
  StorefrontAgentUiEvent,
  StorefrontAgentUiProduct,
} from '@/schemas/storefront-agent-ui-contract';
import {
  collectProductGroundingTokens,
  tokenizeIdentityWords,
} from './ogabassey-catalog-agent-grounding-tokens';
import {
  GENERIC_PRODUCT_NAME_WORDS,
  KNOWN_BRAND_TOKENS,
  POSITIVE_AVAILABILITY_GENERIC_WORDS,
} from './ogabassey-catalog-agent-lexicon';
import { hasUnreturnedProductPhrase } from './ogabassey-catalog-agent-phrase-grounding';
import { collectModelAttachedTierTokens } from './ogabassey-catalog-agent-tier-parser';

export { hasUnreturnedProductPhrase };

export const POSITIVE_EMPTY_RESULT_CLAIM =
  /\b(?:in[\s-]+stock|available\s+now|available\s+for|we\s+(?:have|stock|carry|sell|offer)|(?:is|are)\s+available|available\s+in|comes?\s+in|you\s+can\s+(?:get|buy|order)|we\s+recommend|try\s+the|here\s+(?:is|are)|check\s+out)\b/i;

export const NEGATION_OR_ABSENCE_CUE =
  /\b(?:no|not|don['’]?t|do\s+not|didn['’]?t|did\s+not|couldn['’]?t|could\s+not|can['’]?t|cannot|never|none|nothing|zero|unable|without|unavailable|out\s+of\s+stock|sold\s+out)\b/i;

export const EMPTY_CLAUSE_SPLIT_CAPTURE =
  /([.!?\n;]+|\b(?:and|but|however|although|while|though|yet)\b|,\s*)/i;

const SEGMENT_SUB_SPLIT_PATTERN =
  /[.!?\n;—–]+|\b(?:and|but|or|while|versus|vs)\b|,\s+/gi;

export function tokenizeLowerWords(value: string): string[] {
  return (value.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
    (token) => token.length >= 2
  );
}

export function productMatchesSegment(
  product: StorefrontAgentUiProduct,
  segment: string
): number {
  const lowerSegment = segment.toLowerCase();
  const segmentTokens = new Set(tokenizeIdentityWords(segment));

  // If the segment names any brand or model-attached variant tier/chip,
  // the candidate product must actually own every such token.
  const productIdentityTokens = new Set([
    ...tokenizeIdentityWords(product.brand ?? ''),
    ...tokenizeIdentityWords(product.name),
  ]);
  const attachedTiers = collectModelAttachedTierTokens(
    segment,
    productIdentityTokens
  );
  for (const token of segmentTokens) {
    if (
      (KNOWN_BRAND_TOKENS.has(token) || attachedTiers.has(token)) &&
      !productIdentityTokens.has(token)
    ) {
      return 0;
    }
  }

  const fullName = product.name.trim().toLowerCase();
  if (fullName && lowerSegment.includes(fullName)) {
    return 100 + tokenizeLowerWords(fullName).length;
  }

  const nameTokens = tokenizeIdentityWords(product.name).filter(
    (token) => !GENERIC_PRODUCT_NAME_WORDS.has(token)
  );
  const brandTokens = new Set(tokenizeLowerWords(product.brand ?? ''));
  const nonBrandTokens = nameTokens.filter((token) => !brandTokens.has(token));
  const pool = nonBrandTokens.length > 0 ? nonBrandTokens : nameTokens;
  if (pool.length === 0) return 0;

  const modelVersionTokens = pool.filter((token) => /\d/.test(token));
  if (
    modelVersionTokens.length > 0 &&
    !modelVersionTokens.every((token) => segmentTokens.has(token))
  ) {
    return 0;
  }

  let score = 0;
  for (const token of pool) {
    if (segmentTokens.has(token)) score += 1;
  }
  const requiredMatches =
    pool.length <= 3 ? pool.length : Math.max(2, Math.ceil(pool.length * 0.6));
  return score >= requiredMatches ? score : 0;
}

function matchCandidateProducts(
  candidate: string,
  products: StorefrontAgentUiProduct[]
): StorefrontAgentUiProduct[] {
  const parts = candidate
    .split(/,\s+/g)
    .map((part) => part.trim())
    .filter(Boolean);
  const matchedSet = new Set<StorefrontAgentUiProduct>();

  for (const part of parts) {
    let bestScore = 0;
    let bestForPart: StorefrontAgentUiProduct[] = [];
    for (const product of products) {
      const score = productMatchesSegment(product, part);
      if (score > bestScore) {
        bestScore = score;
        bestForPart = [product];
      } else if (score > 0 && score === bestScore) {
        bestForPart.push(product);
      }
    }
    for (const product of bestForPart) {
      matchedSet.add(product);
    }
  }

  return [...matchedSet];
}

export function findBoundProducts(
  text: string,
  offset: number,
  products: StorefrontAgentUiProduct[]
): StorefrontAgentUiProduct[] {
  const splitBoundaries = (regex: RegExp) => {
    let start = 0;
    let end = text.length;
    for (const match of text.matchAll(regex)) {
      const idx = match.index ?? 0;
      const matchEnd = idx + match[0].length;
      if (matchEnd <= offset) start = Math.max(start, matchEnd);
      else if (idx >= offset && end === text.length) {
        end = idx;
        break;
      }
    }
    return text.slice(start, end);
  };

  const localClause = splitBoundaries(
    /[.!?\n;—–]+|\b(?:and|while|versus|vs)\b/gi
  );
  const sentence = splitBoundaries(/[.!?\n;]+/g);

  for (const candidate of [localClause, sentence, text]) {
    const matched = matchCandidateProducts(candidate, products);
    if (matched.length > 0) return matched;
  }

  return products;
}

export function hasGroundedProductMentions(
  text: string,
  events: StorefrontAgentUiEvent[]
): boolean {
  const products = events.flatMap((event) => event.products);
  if (products.length === 0) return false;

  const segments = text
    .split(SEGMENT_SUB_SPLIT_PATTERN)
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (
    !segments.some((segment) =>
      products.some((product) => productMatchesSegment(product, segment) > 0)
    )
  ) {
    return false;
  }

  const { returnedTokens, perProductTokens } =
    collectProductGroundingTokens(products);
  const clauses = text
    .split(EMPTY_CLAUSE_SPLIT_CAPTURE)
    .filter((_, index) => index % 2 === 0)
    .map((clause) => clause.trim())
    .filter(Boolean);

  let searchCursor = 0;
  for (const clause of clauses) {
    const foundOffset = text.indexOf(clause, searchCursor);
    const clauseOffset = foundOffset >= 0 ? foundOffset : searchCursor;
    searchCursor = clauseOffset + clause.length;
    if (NEGATION_OR_ABSENCE_CUE.test(clause)) continue;

    const directMatches = clause
      .replace(/[()]/g, ' ')
      .split(/,\s+|\s+\b(?:or|versus|vs\.?)\s+/i)
      .flatMap((part) => matchCandidateProducts(part.trim(), products));
    const boundSet = new Set(
      directMatches.length > 0
        ? directMatches
        : findBoundProducts(text, clauseOffset, products)
    );
    const clauseTokens = perProductTokens.filter((entry) =>
      boundSet.has(entry.product)
    );
    if (hasUnreturnedProductPhrase(clause, returnedTokens, clauseTokens)) {
      return false;
    }
    if (
      POSITIVE_EMPTY_RESULT_CLAIM.test(clause) &&
      !products.some((product) => productMatchesSegment(product, clause) > 0)
    ) {
      const contentWords = (
        clause.toLowerCase().match(/[a-z]{3,}/g) ?? []
      ).filter((word) => !POSITIVE_AVAILABILITY_GENERIC_WORDS.has(word));
      if (contentWords.some((word) => !returnedTokens.has(word))) return false;
    }
  }

  return true;
}
