import * as Sentry from '@sentry/react-native';
import { useSegments } from 'expo-router';
import { useEffect, useRef } from 'react';

/** File-system route patterns exclude customer IDs, slugs and search params. */
export function useRouteDiagnostics(): void {
  const route = `/${useSegments().join('/')}`;
  const previousRoute = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (previousRoute.current === route) return;
    const from = previousRoute.current;
    previousRoute.current = route;
    try {
      Sentry.setTag('route', route);
      Sentry.addBreadcrumb({
        category: 'navigation',
        message: 'route_changed',
        level: 'info',
        data: { ...(from ? { from } : {}), to: route },
      });
    } catch {
      // Navigation must still work when the native SDK is unavailable.
    }
  }, [route]);
}
