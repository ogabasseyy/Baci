import { CONTENT_CLUSTER_SUPPORT } from '@/config/storefront-content-clusters';
import { generateSlug } from '@/lib/seo-utils';
import type { BuildCommercialGuideLinksContext } from './content-cluster-types';
import { getLaptopHardwareDiscriminatorTokens } from './get-laptop-hardware-discriminator-tokens';
import { getProductGuideModelIdentifiers } from './get-product-guide-model-identifiers';
import { isProductVariantColorToken } from './is-product-variant-color-token';
import { isProductVariantRegionToken } from './is-product-variant-region-token';
import { normalizeContentCurrencyTokens } from './normalize-content-currency-tokens';
import { normalizeVariantDiscriminatorTokens } from './normalize-variant-discriminator-tokens';

type CompareProductMatchRequirement = {
  identifier: string;
  brand: string | null;
  discriminatorTokens?: string[];
};

const VARIANT_DISCRIMINATOR_PATTERN =
  /^(?:\d+(?:\.\d+)?(?:g|gb|tb|mb|mm|inch|w|v)|\d+(?:hz|mah)|(?:e)?sim|bluetooth|wifi|cellular|gps|lte|dual|single|physical|nano|active|classic|edge|fe|flip|fold|lite|max|mini|neo|plus|power|prime|pro|se|ultra|xl)$/u;
const RAM_DOMINANT_CATEGORIES = new Set([
  'desktops',
  'gaming-laptops',
  'laptops',
]);

