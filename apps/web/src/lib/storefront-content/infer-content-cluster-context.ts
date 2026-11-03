import {
  CONTENT_CLUSTER_SUPPORT,
  CONTENT_KIND_TOKENS,
} from '@/config/storefront-content-clusters';
import {
  DEDICATED_GAMING_LAPTOP_TOKENS,
  EXCLUDED_GAMING_LAPTOP_SUBJECTS,
  GAMING_LAPTOP_EXEMPT_PHRASES,
} from '@/config/storefront-gaming-laptop-taxonomy';
import {
  MERCHANT_INTENT_CLUSTER_KIND_MAP,
  VALID_MERCHANT_INTENT_SOURCES,
} from '@/config/storefront-merchant-intent';
import { applyJoinedTitleCorrections } from './apply-joined-title-corrections';
import type {
  ContentClusterKind,
  InferContentClusterContextInput,
  InferredContentClusterContext,
  SupportedClusterCategory,
} from './content-cluster-types';
import { normalizeContentCurrencyTokens } from './normalize-content-currency-tokens';
import { tokenizeContentText } from './tokenize-content-text';

const normalizeText = (v: string | null | undefined) =>
  normalizeContentCurrencyTokens(
    applyJoinedTitleCorrections(v?.toLowerCase().trim() ?? '')
  );

const tokenize = (values: Array<string | null | undefined>) =>
  Array.from(new Set(values.flatMap(tokenizeContentText)));

const isPhraseBoundary = (v: string | undefined): boolean =>
  v === undefined || /[^a-z0-9]/.test(v);

function hasPhrase(haystack: string, needle: string) {
  const norm = normalizeText(needle);
  if (norm.length === 0) return false;
  let from = 0;
  for (;;) {
    const idx = haystack.indexOf(norm, from);
    if (idx === -1) return false;
    if (
      isPhraseBoundary(haystack[idx - 1]) &&
      isPhraseBoundary(haystack[idx + norm.length])
    ) {
      return true;
    }
    from = idx + 1;
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
    ? hasGaming &&
      !hasPhrase(t, 'gaming laptop gpu') &&
      !hasPhrase(t, 'gaming laptop graphics card')
    : s.startsWith('desktop')
      ? GAMING_LAPTOP_EXEMPT_PHRASES.desktop.some((p) => hasPhrase(t, p))
      : s.startsWith('monitor')
        ? hasGaming &&
          GAMING_LAPTOP_EXEMPT_PHRASES.monitor.some((p) => hasPhrase(t, p))
        : s.startsWith('accessor')
          ? hasGaming &&
            GAMING_LAPTOP_EXEMPT_PHRASES.accessories.some((p) =>
              hasPhrase(t, p)
            )
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

const hasTitleLaptopSubject = (t: string) =>
  hasGamingLaptopPhrase(t) ||
  (hasLaptopPhrase(t) &&
    DEDICATED_GAMING_LAPTOP_TOKENS.some((k) => hasPhrase(t, k)));

const getSubjectTarget = (title?: string, excerpt?: string) =>
  hasTitleLaptopSubject(title ?? '')
    ? (title ?? '')
    : [title, excerpt].filter(Boolean).join(' ');

function isDedicatedGamingLaptopContent(
  title: string,
  content: string,
  excerpt = ''
): boolean {
  if (hasTitleLaptopSubject(title)) {
    return !hasExcludedGamingLaptopSubject(title);
  }
  const hasDedicated = DEDICATED_GAMING_LAPTOP_TOKENS.some((t) =>
    hasPhrase(title, t)
  );
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
      return hasExcludedGamingLaptopSubject(
        getSubjectTarget(title, excerpt),
        true
      )
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
    if (
      categorySlug === 'gaming-laptops' &&
      (!hasLaptopPhrase(haystack) ||
        hasExcludedGamingLaptopSubject(getSubjectTarget(title, excerpt), true))
    ) {
      continue;
    }
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
    const score = phrases.filter((p) => hasPhrase(haystack, p)).length;
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
  const source = String(input.merchant_intent_source ?? '');
  if (!VALID_MERCHANT_INTENT_SOURCES.has(source as never)) {
    return inferredKind;
  }
  if (input.merchant_intent === 'buying-guide') {
    return inferredKind === 'best-in-nigeria' &&
      hasPhrase(haystack, 'nigeria') &&
      (hasPhrase(haystack, 'best') || hasPhrase(haystack, 'top'))
      ? inferredKind
      : 'buyer-guide';
  }
  const intent =
    typeof input.merchant_intent === 'string' ? input.merchant_intent : '';
  return Object.hasOwn(MERCHANT_INTENT_CLUSTER_KIND_MAP, intent)
    ? MERCHANT_INTENT_CLUSTER_KIND_MAP[intent]
    : inferredKind;
}

function inferBrands(
  categorySlug: SupportedClusterCategory | null,
  haystack: string
) {
  const support = categorySlug ? CONTENT_CLUSTER_SUPPORT[categorySlug] : null;
  const brandTokens = (
    support
      ? Object.entries(support.brandTokens)
      : Object.values(CONTENT_CLUSTER_SUPPORT).flatMap((e) =>
          Object.entries(e.brandTokens)
        )
  ) as [string, readonly string[]][];

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
    .filter(([, a]) => a.some((alias) => hasPhrase(haystack, alias)))
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
