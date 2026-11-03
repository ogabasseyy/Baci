export class NetworkError extends Error {
  public readonly isTimeout: boolean;
  public readonly isOffline: boolean;
  public readonly statusCode?: number;
  public readonly data?: unknown;

  constructor(
    message: string,
    options: {
      isTimeout?: boolean;
      isOffline?: boolean;
      statusCode?: number;
      data?: unknown;
    } = {}
  ) {
    super(message);
    this.name = 'NetworkError';
    this.isTimeout = options.isTimeout ?? false;
    this.isOffline = options.isOffline ?? false;
    this.statusCode = options.statusCode;
    this.data = options.data;
  }
}

const CONNECTIVITY_ERROR_PATTERN =
  /network request failed|fetch failed|connectexception|failed to connect|unable to resolve host|connection (?:reset|refused|abort(?:ed)?)|software caused connection abort|network is unreachable|econnrefused|econnreset|enotfound|etimedout/i;
const DNS_RESOLUTION_ERROR_PATTERN =
  /server with the specified hostname could not be found|(?:could not|cannot|unable to) resolve host|dns (?:lookup|resolution).*(?:fail|error)|getaddrinfo|enotfound|eai_again|name or service not known/i;

function getErrorText(error: unknown, seen = new Set<object>()): string {
  if (typeof error === 'string') {
    return error;
  }

  if (!error || typeof error !== 'object' || seen.has(error)) {
    return '';
  }

  seen.add(error);
  const messageValue = Object.hasOwn(error, 'message')
    ? Reflect.get(error, 'message')
    : undefined;
  const causeValue = Object.hasOwn(error, 'cause')
    ? Reflect.get(error, 'cause')
    : undefined;
  const message = typeof messageValue === 'string' ? messageValue : '';
  const cause = getErrorText(causeValue, seen);
  return `${message} ${cause}`.trim();
}

/**
 * React Native surfaces connection failures inconsistently across platforms:
 * iOS typically throws `TypeError: Network request failed`, while Android can
 * throw a bare Error whose message is a raw Java exception, e.g.
 * "fetch failed: java.net.ConnectException: Failed to connect to host/ip:443".
 * Detect both (including the nested `cause`) so callers surface a friendly
 * offline message instead of leaking a raw exception string to the UI — which
 * reads as "broken" to a Play reviewer.
 */
export function isConnectivityError(error: unknown): boolean {
  if (error instanceof NetworkError) {
    return false;
  }
  if (
    error instanceof TypeError &&
    error.message === 'Network request failed'
  ) {
    return true;
  }
  return CONNECTIVITY_ERROR_PATTERN.test(getErrorText(error));
}

/**
 * Returns true only for explicit DNS/hostname-resolution failures. This is
 * intentionally narrower than `isConnectivityError`: requests that time out
 * or reset after transmission are ambiguous and must not be replayed.
 */
export function isDnsResolutionError(error: unknown): boolean {
  if (error instanceof NetworkError) {
    return false;
  }

  return DNS_RESOLUTION_ERROR_PATTERN.test(getErrorText(error));
}

export function getResponseErrorMessage(data: unknown, status: number): string {
  if (typeof data === 'string' && data) {
    return data;
  }

  if (data && typeof data === 'object') {
    if ('message' in data && typeof data.message === 'string') {
      return data.message;
    }

    if ('error' in data && typeof data.error === 'string') {
      return data.error;
    }
  }

  return `Request failed with status ${status}`;
}
