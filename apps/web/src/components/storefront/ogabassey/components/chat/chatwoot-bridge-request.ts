import { cartRoute } from '@/hooks/cart/shared-cart-client-support';
import { buildCsrfHeaders } from '@/lib/csrf';

export async function postChatwootBridgeJson(
  path: string,
  body: Record<string, unknown>,
  storeSlug: string,
  signal?: AbortSignal
): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(cartRoute(path, storeSlug), {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: buildCsrfHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
      signal,
    });
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      return response.ok ? null : { httpStatus: response.status };
    }
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
