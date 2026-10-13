import type { SupportedClusterCategory } from './content-cluster-types';
import { getLaptopHardwareDiscriminatorTokens } from './get-laptop-hardware-discriminator-tokens';
import { isProductVariantColorToken } from './is-product-variant-color-token';
import { isProductVariantRegionToken } from './is-product-variant-region-token';
import { normalizeContentCurrencyTokens } from './normalize-content-currency-tokens';
import { normalizeVariantDiscriminatorTokens } from './normalize-variant-discriminator-tokens';

const CONNECTIVITY_DISCRIMINATOR_TOKENS = new Set([
  '4g',
  '5g',
  'anc',
  'bluetooth',
  'cellular',
  'dual',
  'esim',
  'gps',
  'lte',
  'nano',
  'physical',
  'sim',
  'single',
  'wifi',
]);
const SIM_MODE_DISCRIMINATOR_TOKENS = new Set([
  'dual',
  'esim',
  'nano',
  'physical',
  'sim',
  'single',
]);
const DIMENSION_DISCRIMINATOR_PATTERN = /^\d+(?:\.\d+)?(?:mm|inch)$/u;
const BATTERY_CAPACITY_DISCRIMINATOR_PATTERN = /^\d+mah$/u;
const WATTAGE_DISCRIMINATOR_PATTERN = /^\d+w$/u;
const VOLTAGE_DISCRIMINATOR_PATTERN = /^\d+v$/u;
const REFRESH_RATE_DISCRIMINATOR_PATTERN = /^\d+hz$/u;
const COMMON_STORAGE_CAPACITIES_GB = new Set([
  8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096,
]);

function getStorageCapacityGb(token: string) {
  const match = token.match(/^(\d+)(gb|tb)$/u);
  if (!match) {
    return null;
  }
  const capacity = Number(match[1]) * (match[2] === 'tb' ? 1024 : 1);
  return COMMON_STORAGE_CAPACITIES_GB.has(capacity) ? capacity : null;
}

