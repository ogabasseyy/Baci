import { supabase } from '@/lib/supabase';

const TIMEOUT_ERROR_MESSAGE =
  'Request timed out. Please check your connection and try again.';

export class AuthenticatedFetchPreflightError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthenticatedFetchPreflightError';
  }
}

function mergeAuthorizationHeader(
  headers: HeadersInit | undefined,
  accessToken: string
): HeadersInit {
  if (headers instanceof Headers) {
    const nextHeaders = new Headers(headers);
    nextHeaders.set('Authorization', `Bearer ${accessToken}`);
    return nextHeaders;
  }

  if (Array.isArray(headers)) {
    return [...headers, ['Authorization', `Bearer ${accessToken}`]];
  }

  return {
    ...headers,
    Authorization: `Bearer ${accessToken}`,
  };
}

export function createAuthenticatedFetch(
  url: string,
  options: RequestInit,
  timeoutMs: number
): Promise<Response> {
  return authenticatedFetch(
    url,
    options,
    timeoutMs,
    async (response) => response
  );
}

// Opt-in for mutations that require a complete response to establish outcome.
// The same request deadline covers headers and text, without a second timer.
export function createAuthenticatedFetchText(
  url: string,
  options: RequestInit,
  timeoutMs: number
): Promise<{ response: Response; text: string }> {
  return authenticatedFetch(
    url,
    options,
    timeoutMs,
    async (response) => ({ response, text: await response.text() }),
    true
  );
}

async function authenticatedFetch<T>(
  url: string,
  options: RequestInit,
  timeoutMs: number,
  readResponse: (response: Response) => Promise<T>,
  boundBody = false
): Promise<T> {
  let requestStarted = false;
  let preflightMessage = 'Could not authenticate request. Please try again.';
  let controller: AbortController | undefined;
  let callerSignal: AbortSignal | null | undefined;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const abortFromCaller = () => controller?.abort();

  try {
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();
    if (sessionError) {
      throw new AuthenticatedFetchPreflightError(sessionError.message);
    }
    if (!session?.access_token) {
      throw new AuthenticatedFetchPreflightError('Not authenticated');
    }

    preflightMessage = 'Could not prepare request. Please try again.';
    controller = new AbortController();
    const requestOptions: RequestInit = {
      ...options,
      headers: mergeAuthorizationHeader(options.headers, session.access_token),
      signal: controller.signal,
    };
    callerSignal = options.signal;
    if (callerSignal?.aborted) {
      throw new AuthenticatedFetchPreflightError(
        'Request cancelled before it was sent.'
      );
    }
    callerSignal?.addEventListener('abort', abortFromCaller, { once: true });
    let rejectDeadline: ((error: Error) => void) | undefined;
    const deadline = boundBody
      ? new Promise<never>((_resolve, reject) => {
          rejectDeadline = reject;
        })
      : null;
    timeoutId = setTimeout(() => {
      controller?.abort();
      // Some native response streams do not settle after abort. The text
      // reader must still return an indeterminate result at this deadline.
      rejectDeadline?.(new Error(TIMEOUT_ERROR_MESSAGE));
    }, timeoutMs);

    // Everything above is local preparation. After calling fetch, a failure
    // cannot prove whether the server received or committed a mutation.
    requestStarted = true;
    const result = fetch(url, requestOptions).then(readResponse);
    return deadline ? await Promise.race([result, deadline]) : await result;
  } catch (error: unknown) {
    if (!requestStarted) {
      throw error instanceof AuthenticatedFetchPreflightError
        ? error
        : new AuthenticatedFetchPreflightError(preflightMessage);
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(TIMEOUT_ERROR_MESSAGE);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    try {
      callerSignal?.removeEventListener('abort', abortFromCaller);
    } catch {
      // Listener cleanup must not replace the request's response or error.
    }
  }
}
