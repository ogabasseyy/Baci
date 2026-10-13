import { CONTENT_CLUSTER_SUPPORT } from '@/config/storefront-content-clusters';
import { applyJoinedTitleCorrections } from './apply-joined-title-corrections';
import type { BuildCommercialGuideLinksContext } from './content-cluster-types';
import { filterProductModelSourceTokens } from './filter-product-model-source-tokens';
import { getExcludedModelIdentifierTokens } from './get-model-identifier-excluded-tokens';
import { getProductModelIdentifiersFromSources } from './get-product-model-identifiers-from-sources';
import { getProtectedModelFamilyTokens } from './get-protected-model-family-tokens';
import { hasConsoleProductDescriptor } from './has-console-product-descriptor';
import { isBareCapacityMetadataToken } from './is-bare-capacity-metadata-token';
import { isGameProduct } from './is-game-product';
import { isProductModelMetadataToken } from './is-product-model-metadata-token';
import { modelTokenMatchers } from './model-token-matchers';
import { normalizeCompactModelTierTokens } from './normalize-compact-model-tier-tokens';
import { normalizeContentCurrencyTokens } from './normalize-content-currency-tokens';
import { normalizeProductModelTokens } from './normalize-product-model-tokens';
import { selectProductModelIdentifier } from './select-product-model-identifier';

const {
  isConvertibleInConnector,
  isDimensionToken,
  stripTrailingLaptopProcessorTier,
} = modelTokenMatchers;

