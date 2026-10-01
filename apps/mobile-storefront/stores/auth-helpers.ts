/**
 * Auth store helper utilities — extracted from auth-store.ts to keep the
 * main store file focused on state management and action definitions.
 */

/** Timeout (ms) for each Supabase query during initialization.
 *  Android on poor cellular can stall indefinitely without a client-side limit. */
export const INIT_QUERY_TIMEOUT_MS = 10_000;

/** Race a promise/thenable against a timeout. Rejects with a descriptive error
 *  if the timeout fires first. Accepts Supabase query builders (thenables). */
export function initTimeout<T>(
  promiseOrThenable: PromiseLike<T>,
  label: string
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return Promise.race([
    Promise.resolve(promiseOrThenable),
    new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(
          new Error(
            `Timeout: ${label} took longer than ${INIT_QUERY_TIMEOUT_MS}ms`
          )
        );
      }, INIT_QUERY_TIMEOUT_MS);
    }),
  ]).finally(() => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  });
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isInitTimeoutError(error: unknown, label?: string): boolean {
  if (!(error instanceof Error)) return false;

  const expectedPrefix = label
    ? `Timeout: ${label} took longer than `
    : 'Timeout: ';

  return (
    error.message.startsWith(expectedPrefix) &&
    error.message.endsWith('ms') &&
    error.message.includes('took longer than ')
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object');
}

export function shouldInvalidateSessionOnGetUserError(error: unknown): boolean {
  if (!isRecord(error)) return false;

  const status =
    typeof error.status === 'number' ? (error.status as number) : null;
  const code = typeof error.code === 'string' ? error.code.toLowerCase() : '';
  const message =
    typeof error.message === 'string' ? error.message.toLowerCase() : '';

  // Retryable/network auth errors should not force sign-out on mobile startup.
  if (status !== null) {
    if (status >= 500) return false;
    if (status === 400 || status === 401 || status === 403) return true;
  }

  if (
    code === 'bad_jwt' ||
    code === 'invalid_jwt' ||
    code === 'jwt_expired' ||
    code === 'session_not_found'
  ) {
    return true;
  }

  return (
    message.includes('jwt') ||
    message.includes('session missing') ||
    message.includes('invalid token') ||
    message.includes('token expired')
  );
}
