import type { getMcpProductCatalogColors } from './product-catalog-colors';

/** Catalog choices do not establish availability for a particular variant. */
export function formatMcpCatalogColors(colors: ReturnType<typeof getMcpProductCatalogColors>): string {
  return `**Catalog Colors:** ${colors.colors.join(', ')} (stored catalog color choices; stock and specific color/storage/price pairings are unconfirmed)`;
}