function tokenize(value: string) {
  return normalizeContentCurrencyTokens(
    value.replace(/(\d{1,2}(?:\.\d+)?)\s*["″”]/gu, '$1 inch')
  )
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter(Boolean);
}

function tokenizeVariantSource(value: string) {
  return normalizeVariantDiscriminatorTokens(tokenize(value));
}

function isCompareVariantMetadataToken(token: string) {
  return (
    token === 'version' ||
    VARIANT_DISCRIMINATOR_PATTERN.test(token) ||
    isProductVariantColorToken(token)
  );
}

function getBrandCandidates(context: BuildCommercialGuideLinksContext) {
  const configured = Object.entries(
    CONTENT_CLUSTER_SUPPORT[context.categorySlug].brandTokens
  ).map(([brand, aliases]) => ({
    brand,
    markers: [brand, ...aliases],
  }));

  const contextual = (context.brands ?? []).map((brand) => ({
    brand: generateSlug(brand),
    markers: [brand],
  }));

  return { configured, contextual };
}

function inferSourceBrand(
  source: string,
  context: BuildCommercialGuideLinksContext,
  explicitBrand?: string | null
) {
  const { configured, contextual } = getBrandCandidates(context);
  if (explicitBrand) {
    const explicitTokens = new Set(tokenize(explicitBrand));
    return (
      configured.find(({ brand }) =>
        tokenize(brand).every((token) => explicitTokens.has(token))
      )?.brand ??
      configured.find(({ markers }) =>
        markers.some((marker) =>
          tokenize(marker).every((token) => explicitTokens.has(token))
        )
      )?.brand ??
      contextual.find(({ brand }) =>
        tokenize(brand).every((token) => explicitTokens.has(token))
      )?.brand ??
      generateSlug(explicitBrand)
    );
  }
  const sourceTokens = new Set(tokenize(source));
  return (
    configured.find(({ brand }) =>
      tokenize(brand).every((token) => sourceTokens.has(token))
    )?.brand ??
    configured.find(({ markers }) =>
      markers.some((marker) =>
        tokenize(marker).every((token) => sourceTokens.has(token))
      )
    )?.brand ??
    contextual.find(({ brand }) =>
      tokenize(brand).every((token) => sourceTokens.has(token))
    )?.brand ??
    null
  );
}

function getSourceDiscriminatorTokens(
  source: string,
  identifier: string,
  categorySlug: BuildCommercialGuideLinksContext['categorySlug']
) {
  const identifierTokens = new Set(tokenizeVariantSource(identifier));
  const seen = new Set<string>();
  const discriminatorTokens: string[] = [];
  const sourceTokens = tokenizeVariantSource(source);
  const laptopHardwareTokens = new Set(
    getLaptopHardwareDiscriminatorTokens(sourceTokens, categorySlug)
  );
  for (const [index, token] of sourceTokens.entries()) {
    const storageCapacity = Number(token.match(/^(\d+)gb$/u)?.[1] ?? 0);
    const isLikelyRam =
      storageCapacity > 0 &&
      storageCapacity <= 32 &&
      (sourceTokens[index + 1] === 'ram' ||
        sourceTokens.some((otherToken) => {
          const match = otherToken.match(/^(\d+)(gb|tb)$/u);
          const otherCapacity = match
            ? Number(match[1]) * (match[2] === 'tb' ? 1024 : 1)
            : 0;
          return otherCapacity > storageCapacity;
        }) ||
        (RAM_DOMINANT_CATEGORIES.has(categorySlug) &&
          sourceTokens.some((otherToken) =>
            /(?:corei|coreultra|rtx)/u.test(otherToken)
          )));
    const isExplicitRamVariant =
      RAM_DOMINANT_CATEGORIES.has(categorySlug) &&
      sourceTokens[index + 1] === 'ram';
    if (
      !identifierTokens.has(token) &&
      (!isLikelyRam || isExplicitRamVariant) &&
      (VARIANT_DISCRIMINATOR_PATTERN.test(token) ||
        laptopHardwareTokens.has(token) ||
        isProductVariantColorToken(token) ||
        (isProductVariantRegionToken(token, {
          isTerminal:
            index === sourceTokens.length - 1 ||
            sourceTokens.slice(index + 1).every(isCompareVariantMetadataToken),
        }) &&
          sourceTokens
            .slice(index + 1)
            .every(isCompareVariantMetadataToken))) &&
      !seen.has(token)
    ) {
      seen.add(token);
      discriminatorTokens.push(token);
    }
  }
  return discriminatorTokens;
}

function isSharedRamDiscriminator(
  token: string,
  categorySlug: BuildCommercialGuideLinksContext['categorySlug']
) {
  const capacity = Number(token.match(/^(\d+)gb$/u)?.[1] ?? 0);
  return (
    capacity > 0 && capacity <= 12 && !RAM_DOMINANT_CATEGORIES.has(categorySlug)
  );
}

function getMostSpecificProductIdentifier(
  context: BuildCommercialGuideLinksContext
) {
  return getProductGuideModelIdentifiers(context).reduce<string | undefined>(
    (mostSpecific, identifier) =>
      !mostSpecific ||
      tokenize(identifier).length > tokenize(mostSpecific).length
        ? identifier
        : mostSpecific,
    undefined
  );
}

/** Builds per-product compare requirements without collapsing brand collisions. */
export function getCompareProductMatchRequirements(
  context: BuildCommercialGuideLinksContext
) {
  const names = context.productNames ?? [];
  const slugs = context.productSlugs ?? [];
  const sources = (names.length ? names : slugs).map((source, index) => ({
    identifierSource: source,
    pairedSlug: slugs[index],
    explicitBrand: context.productBrands?.[index],
    brandSource: `${source} ${slugs[index] ?? ''}`,
    variantSource: `${source} ${names.length ? (slugs[index] ?? '') : ''}`,
    hasExplicitVariantSource: names.length > 0,
  }));

  const candidates = sources.flatMap(
    ({
      identifierSource,
      pairedSlug,
      explicitBrand,
      brandSource,
      variantSource,
      hasExplicitVariantSource,
    }) => {
      const identifier = getMostSpecificProductIdentifier({
        ...context,
        productNames: names.length ? [identifierSource] : undefined,
        productSlugs: names.length
          ? pairedSlug
            ? [pairedSlug]
            : []
          : [identifierSource],
      });

      return identifier
        ? [
            {
              identifier,
              brand: inferSourceBrand(brandSource, context, explicitBrand),
              discriminatorTokens: getSourceDiscriminatorTokens(
                variantSource,
                identifier,
                context.categorySlug
              ),
              hasExplicitVariantSource,
            },
          ]
        : [];
    }
  );

  if (candidates.length !== sources.length) {
    return [];
  }

  const candidateGroups = new Map<string, typeof candidates>();
  for (const candidate of candidates) {
    const key = `${candidate.identifier}\u0000${candidate.brand ?? ''}`;
    candidateGroups.set(key, [...(candidateGroups.get(key) ?? []), candidate]);
  }

  return candidates.map((candidate) => {
    const key = `${candidate.identifier}\u0000${candidate.brand ?? ''}`;
    const group = candidateGroups.get(key) ?? [];
    const requirement: CompareProductMatchRequirement = {
      identifier: candidate.identifier,
      brand: candidate.brand,
    };
    const hasSubsetVariants = group.some((left) =>
      group.some(
        (right) =>
          left !== right &&
          left.discriminatorTokens.length < right.discriminatorTokens.length &&
          left.discriminatorTokens.every((token) =>
            right.discriminatorTokens.includes(token)
          )
      )
    );
    const discriminatorTokens =
      (group.length === 1 && candidate.hasExplicitVariantSource) ||
      hasSubsetVariants
        ? candidate.discriminatorTokens
        : group.length > 1
          ? candidate.discriminatorTokens.filter(
              (token) => !isSharedRamDiscriminator(token, context.categorySlug)
            )
          : [];
    if (discriminatorTokens.length > 0) {
      requirement.discriminatorTokens = discriminatorTokens;
    }
    return requirement;
  });
}
