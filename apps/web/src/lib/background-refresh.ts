import { waitUntil } from '@vercel/functions';
import { SingleFlight } from './single-flight';

/**
 * Starts work nobody is waiting for. Only one refresh runs per key at a time,
 * and the platform is asked to keep the instance alive until it settles, so
 * a refresh started while answering a request is not frozen with the response.
 * A failed refresh is dropped: the caller keeps what it already had.
 */
export function createBackgroundRefresher(
  keepAlive: (pending: Promise<unknown>) => void = waitUntil
): (key: string, refresh: () => Promise<unknown>) => void {
  const flights = new SingleFlight<unknown>();
  return (key, refresh) => {
    const pending = flights.run(key, refresh).catch(() => undefined);
    try {
      keepAlive(pending);
    } catch {
      // No request context (local scripts, tests): the refresh still runs.
    }
  };
}
