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
    ? Object.keys(colorImages).filter((label) => {
      const value = (colorImages as Record<string, unknown>)[label];
      return label.trim().length > 0 && Array.isArray(value) && value.every((item) => typeof item === 'string');
    })
    : [];
  const scalarColor = typeof color === 'string' && color.trim() ? color.trim() : undefined;
  const labels = [...(scalarColor ? [scalarColor] : []), ...storedLabels.map((label) => label.trim())];
  const colors = labels.filter((label, index) => labels.findIndex((candidate) => candidate.toLowerCase() === label.toLowerCase()) === index);
  const imagesByColor = Object.fromEntries(colors.map((label) => {
    const images = isPlainObject
      ? storedLabels.filter((mappingLabel) => mappingLabel.trim().toLowerCase() === label.toLowerCase())
        .flatMap((mappingLabel) => (colorImages as Record<string, unknown>)[mappingLabel] as string[])
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
    source: colors.length === 0 ? null : scalarColor && storedLabels.length > 0
      ? 'product.color+color_images'
      : scalarColor ? 'product.color' : 'product.color_images',
    imagesByColor,
  };
}
