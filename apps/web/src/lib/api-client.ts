// Client-side API helper with CSRF protection
// Use this for all API calls that modify data

import { CSRF_HEADER_NAME, getClientCsrfToken } from '@/lib/csrf';

async function initializeCsrfToken(
  signal?: AbortSignal
): Promise<string | null> {
  try {
    const response = await fetch('/api/csrf', {
      credentials: 'include',
      cache: 'no-store',
      signal,
    });

    if (!response.ok) {
      console.warn(
        `[CSRF] Failed to initialize token via /api/csrf (${response.status}).`
      );
      return null;
    }
  } catch (error) {
    console.warn('[CSRF] Failed to initialize token via /api/csrf.', error);
    return null;
  }

  return getClientCsrfToken();
}

async function isInvalidCsrfResponse(response: Response): Promise<boolean> {
  if (response.status !== 403) {
    return false;
  }

  try {
    const data = (await response.clone().json()) as {
      error?: string;
      message?: string;
    };

    return `${data.error ?? ''} ${data.message ?? ''}`
      .toLowerCase()
      .includes('csrf');
  } catch {
    return false;
  }
}

/**
 * Fetch with CSRF protection
 * Use this instead of fetch() for all state-changing API calls
 */
export async function fetchWithCsrf(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  // Add CSRF token to headers for state-changing methods
  const method = options.method?.toUpperCase() || 'GET';
  const needsCsrf = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

  const headers = new Headers(options.headers);

  if (needsCsrf) {
    let csrfToken = getClientCsrfToken();

    if (!csrfToken) {
      console.warn(
        `[CSRF] Missing csrfToken; attempting to initialize it before sending ${method} ${url}.`
      );
      csrfToken = await initializeCsrfToken(options?.signal ?? undefined);
    }

    if (csrfToken) {
      headers.set(CSRF_HEADER_NAME, csrfToken);
    } else {
      console.warn(
        `[CSRF] Missing csrfToken after initialization; ${CSRF_HEADER_NAME} header will not be sent. State-changing requests may fail with 403.`
      );
    }
  }

  // Only set application/json when the body is a string. Non-string bodies
  // (FormData, Blob, ArrayBuffer, URLSearchParams, ReadableStream, etc.) are
  // left alone so the browser/runtime can set the correct content-type and
  // multipart boundary automatically.
  if (
    options.body &&
    typeof options.body === 'string' &&
    !headers.has('content-type')
  ) {
    headers.set('content-type', 'application/json');
  }

  const requestInit: RequestInit = {
    ...options,
    headers,
    credentials: 'include', // Include cookies for authentication
  };

  let response = await fetch(url, requestInit);

  if (needsCsrf && (await isInvalidCsrfResponse(response))) {
    const refreshedToken = await initializeCsrfToken(
      options?.signal ?? undefined
    );

    if (refreshedToken) {
      const retryHeaders = new Headers(headers);
      retryHeaders.set(CSRF_HEADER_NAME, refreshedToken);
      response = await fetch(url, {
        ...requestInit,
        headers: retryHeaders,
      });
    }
  }

  return response;
}

/**
 * POST request with CSRF protection
 */
export async function apiPost<T = unknown>(
  url: string,
  data?: unknown,
  options: Omit<RequestInit, 'body' | 'method'> = {}
): Promise<T> {
  const response = await fetchWithCsrf(url, {
    ...options,
    method: 'POST',
    body: data === undefined ? undefined : JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || error.message || 'Request failed');
  }

  return response.json();
}

/**
 * PUT request with CSRF protection
 */
export async function apiPut<T = unknown>(
  url: string,
  data?: unknown
): Promise<T> {
  const response = await fetchWithCsrf(url, {
    method: 'PUT',
    body: data ? JSON.stringify(data) : undefined,
  });

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || error.message || 'Request failed');
  }

  return response.json();
}

/**
 * PATCH request with CSRF protection
 */
export async function apiPatch<T = unknown>(
  url: string,
  data?: unknown
): Promise<T> {
  const response = await fetchWithCsrf(url, {
    method: 'PATCH',
    body: data ? JSON.stringify(data) : undefined,
  });

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || error.message || 'Request failed');
  }

  return response.json();
}

/**
 * DELETE request with CSRF protection
 */
export async function apiDelete<T = unknown>(url: string): Promise<T> {
  const response = await fetchWithCsrf(url, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || error.message || 'Request failed');
  }

  return response.json();
}

/**
 * GET request (no CSRF needed but uses same error handling)
 */
export async function apiGet<T = unknown>(
  url: string,
  options: Omit<RequestInit, 'credentials' | 'method'> = {}
): Promise<T> {
  const response = await fetch(url, {
    ...options,
    method: 'GET',
    credentials: 'include', // Include cookies for authentication
  });

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || error.message || 'Request failed');
  }

  return response.json();
}
