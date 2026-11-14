import { ApiError, RetryExhaustedError } from './api-core';
import { NetworkError, TimeoutError } from './fetch-with-timeout';

// Transport wording from fetch, React Native and our own timeout wrapper.
const TECHNICAL_MESSAGE =
  /fetch failed|network request failed|could not connect|timed out after|failed after \d+ attempts|^HTTP \d{3}/i;

/**
 * Whether an error's own message is written for people. Timeouts, network
 * failures, exhausted retries and server faults carry transport wording
 * ("Request timed out after 30000ms", "fetch failed: …") or nothing useful,
 * so they get the caller's plain-language fallback instead. A deliberate
 * error with customer copy (an API `{ error }` below 500, or an app error
 * thrown with its own wording) keeps its message.
 */
function isCustomerWorded(error: unknown): error is Error {
  if (!(error instanceof Error)) return false;
  if (
    error instanceof TimeoutError ||
    error instanceof NetworkError ||
    error instanceof RetryExhaustedError ||
    error instanceof TypeError
  ) {
    return false;
  }
  if (error instanceof ApiError && error.status >= 500) return false;
  // A blank message tells the customer nothing: use the fallback.
  if (error.message.trim().length === 0) return false;
  return !TECHNICAL_MESSAGE.test(error.message);
}

/** The text a customer sees for an error: its own if written for them, else the fallback. */
export function customerErrorText(error: unknown, fallback: string): string {
  return isCustomerWorded(error) ? error.message : fallback;
}
