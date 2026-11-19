// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { fetchWithCsrf } from './api-client';
import * as csrf from './csrf';

afterEach(() => vi.restoreAllMocks());
it('checks admission after CSRF initialization and never starts a denied attempt', async () => {
  let release: () => void = () => {};
  const wait = new Promise<void>((r) => {
    release = r;
  });
  let allowed = true;
  vi.spyOn(csrf, 'getClientCsrfToken').mockReturnValue(null);
  const fetch = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (url) => {
      if (url === '/api/csrf') {
        await wait;
        return new Response('{}');
      }
      return new Response('{}');
    });
  const start = vi.fn();
  const p = fetchWithCsrf(
    '/command',
    { method: 'POST' },
    {
      beforeAttempt: () =>
        allowed ? { allowed: true } : { allowed: false, code: 'STALE_ROUTE' },
      onAttemptStart: start,
    }
  );
  allowed = false;
  release();
  await expect(p).rejects.toMatchObject({
    code: 'STALE_ROUTE',
    attempted: false,
  });
  expect(fetch.mock.calls.map((c) => c[0])).toEqual(['/api/csrf']);
  expect(start).not.toHaveBeenCalled();
});
it('denied CSRF retry retains definitive rejection provenance and records attempts exactly at fetch', async () => {
  let allowed = true;
  const events: string[] = [];
  vi.spyOn(csrf, 'getClientCsrfToken').mockReturnValue('token');
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    events.push(String(url));
    if (url === '/api/csrf') {
      allowed = false;
      return new Response('{}');
    }
    return new Response('{"error":"invalid csrf"}', { status: 403 });
  });
  await expect(
    fetchWithCsrf(
      '/command',
      { method: 'POST' },
      {
        beforeAttempt: () =>
          allowed ? { allowed: true } : { allowed: false, code: 'STALE_ROUTE' },
        onAttemptStart: () => events.push('attempt'),
      }
    )
  ).rejects.toMatchObject({ attempted: true, priorOutcome: 'csrf-rejected' });
  expect(events).toEqual(['attempt', '/command', '/api/csrf']);
});
