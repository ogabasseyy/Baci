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
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return {
      ...(value as Record<string, unknown>),
      ...(!response.ok ? { httpStatus: response.status } : null),
    };
  } catch {
    return null;
  }
}
