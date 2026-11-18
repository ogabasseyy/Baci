// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function importQueue() {
  return import('./pending-client-exception-queue');
}

beforeEach(async () => {
  vi.resetModules();
  window.sessionStorage.clear();
  const { pendingClientExceptionQueue } = await importQueue();
  pendingClientExceptionQueue.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('pendingClientExceptionQueue', () => {
  it('persists sanitized exception context across a module reload', async () => {
    const { pendingClientExceptionQueue } = await importQueue();
    const error = new Error('Loading chunk app failed for [Filtered]');
    error.name = 'ChunkLoadError';
    error.stack = 'ChunkLoadError: Loading chunk app failed for [Filtered]';

    pendingClientExceptionQueue.enqueue(error, {
      $current_url: 'https://usebaci.com/merchant-a/products',
      email: '[Filtered]',
    });

    vi.resetModules();
    const { pendingClientExceptionQueue: reloadedQueue } = await importQueue();
    const [queued] = reloadedQueue.drain();

    expect(queued?.error).toMatchObject({
      message: 'Loading chunk app failed for [Filtered]',
      name: 'ChunkLoadError',
      stack: 'ChunkLoadError: Loading chunk app failed for [Filtered]',
    });
    expect(queued?.properties).toEqual({
      $current_url: 'https://usebaci.com/merchant-a/products',
      email: '[Filtered]',
    });
  });

  it('atomically claims an entry only once across take and drain paths', async () => {
    const { pendingClientExceptionQueue } = await importQueue();
    const id = pendingClientExceptionQueue.enqueue(
      new Error('Loading chunk app failed.')
    );

    expect(pendingClientExceptionQueue.take(id)).toBeDefined();
    expect(pendingClientExceptionQueue.take(id)).toBeUndefined();
    expect(pendingClientExceptionQueue.drain()).toEqual([]);
  });

  it('keeps only the five newest pending exceptions', async () => {
    const { pendingClientExceptionQueue } = await importQueue();

    for (let index = 0; index < 7; index += 1) {
      pendingClientExceptionQueue.enqueue(new Error(`chunk-${index}`), {
        index,
      });
    }

    expect(
      pendingClientExceptionQueue
        .drain()
        .map((entry) => entry.properties?.index)
    ).toEqual([2, 3, 4, 5, 6]);
  });

  it('restores a claimed entry when capture fails', async () => {
    const { pendingClientExceptionQueue } = await importQueue();
    const id = pendingClientExceptionQueue.enqueue(
      new Error('Loading chunk retry failed.')
    );
    const claimed = pendingClientExceptionQueue.take(id);

    expect(claimed).toBeDefined();
    if (!claimed) {
      throw new Error('Expected a claimed queue entry.');
    }

    pendingClientExceptionQueue.restore(claimed);

    expect(pendingClientExceptionQueue.take(id)).toMatchObject({ id });
  });

  it('uses the volatile fallback when sessionStorage throws', async () => {
    const throwingStorage = {
      getItem: () => {
        throw new Error('storage unavailable');
      },
      removeItem: () => {
        throw new Error('storage unavailable');
      },
      setItem: () => {
        throw new Error('storage unavailable');
      },
    } as unknown as Storage;
    vi.stubGlobal('sessionStorage', throwingStorage);
    const { pendingClientExceptionQueue } = await importQueue();

    const id = pendingClientExceptionQueue.enqueue(
      new Error('Loading chunk fallback failed.')
    );

    expect(pendingClientExceptionQueue.take(id)).toMatchObject({ id });
    expect(() => pendingClientExceptionQueue.clear()).not.toThrow();
  });

  it('never retains the volatile fallback outside a browser runtime', async () => {
    const { pendingClientExceptionQueue } = await importQueue();
    vi.stubGlobal('window', undefined);

    const id = pendingClientExceptionQueue.enqueue(
      new Error('Loading chunk server failed.')
    );

    expect(pendingClientExceptionQueue.take(id)).toBeUndefined();
    expect(pendingClientExceptionQueue.drain()).toEqual([]);
  });

  it('recovers safely from malformed persisted JSON', async () => {
    const { pendingClientExceptionQueue } = await importQueue();
    pendingClientExceptionQueue.enqueue(new Error('Loading chunk failed.'));
    const storageKey = window.sessionStorage.key(0);
    expect(storageKey).toBeTruthy();
    if (!storageKey) {
      throw new Error('Expected the pending exception storage key.');
    }
    window.sessionStorage.setItem(storageKey, '{invalid json');

    expect(pendingClientExceptionQueue.drain()).toEqual([]);
  });

  it('persists undefined exceptions and normalizes unsupported nested values', async () => {
    const { pendingClientExceptionQueue } = await importQueue();
    const id = pendingClientExceptionQueue.enqueue(undefined, {
      count: 2n,
      nested: { missing: undefined },
    });

    vi.resetModules();
    const { pendingClientExceptionQueue: reloadedQueue } = await importQueue();
    const queued = reloadedQueue.take(id);

    expect(queued?.error).toBeUndefined();
    expect(queued?.properties).toEqual({
      count: '2',
      nested: { missing: null },
    });
  });

  it('evicts entries after the pending age limit', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-12T10:00:00Z'));
    const { pendingClientExceptionQueue } = await importQueue();
    pendingClientExceptionQueue.enqueue(new Error('Loading chunk expired.'));

    vi.setSystemTime(new Date('2026-07-12T10:31:00Z'));

    expect(pendingClientExceptionQueue.drain()).toEqual([]);
  });
});
