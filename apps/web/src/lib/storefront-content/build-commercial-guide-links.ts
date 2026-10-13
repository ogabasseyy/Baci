import {
  CONTENT_CLUSTER_SCORE,
  CONTENT_CLUSTER_SUPPORT,
} from '@/config/storefront-content-clusters';
import { generateSlug } from '@/lib/seo-utils';
import { buildCommercialGuideDescription } from './build-commercial-guide-description';
import type {
  BuildCommercialGuideLinksInput,
  CommercialGuidePageKind,
  ContentClusterKind,
  InformationalGuideLink,
} from './content-cluster-types';
import { getCompareGuideDiscriminatorOptions } from './get-compare-guide-discriminator-options';
import { getCompareProductMatchRequirements } from './get-compare-product-match-requirements';
import { getContextBrandKeys } from './get-context-brand-keys';
import { getPostTokenGroups } from './get-post-token-groups';
import { getProductConnectivityDiscriminators } from './get-product-connectivity-discriminator';
import { getProductGuideMatchStrength } from './get-product-guide-match-strength';
import { getProductGuideModelIdentifiers } from './get-product-guide-model-identifiers';
import { hasDistinctCompareIdentifierOccurrences } from './has-distinct-compare-identifier-occurrences';
import { inferContentClusterContext } from './infer-content-cluster-context';
import { matchesProductGuideIdentifier } from './matches-product-guide-identifier';
import { normalizeContentCurrencyTokens } from './normalize-content-currency-tokens';
import { tokenizeContentText } from './tokenize-content-text';

const KIND_PREFERENCE: Record<CommercialGuidePageKind, ContentClusterKind[]> = {
  category: ['buyer-guide', 'best-in-nigeria'],
  product: [],
  compare: ['decision-support', 'buyer-guide'],
  'price-band': ['best-in-nigeria', 'buyer-guide'],
};

const MODEL_FAMILY_CONTEXT_EXCLUSIONS = new Set(['and', 'or']);
const GAME_CATEGORY_PATTERN =
  /^(?:gaming(?:-accessories)?|portable-gaming|playstation-[45]|nintendo-switch(?:-2)?|xbox)$/u;
function toPublishedTimestamp(value: string | null) {
  if (!value) {
    return 0;
  }
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function tokenizeSlug(slug: string) {
  return normalizeContentCurrencyTokens(slug)
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 2);
}

function tokenizeModelIdentifier(identifier: string) {
  return normalizeContentCurrencyTokens(identifier)
    .split(/[^a-z0-9]+/iu)
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
}

