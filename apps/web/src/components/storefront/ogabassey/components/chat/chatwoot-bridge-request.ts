import { cartRoute } from '@/hooks/cart/shared-cart-client-support';
import { buildCsrfHeaders } from '@/lib/csrf';

export async function postChatwootBridgeJson(
  path: string,
  body: Record<string, unknown>,
  storeSlug: string,
  signal?: AbortSignal,
  options: { allowNonOkResponse?: boolean } = {}
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
    if (!response.ok && !options.allowNonOkResponse) return null;
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      return response.ok ? null : { httpStatus: response.status };
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    // Keep the HTTP status of non-OK JSON so callers can tell a gateway
    // failure (outcome unknown) from a definitive application rejection.
    return response.ok
      ? (value as Record<string, unknown>)
      : { ...(value as Record<string, unknown>), httpStatus: response.status };
  } catch {
    return null;
  }
}
