const TRANSPORT_ERROR_CODES = new Set([
  'EAI_AGAIN',
  'ECONNABORTED',
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EPIPE',
  'ETIMEDOUT',
  'UND_ERR_ABORTED',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_CLOSED',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET',
]);

const FETCH_NETWORK_TYPEERROR_MESSAGES = new Set([
  'fetch failed',
  'Failed to fetch',
  'Load failed',
  'NetworkError when attempting to fetch resource.',
]);

function hasTransportErrorCode(error) {
  const seen = new Set();
  let current = error;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    if (TRANSPORT_ERROR_CODES.has(current.code)) return true;
    current = current.cause;
  }
  return false;
}

function isAmbiguousTransportError(error) {
  if (error?.name === 'AbortError' || error?.name === 'TimeoutError')
    return true;
  if (error instanceof TypeError) {
    return (
      FETCH_NETWORK_TYPEERROR_MESSAGES.has(error.message) ||
      hasTransportErrorCode(error)
    );
  }
  return hasTransportErrorCode(error);
}

/** Test-harness recovery policy: resolve only a unique visible effect. An
 * empty, duplicate, or failed lookup leaves the outcome unknown and never
 * triggers another send. */
export async function reconcileAmbiguousSend({ send, lookup }) {
  try {
    return { result: await send(), recovered: false };
  } catch (sendError) {
    if (!isAmbiguousTransportError(sendError)) throw sendError;
    let matches;
    try {
      matches = await lookup();
    } catch (lookupError) {
      throw new Error(
        'Chatwoot send outcome remains unknown because reconciliation failed; request was not retried',
        { cause: lookupError }
      );
    }
    if (!Array.isArray(matches))
      throw new Error(
        'Chatwoot send outcome remains unknown because lookup returned an invalid result; request was not retried'
      );
    if (matches.length === 1) return { result: matches[0], recovered: true };
    if (matches.length > 1)
      throw new Error(
        'Chatwoot send outcome is ambiguous because multiple messages matched; request was not retried'
      );
    throw new Error(
      'Chatwoot send outcome remains unknown because no message was visible; request was not retried',
      { cause: sendError }
    );
  }
}
