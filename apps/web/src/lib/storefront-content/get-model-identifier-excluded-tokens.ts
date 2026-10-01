import { CONTENT_CLUSTER_SUPPORT } from '@/config/storefront-content-clusters';
import type { BuildCommercialGuideLinksContext } from './content-cluster-types';
import { isProductModelMetadataToken } from './is-product-model-metadata-token';
import { modelTokenMatchers } from './model-token-matchers';

const { isDimensionToken } = modelTokenMatchers;

const YEAR_TOKEN_PATTERN = /^(?:19|20)\d{2}$/u;
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
  'omen',
  'optiplex',
  'fire',
]);
const NUMERIC_MODEL_FAMILY_ALIAS_TOKENS = new Set(['fire', 'omen', 'optiplex']);
const HARDWARE_METADATA_TOKEN_PATTERN = /^(?:rtx|core|i[3579]|\d{3,4})$/u;

export function getExcludedModelIdentifierTokens(
  context: Omit<BuildCommercialGuideLinksContext, 'pageKind'>,
  source: string,
  baseExcludedTokens: ReadonlySet<string>,
  protectedFamilyTokens: ReadonlySet<string>,
  tokenize: (value: string) => string[]
) {
  const contextBrandTokens = new Set(
    [
      ...(context.brands ?? []),
      ...(context.productSlugs ?? []),
      ...(context.productNames ?? []),
    ].flatMap(tokenize)
  );
  const slugTokens = tokenize(source);
  const excludedTokens = new Set(baseExcludedTokens);
  const brandGroups = (
    Object.entries(
      CONTENT_CLUSTER_SUPPORT[context.categorySlug].brandTokens
    ) as [string, readonly string[]][]
  ).flatMap(([brandKey, aliases]) => {
    if (brandKey === 'gaming') return [];
    const brandTokens = tokenize(brandKey);
    const aliasTokens = aliases.map(tokenize);
    const matchesContext = [brandTokens, ...aliasTokens].some((tokens) =>
      tokens.some((token) => contextBrandTokens.has(token))
    );
    return matchesContext ? [{ brandTokens, aliases: aliasTokens }] : [];
  });
  for (const group of brandGroups) {
    for (const token of group.brandTokens) {
      if (
        slugTokens.includes(token) &&
        !protectedFamilyTokens.has(token) &&
        !MODEL_FAMILY_ALIAS_TOKENS.has(token)
      ) {
        excludedTokens.add(token);
      }
    }
    for (const aliasTokens of group.aliases) {
      if (
        aliasTokens.length === 0 ||
        !aliasTokens.every((token) => slugTokens.includes(token)) ||
        aliasTokens.some((token) => protectedFamilyTokens.has(token))
      ) {
        continue;
      }
      const leavesModelToken = slugTokens.some((token, index) => {
        if (excludedTokens.has(token) || aliasTokens.includes(token)) {
          return false;
        }
        return (
          !isProductModelMetadataToken(token, context.categorySlug) &&
          !YEAR_TOKEN_PATTERN.test(token) &&
          !isDimensionToken(slugTokens, index)
        );
      });
      const remainingModelTokens = slugTokens.filter(
        (token, index) =>
          !excludedTokens.has(token) &&
          !aliasTokens.includes(token) &&
          !isProductModelMetadataToken(token, context.categorySlug) &&
          !YEAR_TOKEN_PATTERN.test(token) &&
          !isDimensionToken(slugTokens, index)
      );
      const leavesOnlyNumericModel =
        remainingModelTokens.length > 0 &&
        remainingModelTokens
          .filter((token) => !HARDWARE_METADATA_TOKEN_PATTERN.test(token))
          .every((token) => /^\d+$/u.test(token)) &&
        aliasTokens.some((token) =>
          NUMERIC_MODEL_FAMILY_ALIAS_TOKENS.has(token)
        );
      const isModelFamilyAlias = aliasTokens.some((token) =>
        MODEL_FAMILY_ALIAS_TOKENS.has(token)
      );
      if (
        !isModelFamilyAlias &&
        !leavesOnlyNumericModel &&
        (aliasTokens.length === 1 || leavesModelToken)
      ) {
        for (const token of aliasTokens) {
          excludedTokens.add(token);
        }
      }
    }
  }
  return excludedTokens;
}
