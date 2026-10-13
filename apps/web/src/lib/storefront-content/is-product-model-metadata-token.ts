const MODEL_METADATA_TOKEN_PATTERN =
  /^(?:ddr\d+|intel|ram|ssd|vram|(?:\d+(?:gb|tb|mb)){2,}|\d+(?:gb|tb|mb|g|inch|in|hz|mah|mp|w|v|mm|cm|kg|ms)|\d{4,}[a-z]{2,})$/u;
const MONITOR_RESOLUTION_TOKENS = new Set(['4k', '8k', 'fhd', 'qhd', 'uhd']);
const MONITOR_DESCRIPTOR_TOKENS = new Set(['gaming', 'oled']);

/** Identifies catalog specifications that should not become product identity. */
export function isProductModelMetadataToken(
  token: string,
  categorySlug: string
) {
  if (categorySlug === 'printers') {
    return false;
  }
  return (
    MODEL_METADATA_TOKEN_PATTERN.test(token) ||
    (categorySlug === 'monitors' &&
      (MONITOR_RESOLUTION_TOKENS.has(token) ||
        MONITOR_DESCRIPTOR_TOKENS.has(token)))
  );
}
