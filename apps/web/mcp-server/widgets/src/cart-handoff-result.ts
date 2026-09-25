type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function getCartHandoffUrl(result: unknown, productId: string): string | null {
  if (!isRecord(result) || !isRecord(result.structuredContent)) {
    return null;
  }

  const { success, cart_url: cartUrl } = result.structuredContent;
  if (success !== true || typeof cartUrl !== 'string') {
    return null;
  }

  try {
    const url = new URL(cartUrl);
    return url.origin === 'https://ogabassey.com' &&
      url.pathname === '/cart' &&
      url.searchParams.get('item_id') === productId
      ? url.toString()
      : null;
  } catch {
    return null;
  }
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
