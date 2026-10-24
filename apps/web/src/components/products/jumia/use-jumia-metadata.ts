'use client';

import { useEffect, useState } from 'react';
import type { z } from 'zod';
import { requestDeadline } from './request-deadline';

type MetadataState<T> = {
  url: string;
  data: T | null;
  status: 'idle' | 'loading' | 'success' | 'error';
  error: string | null;
};

/** Every read owns a cancellation fence, including fetch implementations ignoring abort. */
export function useJumiaMetadata<T>(
  url: string,
  schema: z.ZodType<T>,
  enabled: boolean
) {
  const [attempt, setAttempt] = useState(0);
  const requestKey = JSON.stringify([url, attempt]);
  const [state, setState] = useState<MetadataState<T>>({
    url: requestKey,
    data: null,
    status: 'idle',
    error: null,
  });
  const visible =
    state.url === requestKey
      ? state
      : { url: requestKey, data: null, status: 'idle' as const, error: null };
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setState({ url: requestKey, data: null, status: 'loading', error: null });
    void requestDeadline
      .run(
        async (signal) => {
          const response = await fetch(url, { signal });
          if (!response.ok) throw new Error('Metadata unavailable');
          return schema.parse(await response.json());
        },
        {
          parentSignal: controller.signal,
          timeoutMs: 10_000,
          timeoutMessage:
            'Jumia metadata request timed out. Retry to continue.',
        }
      )
      .then((data) => {
        if (!controller.signal.aborted)
          setState({ url: requestKey, data, status: 'success', error: null });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setState({
            url: requestKey,
            data: null,
            status: 'error',
            error:
              error instanceof DOMException && error.name === 'TimeoutError'
                ? error.message
                : 'Jumia metadata could not be loaded. Retry to continue.',
          });
      });
    return () => controller.abort();
  }, [url, schema, enabled, requestKey]);
  return { ...visible, retry: () => setAttempt((value) => value + 1) };
}
