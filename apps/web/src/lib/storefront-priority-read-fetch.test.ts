import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPriorityStorefrontReadFetch } from './storefront-priority-read-fetch';

describe('createPriorityStorefrontReadFetch', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('bypasses the build semaphore while keeping the 30-second budget', async () => {
    vi.stubEnv('BACI_STOREFRONT_BUILD_READS', 'bounded');
    const timeout = vi
      .spyOn(AbortSignal, 'timeout')
      .mockImplementation(() => new AbortController().signal);
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('ok'));

    const priorityFetch = createPriorityStorefrontReadFetch();
    // Four concurrent priority reads: all four reach the transport with no
    // release needed, unlike the shared envelope (3-at-a-time).
    await expect(
      Promise.all(
        Array.from({ length: 4 }, (_, index) =>
          priorityFetch(`https://example.com/priority-${index}`)
        )
      )
    ).resolves.toHaveLength(4);

    expect(fetchSpy).toHaveBeenCalledTimes(4);
    expect(timeout).toHaveBeenCalledTimes(4);
    expect(timeout).toHaveBeenLastCalledWith(30_000);
  });

  it('keeps the 10-second runtime transport deadline', async () => {
    const timeout = vi
      .spyOn(AbortSignal, 'timeout')
      .mockImplementation(() => new AbortController().signal);
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('ok'));

    await createPriorityStorefrontReadFetch()('https://example.com/runtime');

    expect(timeout).toHaveBeenCalledWith(10_000);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('returns locally without contacting Supabase during offline CI builds', async () => {
    vi.stubEnv('BACI_STOREFRONT_BUILD_READS', 'offline');
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('network access must remain disabled'));

    const response = await createPriorityStorefrontReadFetch()(
      'https://production-project.supabase.co/rest/v1/categories'
    );

    expect(response.status).toBe(503);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
