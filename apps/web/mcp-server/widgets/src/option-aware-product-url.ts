import type { Product } from './widget-types';

// Search results carry an option-aware PDP link (variantId/condition params
// preselect the matched option). The served widget must honor it: a slug-only
// link discards the match and the cart handoff rejects option products, so
// both the review button and the add-to-cart handoff resolve through here.
export function resolveOptionAwareProductUrl(product: Product): {
  url: string;
  hasOptions: boolean;
} {
  const fallback = `https://ogabassey.com/products/${encodeURIComponent(product.slug || product.id)}`;
  if (typeof product.url !== 'string' || product.url === '') {
    return { url: fallback, hasOptions: false };
  }
  try {
    const parsed = new URL(product.url);
    const valid =
      parsed.origin === 'https://ogabassey.com' &&
      /^\/products\/[^/]+$/.test(parsed.pathname) &&
      !parsed.username &&
      !parsed.password;
    if (!valid) {
      return { url: fallback, hasOptions: false };
    }
    return {
      url: parsed.toString(),
      hasOptions:
        parsed.searchParams.has('variantId') ||
        parsed.searchParams.has('condition'),
    };
  } catch {
    return { url: fallback, hasOptions: false };
  }
}
