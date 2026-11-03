import type { ClusterSupport } from '@/config/storefront-content-cluster-shared';
import {
  CONTENT_CLUSTER_SUPPORT,
  CONTENT_KIND_TOKENS,
  EXPLICIT_CONTENT_CLUSTER_CATEGORIES,
} from '@/config/storefront-content-clusters';
import {
  DEDICATED_GAMING_LAPTOP_TOKENS,
  EXCLUDED_CATEGORY_MAP,
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

const tokenize = (values: Array<string | null | undefined>) => [
  ...new Set(values.flatMap(tokenizeContentText)),
];

const isPhraseBoundary = (v?: string): boolean => !v || /[^a-z0-9]/.test(v);

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

const hasGamingLaptopPhrase = (t: string) =>
  hasPhrase(t, 'gaming laptop') || hasPhrase(t, 'gaming laptops');

const hasLaptopPhrase = (t: string) =>
  hasPhrase(t, 'laptop') || hasPhrase(t, 'laptops') || hasGamingLaptopPhrase(t);

const isExemptSubject = (s: string, t: string, hasGaming: boolean) =>
  s === 'gpu' || s === 'gpus' || s.startsWith('graphics card')
    ? hasGaming &&
      !hasPhrase(t, 'gaming laptop gpu') &&
      !hasPhrase(t, 'gaming laptop graphics card')
    : (['desktop', 'monitor', 'accessories', 'battery'] as const).some(
        (k) =>
          (k === 'battery'
            ? s.startsWith('laptop batter')
            : s.startsWith(k.slice(0, 7))) &&
          (k === 'desktop' || k === 'battery' || hasGaming) &&
          GAMING_LAPTOP_EXEMPT_PHRASES[k].some((p) => hasPhrase(t, p))
      );

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

const getExcludedSubjectCategory = (t: string): SupportedClusterCategory =>
  (EXCLUDED_CATEGORY_MAP.find(([, phrases]) =>
    phrases.some((p) => hasPhrase(t, p))
  )?.[0] as SupportedClusterCategory) ?? 'accessories';

const hasLaptopSubjectEvidence = (
  title?: string,
  excerpt?: string,
  haystack?: string
) => {
  const target = getSubjectTarget(title, excerpt);
  if (hasLaptopPhrase(target)) return true;
  if (!haystack || !hasLaptopPhrase(haystack)) return false;
  const gameTitle =
    hasPhrase(title ?? '', 'game') && !hasGamingLaptopPhrase(target);
  return (
    !gameTitle &&
    !(hasPhrase(haystack, 'blade') && !hasPhrase(haystack, 'razer'))
  );
};

function isDedicatedGamingLaptopContent(
  title: string,
  content: string,
  excerpt = ''
): boolean {
  if (['handheld', 'steam deck', 'rog ally'].some((t) => hasPhrase(title, t))) {
    return false;
  }
  if (hasTitleLaptopSubject(title)) {
    return !hasExcludedGamingLaptopSubject(title);
  }
  const hasDedicated = DEDICATED_GAMING_LAPTOP_TOKENS.some((t) =>
    hasPhrase(title, t)
  );
  if (!hasDedicated) return false;
  const c = [title, excerpt].filter(Boolean).join(' ');
  const target = hasLaptopPhrase(c)
    ? c
    : hasPhrase(title, 'rtx') ||
        hasPhrase(title, 'geforce') ||
        !hasLaptopPhrase(content)
      ? null
      : content;
  return Boolean(
    target &&
      !hasExcludedGamingLaptopSubject(target, hasGamingLaptopPhrase(target))
  );
}

function inferCategorySlug(
  haystack: string,
  contentHaystack: string,
  tokens: string[],
  explicitCategory: string,
  title?: string,
  excerpt?: string
): SupportedClusterCategory | null {
  const explicitMatch = EXPLICIT_CONTENT_CLUSTER_CATEGORIES.find(({ name }) =>
    hasPhrase(explicitCategory, name)
  );

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
      const target = getSubjectTarget(title, excerpt);
      if (!hasExcludedGamingLaptopSubject(target, true))
        return 'gaming-laptops';
      return getExcludedSubjectCategory(
        title && hasExcludedGamingLaptopSubject(title, true) ? title : target
      );
    }
    return slug;
  }

  let best: { category: SupportedClusterCategory; score: number } | null = null;

  for (const [slug, support] of Object.entries(CONTENT_CLUSTER_SUPPORT) as [
    SupportedClusterCategory,
    ClusterSupport,
  ][]) {
    if (
      slug === 'gaming-laptops' &&
      (!hasLaptopSubjectEvidence(title, excerpt, haystack) ||
        hasExcludedGamingLaptopSubject(getSubjectTarget(title, excerpt), true))
    ) {
      continue;
    }
    const score = support.articleTokens.filter(
      (token) => tokens.includes(token) || hasPhrase(haystack, token)
    ).length;
    if (score > (best?.score ?? 0)) best = { category: slug, score };
  }

  return best?.category ?? null;
}

function inferKind(haystack: string): ContentClusterKind | null {
  let best: { kind: ContentClusterKind; score: number } | null = null;
  for (const [kind, phrases] of Object.entries(CONTENT_KIND_TOKENS) as [
    ContentClusterKind,
    readonly string[],
  ][]) {
    const score = phrases.filter((p) => hasPhrase(haystack, p)).length;
    if (score > (best?.score ?? 0)) best = { kind, score };
  }
  return best?.kind ?? null;
}

function resolveKind(
  input: InferContentClusterContextInput,
  inferredKind: ContentClusterKind | null,
  haystack: string
): ContentClusterKind | null {
  const source = String(input.merchant_intent_source ?? '');
  if (!VALID_MERCHANT_INTENT_SOURCES.has(source as never)) return inferredKind;
  if (input.merchant_intent === 'buying-guide') {
    return inferredKind === 'best-in-nigeria' &&
      hasPhrase(haystack, 'nigeria') &&
      (hasPhrase(haystack, 'best') || hasPhrase(haystack, 'top'))
      ? inferredKind
      : 'buyer-guide';
  }
  const intent = String(input.merchant_intent ?? '');
  return Object.hasOwn(MERCHANT_INTENT_CLUSTER_KIND_MAP, intent)
    ? MERCHANT_INTENT_CLUSTER_KIND_MAP[intent]
    : inferredKind;
}

function inferBrands(
  categorySlug: SupportedClusterCategory | null,
  haystack: string
) {
  const dict = categorySlug
    ? Object.entries(CONTENT_CLUSTER_SUPPORT[categorySlug].brandTokens)
    : Object.values(CONTENT_CLUSTER_SUPPORT).flatMap((s) =>
        Object.entries(s.brandTokens)
      );
  return [
    ...new Set(
      dict
        .filter(([, a]) =>
          (a as readonly string[]).some((alias) => hasPhrase(haystack, alias))
        )
        .map(([brand]) => brand)
    ),
  ];
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
  const allText = [input.category, ...contentText];
  const haystack = normalizeText(allText.join(' '));
  const tokens = tokenize(allText);
  const categorySlug = inferCategorySlug(
    haystack,
    normalizeText(contentText.join(' ')),
    tokens,
    normalizeText(input.category),
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
