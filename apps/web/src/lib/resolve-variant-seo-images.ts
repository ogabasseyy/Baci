export interface VariantSeoImageSource {
  images?: string[] | null;
  primary_image?: string | null;
}

/**
 * Resolves images for a product variant's structured data.
 *
 * Precedence:
 * 1. Variant's `primary_image` (trimmed) takes top precedence.
 * 2. Variant's `images` gallery (trimmed and non-empty), deduplicated with the primary image.
 * 3. Falls back to parent `fallbackImages` when no variant-specific images exist.
 */
export function resolveVariantSeoImages(
  variant: VariantSeoImageSource,
  fallbackImages?: string[]
): string[] | undefined {
  const trimmedPrimary =
    typeof variant.primary_image === 'string'
      ? variant.primary_image.trim()
      : '';

  const rawImages = Array.isArray(variant.images) ? variant.images : [];
  const trimmedImages = rawImages
    .map((img) => (typeof img === 'string' ? img.trim() : ''))
    .filter((img) => img.length > 0);

  let variantImages: string[] | undefined;
  if (trimmedImages.length > 0) {
    variantImages = trimmedImages;
  }

  if (trimmedPrimary.length > 0) {
    variantImages = [...new Set([trimmedPrimary, ...(variantImages ?? [])])];
  }

  if (!variantImages || variantImages.length === 0) {
    return fallbackImages && fallbackImages.length > 0
      ? fallbackImages
      : undefined;
  }

  return variantImages;
}
