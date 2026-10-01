import { describe, expect, it, vi } from 'vitest';
import { createStorefrontBuildReadFetch } from './storefront-build-read-fetch';

describe('createStorefrontBuildReadFetch', () => {
  it('bounds concurrent reads created by separate public clients', async () => {
    const releases: Array<() => void> = [];
    const upstream = vi.fn<typeof fetch>().mockImplementation(
      async () =>
        new Promise<Response>((resolve) => {
          releases.push(() => resolve(new Response('ok')));
        })
    );
    const clientFetches = Array.from({ length: 4 }, () =>
      createStorefrontBuildReadFetch(upstream)
    );

    const reads = clientFetches.map((clientFetch, index) =>
      clientFetch(`https://example.com/${index}`)
    );
    try {
      await vi.waitFor(() => expect(upstream).toHaveBeenCalledTimes(3));

      releases.shift()?.();
      await vi.waitFor(() => expect(upstream).toHaveBeenCalledTimes(4));
    } finally {
      for (const release of releases) release();
    }

    await expect(Promise.all(reads)).resolves.toHaveLength(4);
  });

  it('releases the next read when the active read rejects', async () => {
    const upstream = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(new Response('recovered'));
    const limitedFetch = createStorefrontBuildReadFetch(upstream);

    await expect(limitedFetch('https://example.com/first')).rejects.toThrow(
      'timeout'
    );
    await expect(
      limitedFetch('https://example.com/second')
    ).resolves.toBeInstanceOf(Response);
  });

  it('never issues fetch when the signal aborts between release and fetch', async () => {
    // The exact race the post-acquire abort check guards: a queued waiter is
    // granted a slot and its signal aborts before the resumed continuation
    // issues fetch. Without the check, the post-abort call rejects with
    // Next's "prerender complete" error and squats on the slot while failing.
    const releases: Array<() => void> = [];
    const upstream = vi.fn<typeof fetch>().mockImplementation(
      async () =>
        new Promise<Response>((resolve) => {
          releases.push(() => resolve(new Response('ok')));
        })
    );
    const limitedFetch = createStorefrontBuildReadFetch(upstream);
    const activeReads = Array.from({ length: 3 }, (_, index) =>
      limitedFetch(`https://example.com/active-${index}`)
    );
    await vi.waitFor(() => expect(upstream).toHaveBeenCalledTimes(3));

    const controller = new AbortController();
    const racerRead = limitedFetch('https://example.com/racer', {
      signal: controller.signal,
    });

    // Deterministic interleaving: abort off the first read's outer fetch.
    // Its finally grants the waiter (detaching its abort listener) before
    // the outer promise settles, so this abort lands after the grant but
    // before the resumed continuation issues fetch — FIFO microtasks run
    // the waiter continuation's first hop, then this abort, then its fetch.
    const firstRead = activeReads[0];
    void firstRead.then(() => controller.abort());
    releases.shift()?.();

    // Read signal.reason only after the abort has run (it is undefined
    // until controller.abort() executes in the interleaving above).
    const rejection = await racerRead.then(
      () => {
        throw new Error('expected the racer read to reject');
      },
      (error: unknown) => error
    );
    expect(rejection).toBe(controller.signal.reason);
    expect(upstream).not.toHaveBeenCalledWith(
      'https://example.com/racer',
      expect.anything()
    );

    // The aborted grant freed its slot: the next read proceeds normally.
    const nextRead = limitedFetch('https://example.com/next');
    await vi.waitFor(() =>
      expect(upstream).toHaveBeenCalledWith(
        'https://example.com/next',
        expect.anything()
      )
    );
    for (const release of releases) release();
    await Promise.all(activeReads);
    await expect(nextRead).resolves.toBeInstanceOf(Response);
  });

  it('does not consume a slot when a queued caller cancels', async () => {
    const releases: Array<() => void> = [];
    const upstream = vi.fn<typeof fetch>().mockImplementation(
      async () =>
        new Promise<Response>((resolve) => {
          releases.push(() => resolve(new Response('ok')));
        })
    );
    const limitedFetch = createStorefrontBuildReadFetch(upstream);
    const activeReads = Array.from({ length: 3 }, (_, index) =>
      limitedFetch(`https://example.com/active-${index}`)
    );
    await vi.waitFor(() => expect(upstream).toHaveBeenCalledTimes(3));
    const controller = new AbortController();
    const cancelledRead = limitedFetch('https://example.com/cancelled', {
      signal: controller.signal,
    });

    controller.abort();

    await expect(cancelledRead).rejects.toBe(controller.signal.reason);
    expect(upstream).toHaveBeenCalledTimes(3);
    const nextRead = limitedFetch('https://example.com/next');
    releases.shift()?.();
    await vi.waitFor(() => expect(upstream).toHaveBeenCalledTimes(4));
    for (const release of releases) release();
    await Promise.all(activeReads);
    await expect(nextRead).resolves.toBeInstanceOf(Response);
  });
});
