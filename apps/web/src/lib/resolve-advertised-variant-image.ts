export interface AdvertisedVariantImageCandidate {
  primary_image?: string | null;
  images?: unknown;
}

/** Prefer only actual selected-variant imagery; never infer it from a filename. */
export function resolveAdvertisedVariantImage(
  variant?: AdvertisedVariantImageCandidate | null
): string | undefined {
  if (!variant) return undefined;
  if (
    typeof variant.primary_image === 'string' &&
    variant.primary_image.trim()
  ) {
    return variant.primary_image;
  }
  return Array.isArray(variant.images)
    ? variant.images.find(
        (image): image is string =>
          typeof image === 'string' && image.trim().length > 0
      )
    : undefined;
}
