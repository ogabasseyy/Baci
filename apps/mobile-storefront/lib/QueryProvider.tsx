/**
 * React Query Provider with Deferred Persistence Hydration
 *
 * 2026 startup best practice for mobile reliability:
 * - Keep QueryClient available immediately
 * - Defer cache restore/subscription until after splash/first paint
 * - Avoid non-critical persistence work on the splash-critical path
 */

import {
  IsRestoringProvider,
  QueryClientProvider,
} from '@tanstack/react-query';
import {
  persistQueryClientRestore,
  persistQueryClientSubscribe,
} from '@tanstack/react-query-persist-client';
import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { createLogger } from './logger';
import { queryClient, queryPersister } from './query-client';
import {
  dropNeverPersistedQueries,
  shouldPersistQuery,
} from './should-persist-query';

const log = createLogger('QueryProvider');

interface QueryProviderProps {
  children: React.ReactNode;
  /**
   * Defer cache restore/subscription until after startup splash completes.
   * Prevents persistence hydration from competing with first render on Android.
   */
  persistenceEnabled?: boolean;
}

const PERSIST_MAX_AGE_MS = 1000 * 60 * 60 * 24;

const persistOptions = {
  queryClient,
  persister: queryPersister,
  maxAge: PERSIST_MAX_AGE_MS,
  dehydrateOptions: {
    shouldDehydrateQuery: shouldPersistQuery,
  },
};

async function restorePersistedQueryCache(onSettled: () => void) {
  try {
    await persistQueryClientRestore(persistOptions);
    dropNeverPersistedQueries(queryClient);
    log.debug('Cache hydrated from persisted storage');
  } catch (error) {
    log.warn('Cache hydration failed, continuing without restore', error);
  } finally {
    onSettled();
  }
}

export function QueryProvider({
  children,
  persistenceEnabled = true,
}: QueryProviderProps) {
  const [hasRestoreSettled, setHasRestoreSettled] = useState(false);
  const hasRestoreStartedRef = useRef(false);
  const isRestoring = persistenceEnabled && !hasRestoreSettled;

  useEffect(() => {
    if (!persistenceEnabled) {
      return;
    }

    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    const startPersistence = async () => {
      if (!hasRestoreStartedRef.current) {
        hasRestoreStartedRef.current = true;
        await restorePersistedQueryCache(() => setHasRestoreSettled(true));
      }

      if (cancelled) return;
      unsubscribe = persistQueryClientSubscribe(persistOptions);
    };

    void startPersistence();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [persistenceEnabled]);

  return (
    <QueryClientProvider client={queryClient}>
      <IsRestoringProvider value={isRestoring}>{children}</IsRestoringProvider>
    </QueryClientProvider>
  );
}
