import {
  CONTENT_CLUSTER_SUPPORT,
  CONTENT_KIND_TOKENS,
} from '@/config/storefront-content-clusters';
import {
  DEDICATED_GAMING_LAPTOP_TOKENS,
  EXCLUDED_GAMING_LAPTOP_SUBJECTS,
} from '@/config/storefront-gaming-laptop-taxonomy';
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
    'category' | 'excerpt' | 'keywords' | 'tags' | 'title'
  > {
  merchant_intent?: unknown;
  merchant_intent_source?: unknown;
}

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
  if (normalizedNeedle.length === 0) return false;
  let searchFrom = 0;
  for (;;) {
    const matchIndex = haystack.indexOf(normalizedNeedle, searchFrom);
    if (matchIndex === -1) return false;
    if (
      isPhraseBoundary(haystack[matchIndex - 1]) &&
      isPhraseBoundary(haystack[matchIndex + normalizedNeedle.length])
    ) {
      return true;
    }
    searchFrom = matchIndex + 1;
  }
}

type ClusterSupportEntry = [
  SupportedClusterCategory,
  (typeof CONTENT_CLUSTER_SUPPORT)[SupportedClusterCategory],
];

const hasGamingLaptopPhrase = (t: string) =>
  hasPhrase(t, 'gaming laptop') || hasPhrase(t, 'gaming laptops');

const hasLaptopPhrase = (t: string) =>
  hasPhrase(t, 'laptop') || hasPhrase(t, 'laptops') || hasGamingLaptopPhrase(t);

const isExemptSubject = (s: string, t: string, hasGaming: boolean) =>
  s === 'gpu' || s === 'gpus' || s.startsWith('graphics card')
    ? hasGaming
    : s === 'desktop' || s === 'desktops'
      ? hasPhrase(t, 'desktop replacement') || hasPhrase(t, 'desktop-class')
      : s === 'monitor' || s === 'monitors'
        ? hasGaming &&
          (hasPhrase(t, 'pairing') ||
            hasPhrase(t, 'pairings') ||
            hasPhrase(t, 'paired'))
        : s === 'accessories' || s === 'accessory'
          ? hasGaming &&
            (hasPhrase(t, 'with free accessories') ||
              hasPhrase(t, 'with accessories') ||
              hasPhrase(t, 'bundled accessories'))
          : false;

function hasExcludedGamingLaptopSubject(
  targetText: string,
  hasLaptopInContext = false
): boolean {
  const hasLaptop = hasLaptopInContext || hasLaptopPhrase(targetText);
  const hasGaming = hasGamingLaptopPhrase(targetText);
  return EXCLUDED_GAMING_LAPTOP_SUBJECTS.some(
    (s) =>
      !(hasLaptop && isExemptSubject(s, targetText, hasGaming)) &&
      hasPhrase(targetText, s)
  );
}

function isDedicatedGamingLaptopContent(
  title: string,
  content: string,
  excerpt = ''
): boolean {
  const hasLaptop = hasLaptopPhrase(title);
  const hasDedicated = DEDICATED_GAMING_LAPTOP_TOKENS.some((t) =>
    hasPhrase(title, t)
  );
  if ((hasLaptop && hasDedicated) || hasGamingLaptopPhrase(title)) {
    return !hasExcludedGamingLaptopSubject(title);
  }
  if (!hasDedicated) return false;
  const combined = [title, excerpt].filter(Boolean).join(' ');
  const target = hasLaptopPhrase(combined)
    ? combined
    : hasLaptopPhrase(content)
      ? content
      : null;
  return target
    ? !hasExcludedGamingLaptopSubject(target, hasGamingLaptopPhrase(target))
    : false;
}

function inferCategorySlug(
  haystack: string,
  contentHaystack: string,
  tokens: string[],
  explicitCategory: string,
  title?: string,
  excerpt?: string
): SupportedClusterCategory | null {
  const explicitMatch = (
    Object.entries(CONTENT_CLUSTER_SUPPORT) as ClusterSupportEntry[]
  )
    .flatMap(([categorySlug, support]) =>
      support.categoryNames.map((name) => ({ categorySlug, name }))
    )
    .sort((left, right) => right.name.length - left.name.length)
    .find(({ name }) => hasPhrase(explicitCategory, name));

  if (explicitMatch) {
    const slug = explicitMatch.categorySlug;
    if (
      (slug === 'gaming' || slug === 'laptops') &&
      isDedicatedGamingLaptopContent(
        title ?? '',
        contentHaystack,
        excerpt ?? ''
      )
    ) {
      return 'gaming-laptops';
    }
    if (slug === 'gaming-laptops') {
      return hasExcludedGamingLaptopSubject(title ?? '', true)
        ? 'laptops'
        : 'gaming-laptops';
    }
    return slug;
  }

  let bestCategory: SupportedClusterCategory | null = null;
  let bestScore = 0;

  for (const [categorySlug, support] of Object.entries(
    CONTENT_CLUSTER_SUPPORT
  ) as ClusterSupportEntry[]) {
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

function resolveKind(
  input: InferContentClusterContextInput,
  inferredKind: ContentClusterKind | null,
  haystack: string
): ContentClusterKind | null {
  // The public RPC excludes stale classifications. Reject malformed metadata
  // here too so older adapters and unclassified rows retain the heuristic path.
  const source = input.merchant_intent_source;
  if (
    source !== 'merchant_declared' &&
    source !== 'verified_receipt' &&
    source !== 'reviewed'
  ) {
    return inferredKind;
  }
  switch (input.merchant_intent) {
    case 'buying-guide':
      return inferredKind === 'best-in-nigeria' &&
        hasPhrase(haystack, 'nigeria') &&
        (hasPhrase(haystack, 'best') || hasPhrase(haystack, 'top'))
        ? inferredKind
        : 'buyer-guide';
    case 'comparison':
      return 'decision-support';
    case 'repair-guide':
      return 'troubleshooting';
    case 'news':
      return null;
    default:
      return inferredKind;
  }
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
  if (!categorySlug) return [];

  return Object.entries(CONTENT_CLUSTER_SUPPORT[categorySlug].priceBandAliases)
    .filter(([, aliases]) =>
      aliases.some((alias) => hasPhrase(haystack, alias))
    )
    .map(([slug]) => slug);
}

export function inferContentClusterContext(
  input: InferContentClusterContextInput
): InferredContentClusterContext {
  const contentText = [
    input.title,
    input.excerpt,
    ...(input.tags ?? []),
    ...(input.keywords ?? []),
  ];
  const contentHaystack = normalizeText(contentText.join(' '));
  const haystack = normalizeText([input.category, ...contentText].join(' '));
  const tokens = tokenize([input.category, ...contentText]);
  const explicitCategory = normalizeText(input.category);
  const categorySlug = inferCategorySlug(
    haystack,
    contentHaystack,
    tokens,
    explicitCategory,
    normalizeText(input.title),
    normalizeText(input.excerpt)
  );

  return {
    categorySlug,
    kind: resolveKind(input, inferKind(haystack), haystack),
    brands: inferBrands(categorySlug, haystack),
    matchedPriceBands: inferPriceBands(categorySlug, haystack),
    tokens,
  };
}
