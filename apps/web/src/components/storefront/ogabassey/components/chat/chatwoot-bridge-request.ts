import { cartRoute } from '@/hooks/cart/shared-cart-client-support';
import { initializeCsrfToken } from '@/lib/api-client';
import { buildCsrfHeaders } from '@/lib/csrf';

function hasCsrfHeader(headers: Record<string, string>): boolean {
  return Object.keys(headers).some((key) => key.toLowerCase() === 'x-csrf-token');
}

export async function postChatwootBridgeJson(
  path: string,
  body: Record<string, unknown>,
  storeSlug: string,
  signal?: AbortSignal,
  options: { allowNonOkResponse?: boolean } = {}
): Promise<Record<string, unknown> | null> {
  try {
    const url = cartRoute(path, storeSlug);
    const serialized = JSON.stringify(body);
    const initialHeaders = buildCsrfHeaders({
      'Content-Type': 'application/json',
    });
    let response = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: initialHeaders,
      body: serialized,
      signal,
    });
    if (
      response.status === 403 &&
      !hasCsrfHeader(initialHeaders) &&
      !options.allowNonOkResponse
    ) {
      const csrfToken = await initializeCsrfToken(signal);
      if (csrfToken) {
        response = await fetch(url, {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: {
            'Content-Type': 'application/json',
            'x-csrf-token': csrfToken,
          },
          body: serialized,
          signal,
        });
      }
    }
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