function hasContiguousTokenSequence(
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

function hasContextualFamilyMatch(
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

function getContextBrandValues(
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

function buildGuideHref(storeUrl: string, slug: string) {
  return `${storeUrl}/blog/${slug}`;
}

export function buildCommercialGuideLinks(
  input: BuildCommercialGuideLinksInput
): InformationalGuideLink[] {
  const preferredKinds = KIND_PREFERENCE[input.context.pageKind];
  const brandAliases =
    CONTENT_CLUSTER_SUPPORT[input.context.categorySlug].brandTokens;
  const productModelIdentifiers = getProductGuideModelIdentifiers(
    input.context
  );
  const productConnectivityDiscriminators =
    input.context.pageKind === 'product'
      ? getProductConnectivityDiscriminators(
          input.context.productNames,
          input.context.productSlugs,
          input.context.categorySlug
        )
      : undefined;
  const compareProductMatchRequirements =
    input.context.pageKind === 'compare'
      ? getCompareProductMatchRequirements(input.context)
      : [];
  const modelFamilyTokens = tokenizeModelIdentifier(
    input.context.modelFamilySlug ?? ''
  );

  return input.posts
    .map((post) => {
      const inferred = inferContentClusterContext(post);

      if (
        inferred.categorySlug !== input.context.categorySlug ||
        !inferred.kind
      ) {
        return null;
      }

      let score = CONTENT_CLUSTER_SCORE.categoryMatch;

      if (preferredKinds.includes(inferred.kind)) {
        score += CONTENT_CLUSTER_SCORE.kindMatch;
      }

      const normalizedBrands = getContextBrandKeys(
        input.context.brands,
        input.context.productNames,
        brandAliases
      );
      const directBrandMatches = new Set(
        normalizedBrands.filter((brand) =>
          hasContiguousTokenSequence(post, tokenizeModelIdentifier(brand))
        )
      );
      const hasDirectBrandMatch = directBrandMatches.size > 0;
      const hasBrandMatch =
        normalizedBrands.length > 0 &&
        (hasDirectBrandMatch ||
          inferred.brands.some((brand) =>
            normalizedBrands.includes(generateSlug(brand))
          ));
      if (hasBrandMatch) {
        score += CONTENT_CLUSTER_SCORE.brandMatch;
      }

      if (
        input.context.priceBandSlug &&
        inferred.matchedPriceBands.includes(input.context.priceBandSlug)
      ) {
        score += CONTENT_CLUSTER_SCORE.priceBandMatch;
      }

      const shouldBindProductModelBrand =
        normalizedBrands.length > 0 &&
        (!GAME_CATEGORY_PATTERN.test(input.context.categorySlug) ||
          (input.context.categorySlug === 'gaming' &&
            normalizedBrands.some((brand) =>
              [
                'ps4',
                'ps5',
                'playstation',
                'xbox',
                'switch',
                'nintendo',
              ].includes(brand)
            )));
      const productGuideMatchStrength = getProductGuideMatchStrength({
        post,
        inferredTokens: inferred.tokens,
        inferredBrands: inferred.brands,
        identifiers: productModelIdentifiers,
        normalizedBrands,
        brandAliases,
        bindBrand: shouldBindProductModelBrand,
        hasBrandMatch,
        discriminatorTokens: productConnectivityDiscriminators,
        requireBrandBeforeIdentifier:
          input.context.categorySlug !== 'gift-cards',
      });
      const hasModelFamilyMatch =
        modelFamilyTokens.length > 0 &&
        hasBrandMatch &&
        modelFamilyTokens.every((token) => inferred.tokens.includes(token)) &&
        hasContextualFamilyMatch(
          post,
          modelFamilyTokens,
          getContextBrandValues(input.context.brands ?? [], brandAliases)
        );
      const compareGuideDiscriminatorOptions =
        getCompareGuideDiscriminatorOptions(compareProductMatchRequirements);
      const hasRequiredCompareModelMatch =
        input.context.pageKind === 'compare' &&
        compareProductMatchRequirements.length > 0 &&
        hasDistinctCompareIdentifierOccurrences(
          post,
          compareProductMatchRequirements.map(({ identifier }) => identifier)
        ) &&
        compareProductMatchRequirements.every(
          ({ identifier, brand, discriminatorTokens }) =>
            (!brand ||
              inferred.brands.includes(brand) ||
              directBrandMatches.has(generateSlug(brand))) &&
            matchesProductGuideIdentifier(
              post,
              inferred.tokens,
              tokenizeModelIdentifier(identifier),
              hasBrandMatch,
              {
                brand,
                knownBrands: inferred.brands,
                brandAliases,
                discriminatorTokens,
                requireBrandBeforeIdentifier: !GAME_CATEGORY_PATTERN.test(
                  input.context.categorySlug
                ),
                allowBrandAliasOverlap: true,
                ...compareGuideDiscriminatorOptions,
              }
            )
        );
      if (hasRequiredCompareModelMatch || hasModelFamilyMatch) {
        score += CONTENT_CLUSTER_SCORE.productTokenMatch;
      } else if (input.context.pageKind !== 'compare') {
        score += productGuideMatchStrength;
      }

      const titleTokens = tokenizeSlug(post.title);
      if (
        normalizedBrands.some((brand) =>
          titleTokens.includes(brand.replace(/-/g, ''))
        ) ||
        (input.context.priceBandSlug
          ? titleTokens.some((token) =>
              tokenizeSlug(input.context.priceBandSlug ?? '').includes(token)
            )
          : false)
      ) {
        score += CONTENT_CLUSTER_SCORE.titleTokenMatch;
      }

      if (score < CONTENT_CLUSTER_SCORE.categoryMatch) {
        return null;
      }

      return {
        score,
        publishedAt: toPublishedTimestamp(post.published_at),
        slug: post.slug,
        guide: {
          href: buildGuideHref(input.storeUrl, post.slug),
          title: post.title,
          description: buildCommercialGuideDescription(post),
          kind: inferred.kind,
        } satisfies InformationalGuideLink,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .filter((entry) => entry.score >= 4)
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.publishedAt - left.publishedAt ||
        left.slug.localeCompare(right.slug)
    )
    .slice(0, 3)
    .map((entry) => entry.guide);
}
