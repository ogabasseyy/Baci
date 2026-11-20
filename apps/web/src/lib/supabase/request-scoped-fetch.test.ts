import { afterEach, expect, it, vi } from 'vitest';
import { requestScopedFetch } from './request-scoped-fetch';

afterEach(() => vi.unstubAllGlobals());

it.each([
  'request',
  'query',
])('aborts the fetch when the %s signal is cancelled', async (cancel) => {
  const request = new AbortController();
  const query = new AbortController();
  const upstream = vi.fn<typeof fetch>(async () => new Response(null));
  vi.stubGlobal('fetch', upstream);
  await requestScopedFetch(request.signal)(
    new Request('https://fixture.supabase.co/auth/v1/user', {
      signal: query.signal,
    })
  );
  const signal = upstream.mock.calls[0]?.[1]?.signal;
  expect(signal?.aborted).toBe(false);
  (cancel === 'request' ? request : query).abort();
  expect(signal?.aborted).toBe(true);
});
