import type { PublishedClusterPost } from './content-cluster-types';
import { matchesProductGuideIdentifier } from './matches-product-guide-identifier';
import { normalizeContentCurrencyTokens } from './normalize-content-currency-tokens';

interface ProductGuideMatchStrengthInput {
  post: PublishedClusterPost;
  inferredTokens: string[];
  inferredBrands: string[];
  identifiers: string[];
  normalizedBrands: string[];
  brandAliases: Record<string, readonly string[]>;
  bindBrand: boolean;
  hasBrandMatch: boolean;
  discriminatorTokens?: string[];
  requireBrandBeforeIdentifier?: boolean;
}

function tokenizeIdentifier(identifier: string) {
  return normalizeContentCurrencyTokens(identifier)
    .split(/[^a-z0-9]+/iu)
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
}

/** Returns 2 for an exact variant, 1 for its base model, and 0 for no match. */
export function getProductGuideMatchStrength(
  input: ProductGuideMatchStrengthInput
) {
  const brands = input.bindBrand ? input.normalizedBrands : [null];
  return input.identifiers.reduce((bestStrength, identifier) => {
    const identifierTokens = tokenizeIdentifier(identifier);
    const strength = brands.reduce((bestBrandStrength, brand) => {
      const baseOptions = brand
        ? {
            brand,
            knownBrands: input.inferredBrands,
            brandAliases: input.brandAliases,
            requireBrandBeforeIdentifier:
              input.requireBrandBeforeIdentifier ?? true,
            allowBrandAliasOverlap: true,
          }
        : undefined;
      const exactOptions = input.discriminatorTokens?.length
        ? {
            ...(baseOptions ?? {}),
            discriminatorTokens: input.discriminatorTokens,
          }
        : baseOptions;
      if (
        matchesProductGuideIdentifier(
          input.post,
          input.inferredTokens,
          identifierTokens,
          input.hasBrandMatch,
          exactOptions
        )
      ) {
        return 2;
      }
      const hasVariantRequirement = Boolean(input.discriminatorTokens?.length);
      const compatibleOptions = hasVariantRequirement
        ? {
            ...(baseOptions ?? {}),
            discriminatorTokens: input.discriminatorTokens,
            allowPartialDiscriminatorGroups: true,
            allowMissingDiscriminatorGroups: true,
          }
        : baseOptions;
      return hasVariantRequirement &&
        matchesProductGuideIdentifier(
          input.post,
          input.inferredTokens,
          identifierTokens,
          input.hasBrandMatch,
          compatibleOptions
        )
        ? Math.max(bestBrandStrength, 1)
        : bestBrandStrength;
    }, 0);
    return Math.max(bestStrength, strength);
  }, 0);
}
