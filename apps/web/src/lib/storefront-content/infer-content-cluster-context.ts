import type { ClusterSupport } from '@/config/storefront-content-cluster-shared';
import {
  CONTENT_CLUSTER_SUPPORT,
  CONTENT_KIND_TOKENS,
  EXPLICIT_CONTENT_CLUSTER_CATEGORIES,
} from '@/config/storefront-content-clusters';
import {
  AMBIGUOUS_FAMILY_ALIAS_PARENT,
  DEDICATED_GAMING_LAPTOP_TOKENS,
  EXCLUDED_CATEGORY_MAP,
  EXCLUDED_GAMING_LAPTOP_SUBJECTS,
  EXCLUDED_HANDHELD_TOKENS,
  GAMING_LAPTOP_EXEMPT_PHRASES,
  NON_EXEMPT_GPU_PHRASES,
  NON_EXEMPT_KEYBOARD_PHRASES,
  NON_EXEMPT_MONITOR_PHRASES,
} from '@/config/storefront-gaming-laptop-taxonomy';
import {
  MERCHANT_INTENT_CLUSTER_KIND_MAP,
  VALID_MERCHANT_INTENT_SOURCES,
} from '@/config/storefront-merchant-intent';
import type {
  ContentClusterKind,
  InferContentClusterContextInput,
  InferredContentClusterContext,
  SupportedClusterCategory,
} from './content-cluster-types';
import { hasPhrase } from './has-content-cluster-phrase';
import { normalizeClusterText as normalizeText } from './normalize-cluster-text';
import { tokenizeContentText } from './tokenize-content-text';

const tokenize = (values: Array<string | null | undefined>) => [
  ...new Set(values.flatMap(tokenizeContentText)),
];

const hasGamingLaptopPhrase = (t: string) =>
  hasPhrase(t, 'gaming laptop') ||
  hasPhrase(t, 'gaming laptops') ||
  hasPhrase(t, 'gaming-laptop') ||
  hasPhrase(t, 'gaming-laptops');

const hasLaptopPhrase = (t: string) =>
  hasPhrase(t, 'laptop') || hasPhrase(t, 'laptops') || hasGamingLaptopPhrase(t);

const isExemptSubject = (s: string, rawT: string, hasGaming: boolean) => {
  const t = rawT.replace(/gaming-laptop(s?)/g, 'gaming laptop$1');
  return s === 'gpu' || s === 'gpus' || s.startsWith('graphics card')
    ? hasGaming && !NON_EXEMPT_GPU_PHRASES.some((p) => hasPhrase(t, p))
    : s.startsWith('monitor')
      ? hasGaming &&
        !/\bmonitors?\b.*\blaptops?\b/.test(t) &&
        !NON_EXEMPT_MONITOR_PHRASES.some((p) => hasPhrase(t, p)) &&
        GAMING_LAPTOP_EXEMPT_PHRASES.monitor.some((p) => hasPhrase(t, p))
      : s.startsWith('keyboard')
        ? hasGaming && !NON_EXEMPT_KEYBOARD_PHRASES.some((p) => hasPhrase(t, p))
        : (['desktop', 'accessories', 'battery'] as const).some(
            (k) =>
              (k === 'battery'
                ? s.startsWith('laptop batter')
                : s.startsWith(k.slice(0, 7))) &&
              (k === 'desktop' || k === 'battery' || hasGaming) &&
              GAMING_LAPTOP_EXEMPT_PHRASES[k].some((p) => hasPhrase(t, p))
          );
};

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

const hasQualifiedFamilyToken = (t: string, ctx = t) =>
  DEDICATED_GAMING_LAPTOP_TOKENS.some(
    (k) =>
      hasPhrase(t, k) &&
      (!AMBIGUOUS_FAMILY_ALIAS_PARENT[k] ||
        hasPhrase(ctx, AMBIGUOUS_FAMILY_ALIAS_PARENT[k]) ||
        hasGamingLaptopPhrase(ctx))
  );

const hasTitleLaptopSubject = (t: string, ctx = t) =>
  hasGamingLaptopPhrase(t) ||
  (hasLaptopPhrase(t) && hasQualifiedFamilyToken(t, ctx));

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
  if (hasPhrase(title ?? '', 'game') && !hasGamingLaptopPhrase(target)) {
    return false;
  }
  if (hasLaptopPhrase(target)) return true;
  if (!haystack || !hasLaptopPhrase(haystack)) return false;
  return !(hasPhrase(haystack, 'blade') && !hasPhrase(haystack, 'razer'));
};

function isDedicatedGamingLaptopContent(
  title: string,
  content: string,
  excerpt = ''
): boolean {
  if (EXCLUDED_HANDHELD_TOKENS.some((t) => hasPhrase(title, t))) {
    return false;
  }
  const c = [title, excerpt].filter(Boolean).join(' ');
  const full = [c, content].join(' ');
  if (hasPhrase(title, 'game') && !hasGamingLaptopPhrase(c)) return false;
  if (hasTitleLaptopSubject(title, full)) {
    return !hasExcludedGamingLaptopSubject(title);
  }
  if (!hasQualifiedFamilyToken(title, full)) return false;
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
    if (slug !== 'gaming-laptops') return slug;
    if (hasExcludedGamingLaptopSubject(explicitCategory, true)) {
      return getExcludedSubjectCategory(explicitCategory);
    }
    return title && hasExcludedGamingLaptopSubject(title, true)
      ? getExcludedSubjectCategory(title)
      : 'gaming-laptops';
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
    const score =
      support.articleTokens.filter(
        (token) => tokens.includes(token) || hasPhrase(haystack, token)
      ).length +
      (slug === 'gaming-laptops' && hasQualifiedFamilyToken(haystack) ? 1 : 0);
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
  const support = categorySlug
    ? [CONTENT_CLUSTER_SUPPORT[categorySlug]]
    : Object.values(CONTENT_CLUSTER_SUPPORT);
  return [
    ...new Set(
      support
        .flatMap(
          (s) => Object.entries(s.brandTokens) as [string, readonly string[]][]
        )
        .filter(([, a]) =>
          a.some((alias) =>
            AMBIGUOUS_FAMILY_ALIAS_PARENT[alias]
              ? hasPhrase(haystack, alias) &&
                (hasPhrase(haystack, AMBIGUOUS_FAMILY_ALIAS_PARENT[alias]) ||
                  categorySlug === 'gaming-laptops')
              : hasPhrase(haystack, alias)
          )
        )
        .map(([brand]) => brand)
    ),
  ];
}

const inferPriceBands = (
  slug: SupportedClusterCategory | null,
  haystack: string
) =>
  slug
    ? Object.entries(CONTENT_CLUSTER_SUPPORT[slug].priceBandAliases)
        .filter(([, a]) => a.some((alias) => hasPhrase(haystack, alias)))
        .map(([band]) => band)
    : [];

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
