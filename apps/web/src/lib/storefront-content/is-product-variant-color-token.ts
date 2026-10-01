import { PRODUCT_VARIANT_COLOR_TOKENS } from '@/config/product-variant-color-tokens';

/** Recognizes stable single-token catalog color variants. */
export function isProductVariantColorToken(token: string) {
  return PRODUCT_VARIANT_COLOR_TOKENS.has(token);
}
