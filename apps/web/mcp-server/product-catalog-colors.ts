import { resolveProductVariantMedia } from '@baci/shared/lib';

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
  const storedEntries = isPlainObject
    ? Object.entries(colorImages).filter(([label]) => label.trim().length > 0)
    : [];
  const storedImageEntries = storedEntries.flatMap(([label, value]) =>
    Array.isArray(value)
      ? [[label, value.filter((image): image is string => typeof image === 'string')] as const]
      : [],
  );
  const scalarColors = typeof color === 'string'
    ? color.split(',').map((label) => label.trim()).filter(Boolean)
    : [];
  const normalizedScalars = resolveProductVariantMedia({
    productColors: scalarColors,
    variants: [],
  }).colors ?? [];
  const media = resolveProductVariantMedia({
    productColors: storedEntries.map(([label]) => label),
    colorImages: Object.fromEntries(storedImageEntries),
    variants: [],
  });
  const colors = [...normalizedScalars, ...(media.colors ?? [])]
    .filter((label, index, labels) => labels.findIndex((candidate) => candidate.toLowerCase() === label.toLowerCase()) === index);
  const imagesByColor = Object.fromEntries(colors.map((label) => {
    const matchingColor = Object.keys(media.colorImages ?? {}).find(
      (candidate) => candidate.toLowerCase() === label.toLowerCase(),
    );
    const normalizedImages = matchingColor ? media.colorImages?.[matchingColor] ?? [] : [];
    const safeImages = getSafeCatalogImageUrl
      ? normalizedImages.flatMap((image) => {
        const safeUrl = getSafeCatalogImageUrl(image);
        return safeUrl ? [safeUrl] : [];
      })
      : [];
    return [label, safeImages];
  }));
  return {
    colors,
    source: colors.length === 0 ? null : normalizedScalars.length > 0 && (media.colors?.length ?? 0) > 0
      ? 'product.color+color_images'
      : normalizedScalars.length > 0 ? 'product.color' : 'product.color_images',
    imagesByColor,
  };
}
