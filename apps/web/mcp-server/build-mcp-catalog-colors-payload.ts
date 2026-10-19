import type { getMcpProductCatalogColors } from './product-catalog-colors';

export function buildMcpCatalogColorsPayload(colors: ReturnType<typeof getMcpProductCatalogColors>, meaning: string) {
  return {
    labels: colors.colors,
    source: colors.source,
    images_by_color: colors.imagesByColor,
    meaning,
  };
}
