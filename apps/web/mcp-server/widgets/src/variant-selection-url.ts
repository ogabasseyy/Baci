function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function getVariantSelectionUrl(result: unknown, productId: string, slug: string): string | null {
  if (!isRecord(result) || !isRecord(result.structuredContent)) return null;
  const content = result.structuredContent;
  if (content.requires_variant_selection !== true || content.product_id !== productId || typeof content.product_url !== 'string') {
    return null;
  }
  try {
    const url = new URL(content.product_url);
    return url.origin === 'https://ogabassey.com' &&
      url.pathname === `/products/${encodeURIComponent(slug)}` &&
      !url.search && !url.hash
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}
