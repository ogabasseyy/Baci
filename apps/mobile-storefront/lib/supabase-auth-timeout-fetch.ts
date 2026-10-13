const AUTH_REFRESH_TIMEOUT_MS = 4_000;
const CHECKOUT_DEADLINE_HEADER = 'x-baci-checkout-auth-deadline';

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function authRefreshTimedOutResponse(): Response {
  return new Response(
    JSON.stringify({
      code: 'request_timeout',
      message: 'Auth refresh request timed out',
    }),
    {
      headers: { 'Content-Type': 'application/json' },
      status: 408,
    }
  );
}

function isAmbiguousRefreshResponse(response: Response): boolean {
  return (
    response.status === 408 ||
    (response.status >= 500 && response.status <= 599)
  );
}

function checkoutDeadline(
  input: RequestInfo | URL,
  init: RequestInit | undefined
): { deadline?: number; init: RequestInit | undefined } {
  const headers = new Headers(
    init?.headers ??
      (typeof Request !== 'undefined' && input instanceof Request
        ? input.headers
        : undefined)
  );
  const rawDeadline = headers.get(CHECKOUT_DEADLINE_HEADER);
  if (rawDeadline === null) return { init };

  headers.delete(CHECKOUT_DEADLINE_HEADER);
  const parsedDeadline = Number(rawDeadline);
  return {
    deadline: Number.isFinite(parsedDeadline) ? parsedDeadline : undefined,
    init: { ...init, headers },
  };
}

function attemptTimeout(timeoutMs: number, deadline?: number): number {
  return Math.max(
    0,
    Math.min(
      timeoutMs,
      deadline === undefined ? timeoutMs : deadline - Date.now()
    )
  );
}

function isRefreshSessionPayload(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const payload = value as Record<string, unknown>;
  return (
    typeof payload.access_token === 'string' &&
    payload.access_token.length > 0 &&
    typeof payload.refresh_token === 'string' &&
    payload.refresh_token.length > 0
  );
}

async function fetchBufferedBeforeDeadline(
  fetchImpl: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  timeoutMs: number
): Promise<Response | null> {
  const controller = new AbortController();
  const callerSignal = init?.signal;
  const abortFromCaller = () => controller.abort(callerSignal?.reason);
  callerSignal?.addEventListener('abort', abortFromCaller, { once: true });
  if (callerSignal?.aborted) abortFromCaller();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(null);
    }, timeoutMs);
  });
  const request = fetchImpl(input, { ...init, signal: controller.signal }).then(
    async (response) => {
      const bufferedResponse = response.clone();
      if (response.ok) {
        const payload: unknown = await bufferedResponse.json();
        if (!isRefreshSessionPayload(payload)) {
          throw new Error('Invalid successful auth refresh response');
        }
      } else {
        await bufferedResponse.arrayBuffer();
      }
      return response;
    }
  );

  try {
    return await Promise.race([request, timeout]);
  } finally {
    callerSignal?.removeEventListener('abort', abortFromCaller);
    if (timer) clearTimeout(timer);
  }
}

type RefreshAttempts = {
  canRecover: boolean;
  firstInit: RequestInit | undefined;
  firstInput: RequestInfo | URL;
  recoveryInit: RequestInit | undefined;
  recoveryInput: RequestInfo | URL;
};

function prepareRefreshAttempts(
  input: RequestInfo | URL,
  init: RequestInit | undefined
): RefreshAttempts {
  if (typeof Request !== 'undefined' && input instanceof Request) {
    try {
      const request = new Request(input, init);
      return {
        canRecover: true,
        firstInit: undefined,
        firstInput: request.clone(),
        recoveryInit: undefined,
        recoveryInput: request.clone(),
      };
    } catch {
      return {
        canRecover: false,
        firstInit: init,
        firstInput: input,
        recoveryInit: undefined,
        recoveryInput: input,
      };
    }
  }

  const bodyIsStream =
    typeof ReadableStream !== 'undefined' &&
    init?.body instanceof ReadableStream;
  return {
    canRecover: !bodyIsStream,
    firstInit: init,
    firstInput: input,
    recoveryInit: init,
    recoveryInput: input,
  };
}

export function createSupabaseAuthTimeoutFetch(
  fetchImpl: typeof fetch,
  timeoutMs = AUTH_REFRESH_TIMEOUT_MS
): typeof fetch {
  return async (input, init) => {
    const url = requestUrl(input);
    if (!url.includes('/auth/v1/token?grant_type=refresh_token')) {
      return fetchImpl(input, init);
    }

    const checkoutRequest = checkoutDeadline(input, init);
    const callerSignal =
      checkoutRequest.init?.signal ??
      (typeof Request !== 'undefined' && input instanceof Request
        ? input.signal
        : undefined);
    const attempts = prepareRefreshAttempts(input, checkoutRequest.init);
    const firstAttemptTimeout = attemptTimeout(
      timeoutMs,
      checkoutRequest.deadline
    );
    if (firstAttemptTimeout === 0) return authRefreshTimedOutResponse();

    let firstResponse: Response | null = null;
    try {
      firstResponse = await fetchBufferedBeforeDeadline(
        fetchImpl,
        attempts.firstInput,
        { ...attempts.firstInit, signal: callerSignal },
        firstAttemptTimeout
      );
    } catch (error) {
      if (callerSignal?.aborted || !attempts.canRecover) throw error;
      // A rejected request or body can still follow a provider-side token
      // rotation, so recover once under the same bounded deadline.
    }
    if (firstResponse && !isAmbiguousRefreshResponse(firstResponse)) {
      return firstResponse;
    }
    if (callerSignal?.aborted) {
      throw callerSignal.reason ?? new DOMException('Aborted', 'AbortError');
    }
    if (
      !attempts.canRecover ||
      attemptTimeout(timeoutMs, checkoutRequest.deadline) === 0
    ) {
      return authRefreshTimedOutResponse();
    }

    // A timed-out refresh may already have rotated the one-time token remotely.
    // Retry immediately while Supabase's refresh-token reuse window is open.
    try {
      const recoveryResponse = await fetchBufferedBeforeDeadline(
        fetchImpl,
        attempts.recoveryInput,
        { ...attempts.recoveryInit, signal: callerSignal },
        attemptTimeout(timeoutMs, checkoutRequest.deadline)
      );
      if (recoveryResponse && !isAmbiguousRefreshResponse(recoveryResponse)) {
        return recoveryResponse;
      }
    } catch (error) {
      if (callerSignal?.aborted) throw error;
      // Normalize a second ambiguous failure so Auth does not start its own
      // long retry loop while holding the process lock.
    }
    return authRefreshTimedOutResponse();
  };
}
