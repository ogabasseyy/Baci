import { PostgrestClient } from '@supabase/postgrest-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStorefrontPublicReadFetch } from './storefront-public-read-fetch';

describe('createStorefrontPublicReadFetch', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns locally without contacting Supabase during offline CI builds', async () => {
    vi.stubEnv('BACI_STOREFRONT_BUILD_READS', 'offline');
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('network access must remain disabled'));

    const response = await createStorefrontPublicReadFetch()(
      'https://production-project.supabase.co/rest/v1/products'
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      message: 'Storefront reads are disabled for this build',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('starts each queued build request with a full 30-second transport budget', async () => {
    vi.stubEnv('BACI_STOREFRONT_BUILD_READS', 'bounded');
    const releases: Array<() => void> = [];
    const timeout = vi
      .spyOn(AbortSignal, 'timeout')
      .mockImplementation(() => new AbortController().signal);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Promise<Response>((resolve) => {
          releases.push(() => resolve(new Response('ok')));
        })
    );
    const publicFetch = createStorefrontPublicReadFetch();
    const reads = Array.from({ length: 4 }, (_, index) =>
      publicFetch(`https://example.com/${index}`)
    );

    try {
      await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(3));
      expect(timeout).toHaveBeenCalledTimes(3);
      expect(timeout).toHaveBeenLastCalledWith(30_000);

      releases.shift()?.();
      await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(4));
      expect(timeout).toHaveBeenCalledTimes(4);
      expect(timeout).toHaveBeenLastCalledWith(30_000);
    } finally {
      for (const release of releases) release();
    }

    await expect(Promise.all(reads)).resolves.toHaveLength(4);
  });

  it('keeps the 10-second runtime transport deadline', async () => {
    const timeout = vi
      .spyOn(AbortSignal, 'timeout')
      .mockImplementation(() => new AbortController().signal);
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('ok'));

    await createStorefrontPublicReadFetch()('https://example.com/runtime');

    expect(timeout).toHaveBeenCalledWith(10_000);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('keeps the native timeout outcome for runtime reads', async () => {
    const timeoutController = new AbortController();
    timeoutController.abort(
      new DOMException('The operation timed out', 'TimeoutError')
    );
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeoutController.signal);
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      timeoutController.signal.reason
    );

    await expect(
      createStorefrontPublicReadFetch()('https://example.com/runtime-timeout')
    ).rejects.toBe(timeoutController.signal.reason);
  });

  it('does not retry a timed-out bounded build read in the installed PostgREST client', async () => {
    vi.stubEnv('BACI_STOREFRONT_BUILD_READS', 'bounded');
    const timeoutController = new AbortController();
    timeoutController.abort(
      new DOMException('The operation timed out', 'TimeoutError')
    );
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeoutController.signal);
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
      callback: () => void
    ) => {
      callback();
      return 0;
    }) as typeof setTimeout);
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(timeoutController.signal.reason);
    const client = new PostgrestClient('http://postgrest.test', {
      fetch: createStorefrontPublicReadFetch() as unknown as typeof fetch,
    });

    await client.from('products').select('slug');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