function tokenizeVariantSource(source: string | undefined) {
  return normalizeVariantDiscriminatorTokens(
    normalizeContentCurrencyTokens(
      (source ?? '').replace(/(\d{1,2}(?:\.\d+)?)\s*["″”]/gu, '$1 inch')
    )
      .replace(/(\d{1,2})\.(\d+)(inch|mm)\b/gu, '$1 $2 $3')
      .toLowerCase()
      .split(/[^a-z0-9]+/u)
      .filter(Boolean)
  );
}

function getDiscriminatorGroup(token: string, isTerminal = false) {
  if (SIM_MODE_DISCRIMINATOR_TOKENS.has(token)) {
    return 'sim';
  }
  if (CONNECTIVITY_DISCRIMINATOR_TOKENS.has(token)) {
    return 'connectivity';
  }
  if (DIMENSION_DISCRIMINATOR_PATTERN.test(token)) {
    return 'dimension';
  }
  if (BATTERY_CAPACITY_DISCRIMINATOR_PATTERN.test(token)) {
    return 'battery-capacity';
  }
  if (WATTAGE_DISCRIMINATOR_PATTERN.test(token)) {
    return 'wattage';
  }
  if (VOLTAGE_DISCRIMINATOR_PATTERN.test(token)) {
    return 'voltage';
  }
  if (REFRESH_RATE_DISCRIMINATOR_PATTERN.test(token)) {
    return 'refresh-rate';
  }
  if (getStorageCapacityGb(token) !== null) {
    return 'storage';
  }
  if (isProductVariantColorToken(token)) {
    return 'color';
  }
  if (isTerminal && isProductVariantRegionToken(token, { isTerminal })) {
    return 'region';
  }
  return null;
}

function isLikelyRamToken(
  token: string,
  nextToken = '',
  hasLargerCapacity = false,
  hasHardwareTier = false
) {
  const capacity = getStorageCapacityGb(token);
  return (
    capacity !== null &&
    capacity <= 32 &&
    (nextToken === 'ram' || hasLargerCapacity || hasHardwareTier)
  );
}

/** Returns PDP variant discriminators for group-aware guide matching. */
export function getProductConnectivityDiscriminators(
  productNames: string[] | undefined,
  productSlugs: string[] | undefined,
  categorySlug?: SupportedClusterCategory
) {
  const tokens = productNames?.length
    ? productNames.flatMap((name, index) => {
        const nameTokens = tokenizeVariantSource(name);
        const alignedSlugTokens = tokenizeVariantSource(productSlugs?.[index]);
        const hardwareTokens = new Set(
          getLaptopHardwareDiscriminatorTokens(nameTokens, categorySlug)
        );
        const namedGroups = new Set(
          nameTokens
            .filter((token, tokenIndex) => {
              const capacity = getStorageCapacityGb(token) ?? 0;
              return !isLikelyRamToken(
                token,
                nameTokens[tokenIndex + 1],
                [...nameTokens, ...alignedSlugTokens].some(
                  (otherToken) =>
                    (getStorageCapacityGb(otherToken) ?? 0) > capacity
                ),
                hardwareTokens.size > 0
              );
            })
            .map((token, tokenIndex) =>
              getDiscriminatorGroup(token, tokenIndex === nameTokens.length - 1)
            )
        );
        const supplementalSlugTokens = tokenizeVariantSource(
          productSlugs?.[index]
        ).filter((token, tokenIndex, slugTokens) => {
          const group = getDiscriminatorGroup(
            token,
            tokenIndex === slugTokens.length - 1
          );
          return group && !namedGroups.has(group);
        });
        return [...nameTokens, ...supplementalSlugTokens];
      })
    : (productSlugs ?? []).flatMap(tokenizeVariantSource);
  const laptopHardwareTokens = new Set(
    getLaptopHardwareDiscriminatorTokens(tokens, categorySlug)
  );
  const strongestStorageToken = tokens.reduce<string | null>(
    (strongest, token, tokenIndex) => {
      const tokenCapacity = getStorageCapacityGb(token);
      const strongestCapacity = getStorageCapacityGb(strongest ?? '') ?? 0;
      const isLikelyRam = isLikelyRamToken(
        token,
        tokens[tokenIndex + 1],
        tokens.some(
          (otherToken) =>
            (getStorageCapacityGb(otherToken) ?? 0) > (tokenCapacity ?? 0)
        ),
        laptopHardwareTokens.size > 0
      );
      return tokenCapacity && !isLikelyRam && tokenCapacity > strongestCapacity
        ? token
        : strongest;
    },
    null
  );
  return tokens.filter(
    (token, tokenIndex) =>
      CONNECTIVITY_DISCRIMINATOR_TOKENS.has(token) ||
      DIMENSION_DISCRIMINATOR_PATTERN.test(token) ||
      BATTERY_CAPACITY_DISCRIMINATOR_PATTERN.test(token) ||
      WATTAGE_DISCRIMINATOR_PATTERN.test(token) ||
      VOLTAGE_DISCRIMINATOR_PATTERN.test(token) ||
      ((categorySlug === 'monitors' || categorySlug === 'gaming-laptops') &&
        REFRESH_RATE_DISCRIMINATOR_PATTERN.test(token)) ||
      isProductVariantColorToken(token) ||
      laptopHardwareTokens.has(token) ||
      (['laptops', 'gaming-laptops'].includes(categorySlug ?? '') &&
        getStorageCapacityGb(token) !== null &&
        (tokens[tokenIndex + 1] === 'ram' ||
          /^ddr\d+$/u.test(tokens[tokenIndex + 1] ?? ''))) ||
      (isProductVariantRegionToken(token, {
        isTerminal:
          tokenIndex === tokens.length - 1 ||
          tokens
            .slice(tokenIndex + 1)
            .every(
              (suffixToken, suffixIndex) =>
                getDiscriminatorGroup(
                  suffixToken,
                  tokenIndex + suffixIndex + 1 === tokens.length - 1
                ) !== null || suffixToken === 'version'
            ),
      }) &&
        tokens
          .slice(tokenIndex + 1)
          .every(
            (suffixToken, suffixIndex) =>
              getDiscriminatorGroup(
                suffixToken,
                tokenIndex + suffixIndex + 1 === tokens.length - 1
              ) !== null || suffixToken === 'version'
          )) ||
      token === strongestStorageToken
  );
}
