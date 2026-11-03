import {
  CONTENT_CLUSTER_SCORE,
  CONTENT_CLUSTER_SUPPORT,
} from '@/config/storefront-content-clusters';
import { generateSlug } from '@/lib/seo-utils';
import { buildCommercialGuideDescription } from './build-commercial-guide-description';
import {
  buildGuideHref,
  GAME_CATEGORY_PATTERN,
  getContextBrandValues,
  hasContextualFamilyMatch,
  hasContiguousTokenSequence,
  KIND_PREFERENCE,
  tokenizeModelIdentifier,
  tokenizeSlug,
  toPublishedTimestamp,
} from './build-commercial-guide-helpers';
import type {
  BuildCommercialGuideLinksInput,
  InformationalGuideLink,
} from './content-cluster-types';
import { getCompareGuideDiscriminatorOptions } from './get-compare-guide-discriminator-options';
import { getCompareProductMatchRequirements } from './get-compare-product-match-requirements';
import { getContextBrandKeys } from './get-context-brand-keys';
import { getProductConnectivityDiscriminators } from './get-product-connectivity-discriminator';
import { getProductGuideMatchStrength } from './get-product-guide-match-strength';
import { getProductGuideModelIdentifiers } from './get-product-guide-model-identifiers';
import { hasDistinctCompareIdentifierOccurrences } from './has-distinct-compare-identifier-occurrences';
import { inferContentClusterContext } from './infer-content-cluster-context';
import { matchesProductGuideIdentifier } from './matches-product-guide-identifier';

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

      const configuredContextBrands = normalizedBrands.filter(
        (brand) => brand in brandAliases
      );
      const configuredPostBrands = inferred.brands.filter(
        (brand) => generateSlug(brand) in brandAliases
      );
      const hasConfiguredBrandMismatch =
        configuredContextBrands.length > 0 &&
        configuredPostBrands.length > 0 &&
        !hasBrandMatch;

      if (
        input.context.pageKind === 'product' &&
        !GAME_CATEGORY_PATTERN.test(input.context.categorySlug) &&
        hasConfiguredBrandMismatch
      ) {
        return null;
      }
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

      const passingScore =
        input.minScore ?? CONTENT_CLUSTER_SCORE.categoryMatch;

      if (score < passingScore) {
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
    .filter(
      (entry) =>
        entry.score >= (input.minScore ?? CONTENT_CLUSTER_SCORE.categoryMatch)
    )
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.publishedAt - left.publishedAt ||
        left.slug.localeCompare(right.slug)
    )
    .slice(0, 3)
    .map((entry) => entry.guide);
}
