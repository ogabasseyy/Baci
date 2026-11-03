import { generateSlug } from '@/lib/seo-utils';
import type {
  BuildCommercialGuideLinksInput,
  CommercialGuidePageKind,
  ContentClusterKind,
} from './content-cluster-types';
import { getPostTokenGroups } from './get-post-token-groups';
import { normalizeContentCurrencyTokens } from './normalize-content-currency-tokens';
import { tokenizeContentText } from './tokenize-content-text';

export const KIND_PREFERENCE: Record<
  CommercialGuidePageKind,
  ContentClusterKind[]
> = {
  category: ['buyer-guide', 'best-in-nigeria'],
  product: [],
  compare: ['decision-support', 'buyer-guide'],
  'price-band': ['best-in-nigeria', 'buyer-guide'],
};

const MODEL_FAMILY_CONTEXT_EXCLUSIONS = new Set(['and', 'or']);

export const GAME_CATEGORY_PATTERN =
  /^(?:gaming(?:-accessories)?|portable-gaming|playstation-[45]|nintendo-switch(?:-2)?|xbox)$/u;

export function toPublishedTimestamp(value: string | null) {
  if (!value) {
    return 0;
  }
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function tokenizeSlug(slug: string) {
  return normalizeContentCurrencyTokens(slug)
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 2);
}

export function tokenizeModelIdentifier(identifier: string) {
  return normalizeContentCurrencyTokens(identifier)
    .split(/[^a-z0-9]+/iu)
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
}

export function hasContiguousTokenSequence(
  post: BuildCommercialGuideLinksInput['posts'][number],
  expectedTokens: string[]
) {
  if (expectedTokens.length === 0) {
    return false;
  }

  const postTokenGroups = getPostTokenGroups(post);
  return postTokenGroups.some((postTokens) =>
    postTokens.some((_, startIndex) =>
      expectedTokens.every(
        (token, offset) => postTokens[startIndex + offset] === token
      )
    )
  );
}

export function hasContextualFamilyMatch(
  post: BuildCommercialGuideLinksInput['posts'][number],
  familyTokens: string[],
  brands: string[]
) {
  if (familyTokens.length === 0) {
    return false;
  }

  const brandTokens = brands
    .flatMap(tokenizeContentText)
    .filter(
      (token) => token.length > 1 && !MODEL_FAMILY_CONTEXT_EXCLUSIONS.has(token)
    );

  return brandTokens.some(
    (brandToken) =>
      (familyTokens.includes(brandToken) &&
        hasContiguousTokenSequence(post, familyTokens)) ||
      hasContiguousTokenSequence(post, [brandToken, ...familyTokens]) ||
      hasContiguousTokenSequence(post, [...familyTokens, brandToken])
  );
}

export function getContextBrandValues(
  brands: string[],
  brandAliases: Record<string, readonly string[]>
) {
  return Array.from(
    new Set([
      ...brands,
      ...brands.flatMap((brand) => brandAliases[generateSlug(brand)] ?? []),
    ])
  );
}

export function buildGuideHref(storeUrl: string, slug: string) {
  return `${storeUrl}/blog/${slug}`;
}
