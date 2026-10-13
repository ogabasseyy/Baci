const PRODUCT_VARIANT_REGION_TOKENS = new Set([
  'ca',
  'cn',
  'eu',
  'gb',
  'global',
  'in',
  'international',
  'jp',
  'ng',
  'nigeria',
  'uae',
  'uk',
  'us',
]);

interface RegionTokenContext {
  isTerminal?: boolean;
  nextToken?: string;
}

const AMBIGUOUS_REGION_TOKENS = new Set(['in', 'us']);
const REGION_QUALIFIER_TOKENS = new Set([
  'edition',
  'model',
  'variant',
  'version',
]);
const REGION_TRAILING_VARIANT_TOKEN_PATTERN =
  /^(?:\d+(?:gb|tb|mb|mm|inch|mah|hz|w|v)|4g|5g|cellular|esim|lte|wifi)$/u;

/** Recognizes stable single-token catalog region variants. */
export function isProductVariantRegionToken(
  token: string,
  context: RegionTokenContext = {}
) {
  return (
    PRODUCT_VARIANT_REGION_TOKENS.has(token) &&
    (!AMBIGUOUS_REGION_TOKENS.has(token) ||
      context.isTerminal === true ||
      REGION_QUALIFIER_TOKENS.has(context.nextToken ?? '') ||
      REGION_TRAILING_VARIANT_TOKEN_PATTERN.test(context.nextToken ?? ''))
  );
}
