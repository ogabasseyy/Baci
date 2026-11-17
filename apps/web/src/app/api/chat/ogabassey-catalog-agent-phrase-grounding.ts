import {
  allowsDescriptionFeature,
  isNumericFeatureToken,
  type ProductGroundingTokenSet,
  tokenizeIdentityWords,
} from './ogabassey-catalog-agent-grounding-tokens';
import {
  CAPITALIZED_PHRASE_IGNORE,
  KNOWN_BRAND_OR_LINE_TOKENS,
  NON_PRODUCT_PREDECESSOR_WORDS,
  VARIANT_TIER_TOKENS,
} from './ogabassey-catalog-agent-lexicon';

const FAMILY_VARIANT_PATTERN =
  /\b(?:macbook|iphone|ipad|imac|galaxy|pixel|xps|surface|watch|redmi|tecno|infinix|oneplus|playstation)\s+(?:(?:pro|ultra|max|mini|plus|air|studio|fold|flip|fe|se|lite|neo|edge|spark|camon|phantom|hot|note|nord|pixel)\b|[a-z]{0,2}\d{1,4}[a-z]?\b)(?:\s+(?:pro|ultra|max|mini|plus|air|studio|fold|flip|fe|se|lite|neo|[a-z]{0,2}\d{1,4}[a-z]?\b)){0,2}/gi;

const CAPITALIZED_PHRASE_PATTERN =
  /\b(?:iPhone|iPad|iMac|[A-Z][A-Za-z0-9-]{1,24})(?:\s+(?:iPhone|iPad|iMac|[A-Z0-9][A-Za-z0-9-]{0,24})){1,4}\b/g;

// Catches lowercase or mixed-case "<model> <number/tier>" mentions so
// unreturned products like "or fairphone 5" cannot sneak past capitalization.
const LOWERCASE_MODEL_NUMBER_PATTERN =
  /\b([a-z][a-z0-9-]{2,20})\s+(?:([a-z]{0,2}\d{1,4}[a-z]?)|(?:pro|ultra|max|mini|plus|air|studio|fold|flip|fe|se|lite|neo|spark|camon|phantom|xm\d))\b/gi;

function isModelIdentityToken(token: string): boolean {
  return (
    !isNumericFeatureToken(token) &&
    (KNOWN_BRAND_OR_LINE_TOKENS.has(token) ||
      VARIANT_TIER_TOKENS.has(token) ||
      /\d/.test(token))
  );
}

function extractPhraseWords(raw: string): string[] {
  return (raw.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
    (token) =>
      (token.length >= 2 || /^\d$/.test(token)) &&
      !CAPITALIZED_PHRASE_IGNORE.has(token)
  );
}

/** Detects unreturned brand/line tokens, ungrounded model variants, and cross-product feature synthesis within a response clause. */
export function hasUnreturnedProductPhrase(
  clause: string,
  returnedTokens: Set<string>,
  perProductTokens: ProductGroundingTokenSet[] = []
): boolean {
  const hasSingleProductMatch = (
    words: string[],
    allowDescription = false,
    precedingWords: string[] = []
  ) =>
    perProductTokens.length > 0
      ? perProductTokens.some((productSet) =>
          allowDescription
            ? words.every((token) => productSet.features.has(token)) &&
              (allowsDescriptionFeature(words, precedingWords)
                ? true
                : words
                    .filter(isModelIdentityToken)
                    .every((token) => productSet.identity.has(token)))
            : words.every((token) => productSet.identity.has(token))
        )
      : words.every((token) => returnedTokens.has(token));

  for (const token of clause.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    if (
      token.length >= 2 &&
      KNOWN_BRAND_OR_LINE_TOKENS.has(token) &&
      (perProductTokens.length > 0
        ? !perProductTokens.some((productSet) => productSet.identity.has(token))
        : !returnedTokens.has(token))
    ) {
      return true;
    }
  }
  for (const match of clause.matchAll(FAMILY_VARIANT_PATTERN)) {
    if (!hasSingleProductMatch(tokenizeIdentityWords(match[0]))) return true;
  }
  for (const match of clause.matchAll(CAPITALIZED_PHRASE_PATTERN)) {
    const words = extractPhraseWords(match[0]);
    if (words.length >= 2 && !hasSingleProductMatch(words, true)) return true;
  }
  for (const match of clause.matchAll(LOWERCASE_MODEL_NUMBER_PATTERN)) {
    if (NON_PRODUCT_PREDECESSOR_WORDS.has(match[1]?.toLowerCase() ?? ''))
      continue;
    const before = clause
      .slice(0, match.index ?? 0)
      .split(/[.,;!?]/)
      .pop();
    const precedingWords = extractPhraseWords(before ?? '');
    const words = extractPhraseWords(match[0]);
    const isDesc = allowsDescriptionFeature(words, precedingWords);
    if (
      words.length > 0 &&
      !hasSingleProductMatch(words, isDesc, precedingWords)
    ) {
      return true;
    }
  }
  return false;
}
