import type {
  StorefrontAgentUiEvent,
  StorefrontAgentUiProduct,
} from '@/schemas/storefront-agent-ui-contract';
import {
  CAPITALIZED_PHRASE_IGNORE,
  GENERIC_PRODUCT_NAME_WORDS,
  KNOWN_BRAND_OR_LINE_TOKENS,
  KNOWN_BRAND_TOKENS,
  NON_PRODUCT_PREDECESSOR_WORDS,
} from './ogabassey-catalog-agent-lexicon';

const POSITIVE_EMPTY_RESULT_CLAIM =
  /\b(?:in[\s-]+stock|available\s+now|available\s+for|we\s+(?:have|stock|carry|sell|offer)|(?:is|are)\s+available|available\s+in|comes?\s+in|you\s+can\s+(?:get|buy|order)|we\s+recommend|try\s+the|here\s+(?:is|are)|check\s+out)\b/i;

export const NEGATION_OR_ABSENCE_CUE =
  /\b(?:no|not|don['’]?t|do\s+not|didn['’]?t|did\s+not|couldn['’]?t|could\s+not|can['’]?t|cannot|never|none|nothing|zero|unable|without|unavailable|out\s+of\s+stock|sold\s+out)\b/i;

const POSITIVE_STORE_OFFERING_PHRASE =
  /\b(?<!don['’]?t\s)(?<!do\s+not\s)(?<!not\s)(?<!never\s)(?:we|our\s+store)\s+(?:have|stock|carry|sell|offer)\b|\bavailable\s+now\b/i;

export const EMPTY_CLAUSE_SPLIT_PATTERN =
  /[.!?\n;]+|\b(?:and|but|however|although|while|though|yet)\b|,\s*/i;

const CLAUSE_SPLIT_PATTERN =
  /[.!?\n;]+|\b(?:but|however|although)\b|,\s*(?=(?:we|here|try|you|the|check)\b)/i;

const SEGMENT_SUB_SPLIT_PATTERN =
  /[.!?\n;—–]+|\b(?:and|but|or|while|versus|vs)\b|,\s+/gi;

const FAMILY_VARIANT_PATTERN =
  /\b(?:macbook|iphone|ipad|imac|galaxy|pixel|xps|surface|watch|redmi|tecno|infinix|oneplus|playstation)\s+(?:(?:pro|ultra|max|mini|plus|air|studio|fold|flip|fe|se|lite|neo|edge|spark|camon|phantom|hot|note|nord|pixel)\b|[a-z]{0,2}\d{1,4}[a-z]?\b)(?:\s+(?:pro|ultra|max|mini|plus|air|studio|fold|flip|fe|se|lite|neo|[a-z]{0,2}\d{1,4}[a-z]?\b)){0,2}/gi;

const CAPITALIZED_PHRASE_PATTERN =
  /\b(?:iPhone|iPad|iMac|[A-Z][A-Za-z0-9-]{1,24})(?:\s+(?:iPhone|iPad|iMac|[A-Z0-9][A-Za-z0-9-]{0,24})){1,4}\b/g;

// Catches lowercase or mixed-case "<model> <number/tier>" mentions so
// unreturned products like "or fairphone 5" cannot sneak past capitalization.
const LOWERCASE_MODEL_NUMBER_PATTERN =
  /\b([a-z][a-z0-9-]{2,20})\s+(?:([a-z]{0,2}\d{1,4}[a-z]?)|(?:pro|ultra|max|mini|plus|air|studio|fold|flip|fe|se|lite|neo|spark|camon|phantom|xm\d))\b/gi;

export function tokenizeLowerWords(value: string): string[] {
  return (value.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
    (token) => token.length >= 2
  );
}

function collectReturnedProductTokens(
  events: StorefrontAgentUiEvent[]
): Set<string> {
  const tokens = new Set<string>();
  for (const event of events) {
    for (const product of event.products) {
      const fields = [
        product.name,
        product.brand,
        product.category,
        product.description,
        product.slug,
        product.variantModel,
      ];
      for (const field of fields) {
        if (!field) continue;
        for (const token of field.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
          if (token.length >= 2 || /^\d$/.test(token)) {
            tokens.add(token);
          }
        }
      }
    }
  }
  return tokens;
}

export function productMatchesSegment(
  product: StorefrontAgentUiProduct,
  segment: string
): number {
  const lowerSegment = segment.toLowerCase();
  const segmentTokens = new Set(
    lowerSegment
      .match(/[a-z0-9]+/g)
      ?.filter((token) => token.length >= 2 || /^\d$/.test(token)) ?? []
  );

  // If the segment names any brand (e.g. "Apple" in "Apple Galaxy S25"), every
  // named brand must belong to this product so cross-brand synthesis fails.
  const productIdentityTokens = new Set([
    ...tokenizeLowerWords(product.brand ?? ''),
    ...tokenizeLowerWords(product.name),
  ]);
  for (const token of segmentTokens) {
    if (KNOWN_BRAND_TOKENS.has(token) && !productIdentityTokens.has(token)) {
      return 0;
    }
  }

  const fullName = product.name.trim().toLowerCase();
  if (fullName && lowerSegment.includes(fullName)) {
    return 100 + tokenizeLowerWords(fullName).length;
  }

  const nameTokens = (
    product.name.toLowerCase().match(/[a-z0-9]+/g) ?? []
  ).filter(
    (token) =>
      (token.length >= 2 || /^\d$/.test(token)) &&
      !GENERIC_PRODUCT_NAME_WORDS.has(token)
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

function hasUnreturnedProductPhrase(
  clause: string,
  returnedTokens: Set<string>
): boolean {
  for (const token of tokenizeLowerWords(clause)) {
    if (KNOWN_BRAND_OR_LINE_TOKENS.has(token) && !returnedTokens.has(token)) {
      return true;
    }
  }

  for (const match of clause.matchAll(FAMILY_VARIANT_PATTERN)) {
    const phraseTokens = tokenizeLowerWords(match[0]);
    if (phraseTokens.some((token) => !returnedTokens.has(token))) {
      return true;
    }
  }

  for (const match of clause.matchAll(CAPITALIZED_PHRASE_PATTERN)) {
    const words = (match[0].toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
      (token) => !CAPITALIZED_PHRASE_IGNORE.has(token)
    );
    if (
      words.length >= 2 &&
      words.some((token) => !returnedTokens.has(token))
    ) {
      return true;
    }
  }

  for (const match of clause.matchAll(LOWERCASE_MODEL_NUMBER_PATTERN)) {
    const leadWord = match[1]?.toLowerCase() ?? '';
    if (NON_PRODUCT_PREDECESSOR_WORDS.has(leadWord)) continue;
    const words = (match[0].toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
      (token) => !CAPITALIZED_PHRASE_IGNORE.has(token)
    );
    if (words.some((token) => !returnedTokens.has(token))) {
      return true;
    }
  }

  return false;
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
  const matchesReturnedProduct = segments.some((segment) =>
    products.some((product) => productMatchesSegment(product, segment) > 0)
  );
  if (!matchesReturnedProduct) return false;

  const returnedTokens = collectReturnedProductTokens(events);
  const clauses = text
    .split(CLAUSE_SPLIT_PATTERN)
    .map((clause) => clause.trim())
    .filter(Boolean);

  for (const clause of clauses) {
    if (NEGATION_OR_ABSENCE_CUE.test(clause)) continue;
    if (hasUnreturnedProductPhrase(clause, returnedTokens)) return false;
  }

  return true;
}

export function hasPositiveEmptyClauseViolation(text: string): boolean {
  const emptyReturnedTokens = new Set<string>();
  const clauses = text
    .split(EMPTY_CLAUSE_SPLIT_PATTERN)
    .map((clause) => clause.trim())
    .filter(Boolean);

  for (const clause of clauses) {
    if (POSITIVE_STORE_OFFERING_PHRASE.test(clause)) return true;
    if (NEGATION_OR_ABSENCE_CUE.test(clause)) continue;
    if (POSITIVE_EMPTY_RESULT_CLAIM.test(clause)) return true;
    if (hasUnreturnedProductPhrase(clause, emptyReturnedTokens)) return true;
  }

  return false;
}
