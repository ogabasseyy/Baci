import {
  allowsDescriptionFeature,
  isNumericFeatureToken,
  type ProductGroundingTokenSet,
  tokenizeIdentityWords,
} from './ogabassey-catalog-agent-grounding-tokens';
import {
  CAPITALIZED_PHRASE_IGNORE,
  CONDITIONAL_PRODUCT_PREDECESSOR_WORDS,
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

const CHIPSET_CLAIM_PATTERN =
  /\b(?:m[1-9]|a1[2-9]|a2\d)(?:\s+(?:pro|max|ultra|bionic))?\s+(?:chip|chipset|processor|soc)\b/gi;

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
    precedingWords: string[] = [],
    followingWords: string[] = []
  ) =>
    perProductTokens.length > 0
      ? perProductTokens.some((productSet) =>
          allowDescription
            ? words.every((token) => productSet.features.has(token)) &&
              (allowsDescriptionFeature(words, precedingWords, followingWords)
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
  for (const match of clause.matchAll(CHIPSET_CLAIM_PATTERN)) {
    const chipWords = extractPhraseWords(match[0]).slice(0, -1);
    if (
      chipWords.length > 0 &&
      (perProductTokens.length > 0
        ? !perProductTokens.some((productSet) =>
            chipWords.every((token) => productSet.features.has(token))
          )
        : chipWords.some((token) => !returnedTokens.has(token)))
    ) {
      return true;
    }
  }
  for (const match of clause.matchAll(CAPITALIZED_PHRASE_PATTERN)) {
    const matchIndex = match.index ?? 0;
    const before = clause
      .slice(0, matchIndex)
      .split(/[.,;!?]/)
      .pop();
    const after = clause
      .slice(matchIndex + match[0].length)
      .split(/[.,;!?]/)[0];
    const words = extractPhraseWords(match[0]);
    if (
      words.length >= 2 &&
      !hasSingleProductMatch(
        words,
        true,
        extractPhraseWords(before ?? ''),
        extractPhraseWords(after ?? '')
      )
    ) {
      return true;
    }
  }
  for (const match of clause.matchAll(LOWERCASE_MODEL_NUMBER_PATTERN)) {
    const pred = match[1]?.toLowerCase() ?? '';
    if (NON_PRODUCT_PREDECESSOR_WORDS.has(pred)) continue;
    const matchIndex = match.index ?? 0;
    const before = clause
      .slice(0, matchIndex)
      .split(/[.,;!?]/)
      .pop();
    const matchEnd = matchIndex + match[0].length;
    const after = clause.slice(matchEnd).split(/[.,;!?]/)[0];
    const precedingWords = extractPhraseWords(before ?? '');
    if (
      CONDITIONAL_PRODUCT_PREDECESSOR_WORDS.has(pred) &&
      !(
        match[2] !== undefined &&
        precedingWords
          .slice(-2)
          .some((token) => KNOWN_BRAND_OR_LINE_TOKENS.has(token))
      )
    ) {
      continue;
    }
    const followingWords = extractPhraseWords(after ?? '');
    const baseWords = extractPhraseWords(match[0]);
    const trailingVersion =
      baseWords[0] === 'core' && baseWords[1] === 'ultra'
        ? clause
            .slice(matchEnd)
            .match(/^\s+(\d+[a-z]{0,2})\b/i)?.[1]
            ?.toLowerCase()
        : undefined;
    const words = trailingVersion ? [...baseWords, trailingVersion] : baseWords;
    const isDesc = allowsDescriptionFeature(
      words,
      precedingWords,
      followingWords
    );
    if (
      words.length > 0 &&
      !hasSingleProductMatch(words, isDesc, precedingWords, followingWords)
    ) {
      return true;
    }
  }
  return false;
}
