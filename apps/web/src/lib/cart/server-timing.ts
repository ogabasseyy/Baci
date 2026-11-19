import { createServerTimer, type ServerTimer } from '@/lib/server-timing';

/**
 * Per-step durations for a cart request, exposed as a `Server-Timing`
 * response header so latency can be read from any browser against the live
 * store. Durations only: step names are fixed tokens chosen by the route,
 * and no request, cart, shopper or merchant data is ever included.
 */
export type CartServerTimer = ServerTimer;

export function createCartServerTimer(now?: () => number): CartServerTimer {
  return createServerTimer(now ? { now } : {});
}
