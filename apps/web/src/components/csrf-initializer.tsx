'use client';

import { useEffect } from 'react';
import { getClientCsrfToken } from '@/lib/csrf';

/**
 * Client component to initialize CSRF token on app load.
 * Skips the network request when a CSRF cookie is already readable,
 * and retries once after a short delay if the initial fetch fails
 * (handles transient timing during dev server startup).
 */
export function CsrfInitializer() {
  useEffect(() => {
    if (getClientCsrfToken()) {
      return;
    }

    let cancelled = false;
    let retryTimeoutId: ReturnType<typeof setTimeout> | null = null;

    const waitForRetry = () =>
      new Promise<void>((resolve) => {
        retryTimeoutId = setTimeout(resolve, 1000);
      });

    async function initCsrf(retries = 1) {
      try {
        const response = await fetch('/api/csrf', {
          credentials: 'include',
          cache: 'no-store',
        });
        if (!response.ok && retries > 0 && !cancelled) {
          await waitForRetry();
          if (!cancelled) return initCsrf(retries - 1);
        }
      } catch {
        if (retries > 0 && !cancelled) {
          await waitForRetry();
          if (!cancelled) return initCsrf(retries - 1);
        }
      }
    }

    initCsrf();

    return () => {
      cancelled = true;
      if (retryTimeoutId) {
        clearTimeout(retryTimeoutId);
      }
    };
  }, []);

  return null;
}
