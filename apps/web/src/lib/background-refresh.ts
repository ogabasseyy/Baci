import { waitUntil } from '@vercel/functions';
import { after } from 'next/server';
import { SingleFlight } from './single-flight';

/**
 * Asks the platform to keep the instance alive until the work settles.
 * `after` is the documented way inside a Next.js request, the proxy
 * included; the bare `waitUntil` covers callers `after` does not accept.
 * With neither (local scripts, tests) the work still runs to completion
 * whenever the instance is next active.
 */
function keepAliveForRequest(pending: Promise<unknown>): void {
  try {
    after(() => pending);
    return;
  } catch {
    // Not inside a Next.js request scope.
  }
  try {
    waitUntil(pending);
  } catch {
    // No platform request context either.
  }
}

/**
 * Starts work nobody is waiting for. Only one refresh runs per key at a time,
 * and the platform is asked to keep the instance alive until it settles, so
 * a refresh started while answering a request is not frozen with the response.
 * A failed refresh is logged and dropped: the caller keeps what it had.
 */
export function createBackgroundRefresher(
  label: string,
  keepAlive: (pending: Promise<unknown>) => void = keepAliveForRequest
): (key: string, refresh: () => Promise<unknown>) => void {
  const flights = new SingleFlight<unknown>();
  return (key, refresh) => {
    const pending = flights.run(key, refresh).catch((error: unknown) => {
      // Constant message: the label and key go in the data, not the format.
      console.error('[Background Refresh] Refresh failed', {
        label,
        key,
        error,
      });
    });
    keepAlive(pending);
  };
}
