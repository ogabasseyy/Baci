import { isProductVariantColorToken } from './is-product-variant-color-token';
import { isProductVariantRegionToken } from './is-product-variant-region-token';
import { normalizeVariantDiscriminatorTokens } from './normalize-variant-discriminator-tokens';

const VARIANT_TOKEN_PATTERN =
  /^(?:\d+(?:\.\d+)?(?:g|gb|tb|mb|mm|inch|mah|w|v)|\d+hz|4g|5g|active|anc|bluetooth|cellular|classic|corei[3579]|coreultra\d+|\d{4,}[uhtpkgfy]|digital|disc|dual|edge|esim|fe|flip|fold|gps|lite|lte|max|mini|nano|neo|physical|plus|power|prime|pro|rtx\d+|s|se|sim|single|ultra|wifi|x|xl)$/u;
const CONTEXT_TOKENS = new Set([
  'buyer',
  'compare',
  'comparison',
  'guide',
  'model',
  'review',
  'variant',
]);

/** Identifies a compare segment that contains variant metadata but no product phrase. */
export function isVariantOnlyComparisonSegment(tokens: string[]) {
  const normalized = normalizeVariantDiscriminatorTokens(tokens);
  const isVariantToken = (token: string, index: number) =>
    VARIANT_TOKEN_PATTERN.test(token) ||
    isProductVariantColorToken(token) ||
    isProductVariantRegionToken(token, {
      isTerminal: index === normalized.length - 1,
      nextToken: normalized[index + 1],
    });
  return (
    normalized.some(isVariantToken) &&
    normalized.every(
      (token, index) =>
        isVariantToken(token, index) || CONTEXT_TOKENS.has(token)
    )
  );
}
