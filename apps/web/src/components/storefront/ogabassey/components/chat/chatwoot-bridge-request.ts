import { cartRoute } from '@/hooks/cart/shared-cart-client-support';
import { buildCsrfHeaders } from '@/lib/csrf';

export async function postChatwootBridgeJson(
  path: string,
  body: Record<string, unknown>,
  storeSlug: string
): Promise<Record<string, unknown> | null> {
  const response = await fetch(cartRoute(path, storeSlug), {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: buildCsrfHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  const value: unknown = await response.json();
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
