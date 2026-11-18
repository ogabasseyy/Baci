export function hasFeaturedImageFields(
  value: Record<string, unknown>
): boolean {
  return (
    Object.hasOwn(value, 'featured_image_url') ||
    Object.hasOwn(value, 'featured_image_width') ||
    Object.hasOwn(value, 'featured_image_height') ||
    Object.hasOwn(value, 'featured_image_variants')
  );
}
