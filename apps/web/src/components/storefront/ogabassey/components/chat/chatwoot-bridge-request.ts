import { cartRoute } from '@/hooks/cart/shared-cart-client-support';
import { initializeCsrfToken } from '@/lib/api-client';
import { CSRF_HEADER_NAME, getClientCsrfToken } from '@/lib/csrf';

export async function postChatwootBridgeJson(
  path: string,
  body: Record<string, unknown>,
  storeSlug: string,
  signal?: AbortSignal,
  options: { allowNonOkResponse?: boolean } = {}
): Promise<Record<string, unknown> | null> {
  try {
    const csrfToken = getClientCsrfToken() ?? (await initializeCsrfToken(signal));
    if (!csrfToken) return null;
    const response = await fetch(cartRoute(path, storeSlug), {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        [CSRF_HEADER_NAME]: csrfToken,
      },
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
    const parsedBody = { ...(value as Record<string, unknown>) };
    delete parsedBody.httpStatus;
    return {
      ...parsedBody,
      ...(!response.ok ? { httpStatus: response.status } : null),
    };
  } catch {
    return null;
  }
}
