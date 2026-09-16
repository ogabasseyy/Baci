import type { PublishedClusterPost } from './content-cluster-types';
import { findCleanIdentifierEnd } from './find-clean-identifier-end';
import { getPostTokenGroups } from './get-post-token-groups';
import { hasShorthandIdentifierOccurrence } from './has-shorthand-identifier-occurrence';
import { matchesIdentifierDiscriminatorSegment } from './matches-identifier-discriminator-segment';
import { matchesVariantDiscriminatorTokens } from './matches-variant-discriminator-tokens';
import { tokenizeContentText } from './tokenize-content-text';

const MODEL_VARIANT_MARKER_TOKENS = new Set([
  'active',
  'classic',
  'edge',
  'fe',
  'flip',
  'fold',
  'lite',
  'max',
  'mini',
  'neo',
  'plus',
  'power',
  'prime',
  'pro',
  'se',
  'ultra',
  'xl',
]);
const MODEL_GENERATION_SUFFIX_PATTERN = /^\d{1,2}(?:st|nd|rd|th)?$/u;
const NUMERIC_MODEL_CONTEXT_TOKENS = new Set([
  'a',
  'fifa',
  'galaxy',
  'hot',
  'ipad',
  'iphone',
  'madden',
  'note',
  'pixel',
  'phone',
  'playstation',
  'ps4',
  'ps5',
  'series',
  'spark',
  'switch',
  'watch',
  'xbox',
]);
const NUMERIC_LISTICLE_CUE_TOKENS = new Set(['best', 'top']);

interface IdentifierOccurrenceOptions {
  brand?: string | null;
  knownBrands?: string[];
  brandAliases?: Record<string, readonly string[]>;
  discriminatorTokens?: string[];
  allowPartialDiscriminatorGroups?: boolean;
  allowMissingDiscriminatorGroups?: boolean;
  requireBrandBeforeIdentifier?: boolean;
  allowBrandAliasOverlap?: boolean;
}

function matchesTokenSequence(
  tokens: string[],
  expectedTokens: string[],
  startIndex: number
) {
  return expectedTokens.every(
    (token, offset) => tokens[startIndex + offset] === token
  );
}

const LISTICLE_COUNT_SEPARATORS = new Set([':', '—', '–', '-']);

function isListicleWhitespace(value: string | undefined): boolean {
  return value !== undefined && /\s/.test(value);
}

function isListicleDigit(value: string | undefined): boolean {
  return value !== undefined && value >= '0' && value <= '9';
}

/**
 * Matches "<identifier tokens> <separator> <digits>" (e.g. "iPhone 15 — 7")
 * with plain string scanning so identifier tokens are matched literally and
 * no dynamic RegExp is ever constructed.
 */
export function hasListicleCountSuffix(
  title: string,
  identifierTokens: string[]
): boolean {
  if (identifierTokens.length === 0) {
    return false;
  }
  const haystack = title.toLowerCase();
  const firstToken = identifierTokens[0]?.toLowerCase() ?? '';
  if (firstToken.length === 0) {
    return false;
  }
  const restTokens = identifierTokens
    .slice(1)
    .map((token) => token.toLowerCase());
  let searchFrom = 0;
  for (;;) {
    const matchIndex = haystack.indexOf(firstToken, searchFrom);
    if (matchIndex === -1) {
      return false;
    }
    let tokenEnd = matchIndex + firstToken.length;
    let matched = true;
    for (const token of restTokens) {
      let tokenStart = tokenEnd;
      while (isListicleWhitespace(haystack[tokenStart])) {
        tokenStart += 1;
      }
      if (
        tokenStart === tokenEnd ||
        !haystack.startsWith(token, tokenStart)
      ) {
        matched = false;
        break;
      }
      tokenEnd = tokenStart + token.length;
    }
    if (matched) {
      let separatorIndex = tokenEnd;
      while (isListicleWhitespace(haystack[separatorIndex])) {
        separatorIndex += 1;
      }
      const separator = haystack[separatorIndex];
      if (separator !== undefined && LISTICLE_COUNT_SEPARATORS.has(separator)) {
        let digitIndex = separatorIndex + 1;
        while (isListicleWhitespace(haystack[digitIndex])) {
          digitIndex += 1;
        }
        if (isListicleDigit(haystack[digitIndex])) {
          return true;
        }
      }
    }
    searchFrom = matchIndex + 1;
  }
}

function hasNumericModelContext(
  tokens: string[],
  startIndex: number,
  brand?: string | null
) {
  const previousToken = tokens[startIndex - 1] ?? '';
  if (NUMERIC_LISTICLE_CUE_TOKENS.has(previousToken)) {
    return false;
  }
  const brandTokens = (brand ?? '').toLowerCase().split(/[^a-z0-9]+/u);
  const previousComparisonBoundary = tokens.findLastIndex(
    (token, index) =>
      index < startIndex &&
      ['against', 'and', 'or', 'versus', 'vs'].includes(token)
  );
  const precedingComparisonSegment =
    previousComparisonBoundary >= 0
      ? tokens.slice(0, previousComparisonBoundary)
      : [];
  return (
    brandTokens.includes(previousToken) ||
    NUMERIC_MODEL_CONTEXT_TOKENS.has(previousToken) ||
    precedingComparisonSegment.some((token) =>
      NUMERIC_MODEL_CONTEXT_TOKENS.has(token)
    )
  );
}

function getBrandDistance(
  brandTokens: string[],
  identifierStart: number,
  identifierEnd: number,
  brandStart: number
) {
  const brandEnd = brandStart + brandTokens.length;
  if (brandEnd <= identifierStart) {
    return identifierStart - brandEnd;
  }
  if (brandStart >= identifierEnd) {
    return brandStart - identifierEnd;
  }
  return 0;
}