function tokenize(value: string) {
  const tokens = normalizeContentCurrencyTokens(value)
    .replace(/(\d{1,2}(?:\.\d+)?)\s*["″”]/gu, '$1 inch')
    .toLowerCase()
    .replace(/[’']s\b/gu, '')
    .replace(/\+/gu, ' plus ')
    .replace(/(\d{1,2})\.(\d+)(inch|mm)\b/gu, '$1 $2 $3')
    .split(/[^a-z0-9]+/u)
    .map((token) => token.trim())
    .filter(
      (token) => token.length > 1 || /\d/u.test(token) || /^[a-z]$/u.test(token)
    );
  return normalizeCompactModelTierTokens(tokens);
}
const MODEL_FAMILY_ALIAS_TOKENS = new Set([
  'airpods',
  'buds',
  'legion',
  'laserjet',
  'latitude',
  'pavilion',
  'quest',
  'redmi',
  'rog',
  'series',
  'thinkpad',
  'watch',
  'xps',
  'inspiron',
]);
const LAPTOP_CATEGORY_SLUGS = new Set(['gaming-laptops', 'laptops']);
const DISPLAY_SIZE_CATEGORY_SLUGS = new Set(LAPTOP_CATEGORY_SLUGS).add(
  'tablets'
);
const GAME_CATEGORY_PATTERN =
  /^(?:(?:portable-)?gaming|playstation-[45]|nintendo-switch(?:-2)?|xbox)$/u;
const LEADING_FILLER_TOKENS = new Set(['a', 'an', 'headset', 'the']);
const GENERIC_MODEL_TIER_TOKENS = new Set([
  'active',
  'classic',
  'edge',
  'lite',
  'max',
  'mini',
  'plus',
  'pro',
  'prime',
  'ultra',
]);
function stripLeadingFillerTokens(tokens: string[]) {
  const firstModelToken = tokens.findIndex(
    (token) => !LEADING_FILLER_TOKENS.has(token)
  );
  return tokens.slice(firstModelToken < 0 ? tokens.length : firstModelToken);
}
function stripLeadingDisplaySize(
  tokens: string[],
  sourceTokens: string[],
  categorySlug: string
) {
  if (!DISPLAY_SIZE_CATEGORY_SLUGS.has(categorySlug)) {
    return tokens;
  }
  const [firstToken = '', nextToken = ''] = tokens;
  const displaySize = Number(firstToken);
  const hasFollowingModelText = tokens
    .slice(1)
    .some((token) => /[a-z]/u.test(token));
  const hasConvertibleModel = tokens.some((_, index) =>
    isConvertibleInConnector(tokens, index)
  );
  const isIntegerDisplayPrefix =
    /^\d{2}$/u.test(firstToken) &&
    displaySize >= 10 &&
    displaySize <= 20 &&
    !isDimensionToken(tokens, 1) &&
    (nextToken === 'inch' ||
      sourceTokens.includes('macbook') ||
      sourceTokens.includes('ipad')) &&
    !['intel', 'amd', 'core', 'ryzen'].includes(nextToken);
  const isDecimalDisplayPrefix =
    /^\d{1,2}$/u.test(firstToken) &&
    /^\d$/u.test(nextToken) &&
    Number(`${firstToken}.${nextToken}`) >= 7 &&
    Number(`${firstToken}.${nextToken}`) <= 20;
  if (
    !(isIntegerDisplayPrefix || isDecimalDisplayPrefix) ||
    !hasFollowingModelText ||
    hasConvertibleModel
  ) {
    return tokens;
  }
  const displayPrefixLength = isDecimalDisplayPrefix ? 2 : 1;
  const hasExplicitDisplayMarker = tokens[displayPrefixLength] === 'inch';
  return tokens.slice(displayPrefixLength + (hasExplicitDisplayMarker ? 1 : 0));
}
const SEPARATED_MODEL_METADATA_UNITS = new Set([
  'gb',
  'tb',
  'mb',
  'g',
  'inch',
  'hz',
  'mah',
  'mp',
  'w',
  'v',
  'mm',
  'cm',
  'kg',
  'ms',
]);
function isSeparatedModelMetadataToken(tokens: string[], index: number) {
  const token = tokens[index] ?? '';
  const nextToken = tokens[index + 1] ?? '';
  const previousToken = tokens[index - 1] ?? '';
  return (
    (/^\d+$/u.test(token) && SEPARATED_MODEL_METADATA_UNITS.has(nextToken)) ||
    (SEPARATED_MODEL_METADATA_UNITS.has(token) && /^\d+$/u.test(previousToken))
  );
}
function stripGeneratedCollisionSuffix(tokens: string[]) {
  const [previousToken = '', lastToken = ''] = tokens.slice(-2);
  if (tokens.length < 2 || !/^\d$/u.test(lastToken)) {
    return tokens;
  }
  if (['gen', 'generation', 'rtx', 'ultra'].includes(previousToken)) {
    return tokens;
  }
  if (previousToken === 'in' && /^\d+$/u.test(tokens.at(-3) ?? '')) {
    return tokens;
  }
  if (/\d/u.test(previousToken)) {
    return tokens.slice(0, -1);
  }
  const precedingNumericIndex = tokens.findLastIndex(
    (token, index) =>
      index < tokens.length - 1 &&
      /^\d+$/u.test(token) &&
      !isConvertibleInConnector(tokens, index - 1) &&
      !isConvertibleInConnector(tokens, index + 1)
  );
  return precedingNumericIndex >= 0 && precedingNumericIndex < tokens.length - 2
    ? tokens.slice(0, -1)
    : tokens;
}
function getModelTokens(
  slug: string,
  excludedTokens: ReadonlySet<string>,
  categorySlug: string,
  preserveGameTitleTokens: boolean
) {
  const canonicalSlug = applyJoinedTitleCorrections(slug);
  const sourceTokens = tokenize(canonicalSlug);
  const rawTokens = normalizeProductModelTokens(
    filterProductModelSourceTokens(
      tokenize(
        canonicalSlug
          .replace(/\bplay[\s-]+station\b/gu, 'playstation')
          .replace(/([a-z]{3,})-s-(?=[a-z])/gu, '$1-')
      ),
      excludedTokens
    ),
    preserveGameTitleTokens,
    DISPLAY_SIZE_CATEGORY_SLUGS.has(categorySlug)
  );
  const platformGeneration = categorySlug.match(/^playstation-(\d+)$/u)?.[1];
  const platformStrippedTokens =
    platformGeneration && rawTokens[0] === platformGeneration
      ? rawTokens.slice(1)
      : rawTokens;
  const tokens = GAME_CATEGORY_PATTERN.test(categorySlug)
    ? platformStrippedTokens
    : stripGeneratedCollisionSuffix(
        stripLeadingDisplaySize(
          platformStrippedTokens,
          sourceTokens,
          categorySlug
        )
      );
  const modelTokens = tokens.filter(
    (token, index) =>
      !isProductModelMetadataToken(token, categorySlug) &&
      !isSeparatedModelMetadataToken(tokens, index) &&
      !isBareCapacityMetadataToken(tokens, index) &&
      token !== 'inch' &&
      (token !== 'in' ||
        GAME_CATEGORY_PATTERN.test(categorySlug) ||
        isConvertibleInConnector(tokens, index) ||
        (tokens[index - 1] === 'all' && tokens[index + 1] === 'one')) &&
      !isDimensionToken(tokens, index)
  );
  if (
    categorySlug === 'tablets' &&
    modelTokens.length === 1 &&
    GENERIC_MODEL_TIER_TOKENS.has(modelTokens[0] ?? '') &&
    sourceTokens.includes('ipad')
  ) {
    modelTokens.unshift('ipad');
  }
  return stripTrailingLaptopProcessorTier(
    stripLeadingFillerTokens(modelTokens),
    categorySlug
  );
}
export function getProductModelIdentifiers(
  context: Omit<BuildCommercialGuideLinksContext, 'pageKind'>
) {
  const protectedFamilyTokens = getProtectedModelFamilyTokens(
    context,
    tokenize
  );
  const isGameCategory = GAME_CATEGORY_PATTERN.test(context.categorySlug);
  const hasConsoleProduct = hasConsoleProductDescriptor(
    context.productNames ?? context.productSlugs ?? [],
    tokenize
  );
  const preserveGameTitleTokens = isGameProduct(context, tokenize);
  const baseExcludedTokens = new Set(
    [
      ...(context.brands ?? []).flatMap(tokenize),
      ...CONTENT_CLUSTER_SUPPORT[context.categorySlug].categoryNames.flatMap(
        (name) =>
          tokenize(name).flatMap((token) => [
            token,
            ...(token.endsWith('s') && token.length > 3
              ? [token.slice(0, -1)]
              : []),
          ])
      ),
      'pc',
      ...(isGameCategory && !hasConsoleProduct ? ['console'] : []),
    ].filter(
      (token) =>
        Boolean(token) &&
        !(isGameCategory && /^\d+$/u.test(token)) &&
        !protectedFamilyTokens.has(token) &&
        !MODEL_FAMILY_ALIAS_TOKENS.has(token)
    )
  );
  return getProductModelIdentifiersFromSources(
    context.productNames,
    context.productSlugs,
    (source) =>
      selectProductModelIdentifier(
        getModelTokens(
          source,
          getExcludedModelIdentifierTokens(
            context,
            source,
            baseExcludedTokens,
            protectedFamilyTokens,
            tokenize
          ),
          context.categorySlug,
          preserveGameTitleTokens
        ),
        preserveGameTitleTokens
      )
  );
}
