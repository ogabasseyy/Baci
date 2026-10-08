/**
 * Reset derived featured-image fields when the URL changes. A payload
 * that swaps the image without resubmitting dimensions or variants
 * would otherwise keep describing the previous file. Returns whether
 * the URL changed so callers can gate downstream image effects.
 */
export function applyFeaturedImageDefaults(
  updateData: Record<string, unknown>,
  existingPost: { featured_image_url: string | null }
): boolean {
  const featuredImageUrlChanged =
    Object.hasOwn(updateData, 'featured_image_url') &&
    updateData.featured_image_url !== existingPost.featured_image_url;
  if (featuredImageUrlChanged) {
    if (!Object.hasOwn(updateData, 'featured_image_width'))
      updateData.featured_image_width = null;
    if (!Object.hasOwn(updateData, 'featured_image_height'))
      updateData.featured_image_height = null;
    if (!Object.hasOwn(updateData, 'featured_image_variants'))
      updateData.featured_image_variants = {};
  }
  return featuredImageUrlChanged;
}