function isBrandQualifiedOccurrence(
  tokens: string[],
  identifierStart: number,
  identifierEnd: number,
  requestedBrand: string,
  knownBrands: string[],
  brandAliases: Record<string, readonly string[]>,
  requireBrandBeforeIdentifier: boolean,
  allowBrandAliasOverlap: boolean
) {
  const brandCandidates = Array.from(
    new Set([requestedBrand, ...knownBrands])
  ).flatMap((brand) =>
    [brand, ...(brandAliases[brand] ?? [])]
      .filter((candidate, index) => index === 0 || !(candidate in brandAliases))
      .map((candidate, index) => ({
        brand,
        isAlias: index > 0,
        tokens: tokenizeContentText(candidate),
      }))
      .filter(({ tokens: brandTokens }) => brandTokens.length > 0)
  );
  let nearestBrand: string | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of brandCandidates) {
    for (
      let index = 0;
      index <= tokens.length - candidate.tokens.length;
      index += 1
    ) {
      if (!matchesTokenSequence(tokens, candidate.tokens, index)) {
        continue;
      }
      const isRetainedRequestedBrand =
        candidate.brand === requestedBrand &&
        index === identifierStart &&
        index + candidate.tokens.length <= identifierEnd;
      if (
        requireBrandBeforeIdentifier &&
        index + candidate.tokens.length > identifierStart &&
        !(
          candidate.isAlias &&
          allowBrandAliasOverlap &&
          index <= identifierStart
        ) &&
        !isRetainedRequestedBrand
      ) {
        continue;
      }
      const distance = getBrandDistance(
        candidate.tokens,
        identifierStart,
        identifierEnd,
        index
      );
      if (distance < nearestDistance) {
        nearestBrand = candidate.brand;
        nearestDistance = distance;
      }
    }
  }

  return nearestBrand === requestedBrand;
}

/** Finds a model phrase while excluding obvious variant and generation suffixes. */
export function hasCleanIdentifierOccurrence(
  post: PublishedClusterPost,
  identifierTokens: string[],
  options: IdentifierOccurrenceOptions = {}
) {
  if (identifierTokens.length === 0) {
    return false;
  }

  const postTokenGroups = getPostTokenGroups(post);

  if (
    postTokenGroups.some((postTokens) =>
      hasShorthandIdentifierOccurrence(
        postTokens,
        identifierTokens,
        (prefixStart, prefixEnd, occurrenceTokens) => {
          const hasBrandQualification = options.brand
            ? isBrandQualifiedOccurrence(
                postTokens,
                prefixStart,
                prefixEnd,
                options.brand,
                options.knownBrands ?? [],
                options.brandAliases ?? {},
                options.requireBrandBeforeIdentifier ?? false,
                options.allowBrandAliasOverlap ?? false
              )
            : true;
          const hasDiscriminatorQualification = options.discriminatorTokens
            ?.length
            ? matchesVariantDiscriminatorTokens(
                occurrenceTokens,
                options.discriminatorTokens,
                options.allowPartialDiscriminatorGroups ?? false,
                options.allowMissingDiscriminatorGroups ?? false
              )
            : true;
          return hasBrandQualification && hasDiscriminatorQualification;
        }
      )
    )
  ) {
    return true;
  }

  return postTokenGroups.some((postTokens) =>
    postTokens.some((_, startIndex) => {
      const identifierEnd = findCleanIdentifierEnd(
        postTokens,
        identifierTokens,
        startIndex
      );
      const matchesIdentifier = identifierEnd !== null;
      const suffix = postTokens[identifierEnd ?? startIndex] ?? '';
      const nextSuffix = postTokens[(identifierEnd ?? startIndex) + 1] ?? '';
      const followingSuffix =
        postTokens[(identifierEnd ?? startIndex) + 2] ?? '';
      const hasModelContext = identifierTokens.every((token) =>
        /^\d+$/u.test(token)
      )
        ? hasNumericModelContext(postTokens, startIndex, options.brand)
        : true;
      const listicleSuffix = hasListicleCountSuffix(
        post.title,
        identifierTokens
      );
      const displaySizeSuffix =
        (/^\d{1,2}$/u.test(suffix) && ['in', 'inch'].includes(nextSuffix)) ||
        (/^\d{1,2}$/u.test(suffix) &&
          /^\d$/u.test(nextSuffix) &&
          ['in', 'inch'].includes(followingSuffix));
      const splitCapacitySuffix =
        /^\d{1,4}$/u.test(suffix) && ['gb', 'tb', 'mb'].includes(nextSuffix);
      if (
        !matchesIdentifier ||
        !hasModelContext ||
        MODEL_VARIANT_MARKER_TOKENS.has(suffix) ||
        (MODEL_GENERATION_SUFFIX_PATTERN.test(suffix) &&
          !listicleSuffix &&
          !displaySizeSuffix &&
          !splitCapacitySuffix)
      ) {
        return false;
      }

      if (
        options.discriminatorTokens?.length &&
        !matchesIdentifierDiscriminatorSegment(
          postTokens,
          startIndex,
          identifierEnd ?? startIndex,
          options.discriminatorTokens,
          options.allowPartialDiscriminatorGroups ?? false,
          options.allowMissingDiscriminatorGroups ?? false
        )
      ) {
        return false;
      }

      return options.brand
        ? isBrandQualifiedOccurrence(
            postTokens,
            startIndex,
            identifierEnd ?? startIndex,
            options.brand,
            options.knownBrands ?? [],
            options.brandAliases ?? {},
            options.requireBrandBeforeIdentifier ?? false,
            options.allowBrandAliasOverlap ?? false
          )
        : true;
    })
  );
}
