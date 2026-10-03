/** Product-level color labels surfaced by the storefront catalog. */
export function getMcpProductCatalogColors({
  color,
  colorImages,
  getSafeCatalogImageUrl,
}: {
  color?: unknown;
  colorImages?: unknown;
  getSafeCatalogImageUrl?: (imageUrl: string | null | undefined) => string | undefined;
}): {
  colors: string[];
  source: 'product.color' | 'product.color_images' | 'product.color+color_images' | null;
  imagesByColor: Record<string, string[]>;
} {
  const isPlainObject = typeof colorImages === 'object' && colorImages !== null && !Array.isArray(colorImages) &&
    (Object.getPrototypeOf(colorImages) === Object.prototype || Object.getPrototypeOf(colorImages) === null);
  const storedLabels = isPlainObject
    ? Object.keys(colorImages).filter((label) => label.trim().length > 0)
    : [];
  const scalarColors = typeof color === 'string' ? color.split(',').map((label) => label.trim()).filter(Boolean) : [];
  const labels = [...scalarColors, ...storedLabels.map((label) => label.trim())];
  const colors = labels.filter((label, index) => labels.findIndex((candidate) => candidate.toLowerCase() === label.toLowerCase()) === index);
  const imagesByColor = Object.fromEntries(colors.map((label) => {
    const images = isPlainObject
      ? storedLabels.filter((mappingLabel) => mappingLabel.trim().toLowerCase() === label.toLowerCase())
        .flatMap((mappingLabel) => {
          const value = (colorImages as Record<string, unknown>)[mappingLabel];
          return Array.isArray(value) ? value.filter((image): image is string => typeof image === 'string') : [];
        })
      : [];
    const safeImages = getSafeCatalogImageUrl
      ? images.flatMap((image) => {
        if (typeof image !== 'string') return [];
        const safeUrl = getSafeCatalogImageUrl(image);
        return safeUrl ? [safeUrl] : [];
      })
      : [];
    return [label, safeImages];
  }));
  return {
    colors,
    source: colors.length === 0 ? null : scalarColors.length > 0 && storedLabels.length > 0
      ? 'product.color+color_images'
      : scalarColors.length > 0 ? 'product.color' : 'product.color_images',
    imagesByColor,
  };
}


type CatalogColors = ReturnType<typeof getMcpProductCatalogColors>;

/** Shared catalog-choice wording; availability remains tied to returned variants. */
export function formatMcpCatalogColors(colors: CatalogColors): string {
  return `**Catalog Colors:** ${colors.colors.join(', ')} (stored catalog color choices; stock and specific color/storage/price pairings are unconfirmed)`;
}

export function buildMcpCatalogColorsPayload(colors: CatalogColors, meaning: string) {
  return {
    labels: colors.colors,
    source: colors.source,
    images_by_color: colors.imagesByColor,
    meaning,
  };
}
