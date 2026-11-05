import type { ProductVariant } from './products';

export function buildVariantSchemaName(
  productName: string,
  attributes: ProductVariant['attributes']
): string {
  // Keep the product title and as many complete option values as fit.
  // Some catalog records contain full specification paragraphs as attributes.
  let variantName = Array.from(productName).slice(0, 150).join('');
  for (const value of Object.values(attributes ?? {})) {
    if (typeof value !== 'string' || !value.trim()) continue;
    const candidate = `${variantName}${variantName === productName ? ' - ' : ' / '}${value.trim()}`;
    if (Array.from(candidate).length <= 150) variantName = candidate;
  }

  return variantName;
}
