import {
  CONTENT_CLUSTER_SUPPORT,
  CONTENT_KIND_TOKENS,
} from '@/config/storefront-content-clusters';
import { applyJoinedTitleCorrections } from './apply-joined-title-corrections';
import type {
  ContentClusterKind,
  InferredContentClusterContext,
  PublishedClusterPost,
  SupportedClusterCategory,
} from './content-cluster-types';
import { normalizeContentCurrencyTokens } from './normalize-content-currency-tokens';
import { tokenizeContentText } from './tokenize-content-text';

interface InferContentClusterContextInput
  extends Pick<
    PublishedClusterPost,
    'title' | 'excerpt' | 'category' | 'tags' | 'keywords'
  > {}

function normalizeText(value: string | null | undefined) {
  return normalizeContentCurrencyTokens(
    applyJoinedTitleCorrections(value?.toLowerCase().trim() ?? '')
  );
}

function tokenize(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.flatMap(tokenizeContentText)));
}

function isPhraseBoundary(value: string | undefined): boolean {
  return value === undefined || /[^a-z0-9]/.test(value);
}

function hasPhrase(haystack: string, needle: string) {
  const normalizedNeedle = normalizeText(needle);
  if (normalizedNeedle.length === 0) {
    return false;
  }
  let searchFrom = 0;
  for (;;) {
    const matchIndex = haystack.indexOf(normalizedNeedle, searchFrom);
    if (matchIndex === -1) {
      return false;
    }
    if (
      isPhraseBoundary(haystack[matchIndex - 1]) &&
      isPhraseBoundary(haystack[matchIndex + normalizedNeedle.length])
    ) {
      return true;
    }
    searchFrom = matchIndex + 1;
  }
}

function inferCategorySlug(
  haystack: string,
  tokens: string[],
  explicitCategory: string
): SupportedClusterCategory | null {
  const explicitMatch = (
    Object.entries(CONTENT_CLUSTER_SUPPORT) as [
      SupportedClusterCategory,
      (typeof CONTENT_CLUSTER_SUPPORT)[SupportedClusterCategory],
    ][]
  )
    .flatMap(([categorySlug, support]) =>
      support.categoryNames.map((name) => ({ categorySlug, name }))
    )
    .sort((left, right) => right.name.length - left.name.length)
    .find(({ name }) => hasPhrase(explicitCategory, name));

  if (explicitMatch) {
    return explicitMatch.categorySlug;
  }

  let bestCategory: SupportedClusterCategory | null = null;
  let bestScore = 0;

  for (const [categorySlug, support] of Object.entries(
    CONTENT_CLUSTER_SUPPORT
  ) as [
    SupportedClusterCategory,
    (typeof CONTENT_CLUSTER_SUPPORT)[SupportedClusterCategory],
  ][]) {
    const score = support.articleTokens.filter(
      (token) => tokens.includes(token) || hasPhrase(haystack, token)
    ).length;

    if (score > bestScore) {
      bestScore = score;
      bestCategory = categorySlug;
    }
  }

  return bestScore > 0 ? bestCategory : null;
}

function inferKind(haystack: string): ContentClusterKind | null {
  let bestKind: ContentClusterKind | null = null;
  let bestScore = 0;

  for (const [kind, phrases] of Object.entries(CONTENT_KIND_TOKENS) as [
    ContentClusterKind,
    readonly string[],
  ][]) {
    const score = phrases.filter((phrase) =>
      hasPhrase(haystack, phrase)
    ).length;

    if (score > bestScore) {
      bestScore = score;
      bestKind = kind;
    }
  }

  return bestScore > 0 ? bestKind : null;
}

function inferBrands(
  categorySlug: SupportedClusterCategory | null,
  haystack: string
) {
  const support = categorySlug ? CONTENT_CLUSTER_SUPPORT[categorySlug] : null;
  const brandTokens: [string, readonly string[]][] = support
    ? (Object.entries(support.brandTokens) as [string, readonly string[]][])
    : Object.values(CONTENT_CLUSTER_SUPPORT).flatMap(
        (entry) =>
          Object.entries(entry.brandTokens) as [string, readonly string[]][]
      );

  return Array.from(
    new Set(
      brandTokens
        .filter(([, aliases]) =>
          aliases.some((alias) => hasPhrase(haystack, alias))
        )
        .map(([brand]) => brand)
    )
  );
}

function inferPriceBands(
  categorySlug: SupportedClusterCategory | null,
  haystack: string
) {
  if (!categorySlug) {
    return [];
  }

  return (
    Object.entries(CONTENT_CLUSTER_SUPPORT[categorySlug].priceBandAliases) as [
      string,
      readonly string[],
    ][]
  )
    .filter(([, aliases]) =>
      aliases.some((alias) => hasPhrase(haystack, alias))
    )
    .map(([slug]) => slug);
}

export function inferContentClusterContext(
  input: InferContentClusterContextInput
): InferredContentClusterContext {
  const haystack = normalizeText(
    [
      input.title,
      input.excerpt,
      input.category,
      ...(input.tags ?? []),
      ...(input.keywords ?? []),
    ].join(' ')
  );
  const tokens = tokenize([
    input.title,
    input.excerpt,
    input.category,
    ...(input.tags ?? []),
    ...(input.keywords ?? []),
  ]);
  const explicitCategory = normalizeText(input.category);
  const categorySlug = inferCategorySlug(haystack, tokens, explicitCategory);

  return {
    categorySlug,
    kind: inferKind(haystack),
    brands: inferBrands(categorySlug, haystack),
    matchedPriceBands: inferPriceBands(categorySlug, haystack),
    tokens,
  };
}
