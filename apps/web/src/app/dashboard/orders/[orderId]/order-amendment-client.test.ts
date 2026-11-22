import { afterEach, expect, it, vi } from 'vitest';
import {
  AmendmentRequestError,
  requestAmendment,
} from './order-amendment-client';

afterEach(() => vi.unstubAllGlobals());

it('returns current workspace data and forwards an abort signal', async () => {
  const data = { canStart: true };
  const fetch = vi.fn().mockResolvedValue(Response.json(data));
  const { signal } = new AbortController();
  vi.stubGlobal('fetch', fetch);

  await expect(
    requestAmendment('/orders/example/amendments', undefined, signal)
  ).resolves.toEqual(data);
  expect(fetch).toHaveBeenCalledExactlyOnceWith('/orders/example/amendments', {
    cache: 'no-store',
    signal,
  });
});

it('retains the conflict code and HTTP status from a validated API error', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      Response.json(
        {
          code: 'preview_stale',
          error: 'Preview again.',
        },
        { status: 409 }
      )
    )
  );
  const rejected = requestAmendment('/orders/example/amendments');
  await expect(rejected).rejects.toBeInstanceOf(AmendmentRequestError);
  await expect(rejected).rejects.toMatchObject({
    code: 'preview_stale',
    message: 'Preview again.',
    status: 409,
  });
});
