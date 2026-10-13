import type { ClusterSupport } from '@/config/storefront-content-cluster-shared';
import { CONTENT_CLUSTER_SUPPORT } from '@/config/storefront-content-clusters';
import type { BuildCommercialGuideLinksContext } from './content-cluster-types';
import { getProductModelIdentifiers } from './get-product-model-identifiers';
import { normalizeContentCurrencyTokens } from './normalize-content-currency-tokens';

const MAX_SEARCH_QUERY_LENGTH = 512;
const MAX_SEARCH_TERM_LENGTH = 80;
const WEBSEARCH_OPERATOR_WORDS = new Set(['and', 'not', 'or']);
const INDEX_METADATA_TOKEN_PATTERN =
  /^\d+(?:gb|tb|mb|g|inch|in|hz|mah|mp|w|v|mm|cm|kg)$/u;
const UTF8_ENCODER = new TextEncoder();

function normalizeSearchTerm(value: string): string {
  const words = normalizeContentCurrencyTokens(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/u)
    .map((word) => word.trim())
    .filter(
      (word) =>
        word.length > 0 &&
        word.length <= MAX_SEARCH_TERM_LENGTH &&
        !WEBSEARCH_OPERATOR_WORDS.has(word) &&
        !INDEX_METADATA_TOKEN_PATTERN.test(word)
    );
  const accepted: string[] = [];

  for (const word of words) {
    const candidate = [...accepted, word].join(' ');
    if (candidate.length > MAX_SEARCH_TERM_LENGTH) {
      break;
    }
    accepted.push(word);
  }

  return accepted.join(' ');
}

function normalizeIndexCompatibleSearchTerm(value: string): string {
  const words = value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/u)
    .filter((word) => word.length > 0 && word.length <= MAX_SEARCH_TERM_LENGTH);
  return words.join(' ');
}

function getContextBrandTerms(
  context: BuildCommercialGuideLinksContext
): string[] {
  const support = CONTENT_CLUSTER_SUPPORT[context.categorySlug];
  const terms: string[] = [];

  for (const brand of context.brands ?? []) {
    const normalizedBrand = normalizeSearchTerm(brand);
    if (!normalizedBrand) {
      continue;
    }

    terms.push(normalizedBrand);

    for (const [brandKey, aliases] of Object.entries(support.brandTokens)) {
      const normalizedAliases = [brandKey, ...aliases]
        .map(normalizeSearchTerm)
        .filter(Boolean);
      if (normalizedAliases.includes(normalizedBrand)) {
        terms.push(...normalizedAliases);
      }
    }
  }

  return terms;
}

function spreadTerms(terms: string[]) {
  if (terms.length < 3) {
    return terms;
  }

  const bucketCount = Math.min(8, terms.length);
  const spread: string[] = [];
  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    for (let index = bucket; index < terms.length; index += bucketCount) {
      spread.push(terms[index]);
    }
  }
  return spread;
}

function getCompactCategoryProductTerm(identifier: string) {
  const tokens = identifier
    .split(/[^a-z0-9]+/iu)
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
  if (tokens.length === 0) {
    return '';
  }

  // The RPC query is only a candidate prefilter. Keep one model discriminator
  // per product so a long authority catalog does not exhaust the 512-byte
  // budget before later products are searchable. Full identifiers remain in
  // buildCommercialGuideLinks for the exact downstream score.
  return (
    tokens.findLast(
      (token) => /^\d{2,}$/u.test(token) && !/^(?:19|20)\d{2}$/u.test(token)
    ) ??
    tokens.findLast((token) => /^\d{2,}$/u.test(token)) ??
    tokens.find((token) => /\d/u.test(token)) ??
    [...tokens].sort((left, right) => right.length - left.length)[0] ??
    ''
  );
}

function getIndexCompatibleProductTerms(
  context: BuildCommercialGuideLinksContext
) {
  if (context.pageKind !== 'product' && context.pageKind !== 'compare') {
    return [];
  }

  const productSources = context.productNames?.length
    ? context.productNames
    : (context.productSlugs ?? []);
  return productSources.map(normalizeIndexCompatibleSearchTerm).filter(Boolean);
}

export function buildClusterGuideSearchQuery(
  context: BuildCommercialGuideLinksContext
): string {
  // CONTENT_CLUSTER_SUPPORT deliberately preserves literal keys so config
  // completeness is checked at compile time. Widen the selected entry to the
  // public support contract before indexing its runtime price-band slug.
  const support: ClusterSupport = CONTENT_CLUSTER_SUPPORT[context.categorySlug];
  const priceBandTerms = context.priceBandSlug
    ? (support.priceBandAliases[context.priceBandSlug] ?? [])
    : [];
  const modelFamilyTerms = context.modelFamilySlug
    ? [context.modelFamilySlug.replace(/-/g, ' ')]
    : [];
  const productTerms =
    context.pageKind === 'category'
      ? spreadTerms(
          getProductModelIdentifiers(context).map(getCompactCategoryProductTerm)
        )
      : context.pageKind === 'product' || context.pageKind === 'compare'
        ? getProductModelIdentifiers(context)
        : (context.productSlugs ?? []).map((slug) => slug.replace(/-/g, ' '));
  const rawTermGroups = [
    {
      terms: [
        ...support.categoryNames,
        ...getContextBrandTerms(context),
        ...modelFamilyTerms,
        ...productTerms,
      ],
      normalize: normalizeSearchTerm,
    },
    {
      terms: getIndexCompatibleProductTerms(context),
      normalize: normalizeIndexCompatibleSearchTerm,
    },
    {
      terms: [...priceBandTerms, ...support.articleTokens],
      normalize: normalizeSearchTerm,
    },
  ];
  const seen = new Set<string>();
  const expressions: string[] = [];
  let queryByteLength = 0;

  for (const { terms, normalize } of rawTermGroups) {
    for (const rawTerm of terms) {
      const term = normalize(rawTerm);
      if (!term || seen.has(term)) {
        continue;
      }

      const expression = `"${term}"`;
      const separatorLength = expressions.length > 0 ? 4 : 0;
      const expressionByteLength = UTF8_ENCODER.encode(expression).byteLength;
      if (
        queryByteLength + separatorLength + expressionByteLength >
        MAX_SEARCH_QUERY_LENGTH
      ) {
        continue;
      }

      seen.add(term);
      expressions.push(expression);
      queryByteLength += separatorLength + expressionByteLength;
    }
  }

  return expressions.join(' OR ');
}
