import { MAX_PUBLIC_OBSERVATION_ROUTES } from './public-observation-resource-limit';

export const PUBLIC_ROUTE_TIMEOUT_MS = 20_000;
export const PUBLIC_COMMERCE_STEP_TIMEOUT_MS = 45_000;

export function publicObservationTimeoutMs(routeCount: number): number {
  if (
    !Number.isInteger(routeCount) ||
    routeCount < 1 ||
    routeCount > MAX_PUBLIC_OBSERVATION_ROUTES
  )
    throw Error('PUBLIC_ROUTES_INVALID');
  // Startup, the per-route browser checks, the commerce journey and teardown.
  return (
    30_000 +
    routeCount * PUBLIC_ROUTE_TIMEOUT_MS +
    7 * PUBLIC_COMMERCE_STEP_TIMEOUT_MS
  );
}
