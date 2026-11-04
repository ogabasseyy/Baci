export const NGN_GATED_PRICE_BAND_CATEGORIES = new Set<string>([
  'gaming-laptops',
  'tablets',
  'audio',
  'smartwatches',
  'playstation-5',
]);

export function isPriceBandCurrencySupported(
  categorySlug: string,
  merchantCurrency?: string | null
): boolean {
  if (NGN_GATED_PRICE_BAND_CATEGORIES.has(categorySlug)) {
    return merchantCurrency?.trim().toUpperCase() === 'NGN';
  }
  return true;
}
