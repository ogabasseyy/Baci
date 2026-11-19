import { revalidateTag } from 'next/cache';
import type { WorkStore } from 'next/dist/server/app-render/work-async-storage.external';
import { workAsyncStorage } from 'next/dist/server/app-render/work-async-storage.external';
import { describe, expect, it, vi } from 'vitest';

await vi.hoisted(async () => {
  const { AsyncLocalStorage } = await import('node:async_hooks');
  (globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage ??=
    AsyncLocalStorage;
});

import { flushOriginCacheRevalidations } from './flush-origin-cache-revalidations';

function createMockWorkStore(
  revalidateTagImpl: (tags: string | string[]) => Promise<void>
): WorkStore {
  return {
    page: '/api/internal/revalidate-products/route',
    route: '/api/internal/revalidate-products',
    cacheLifeProfiles: {
      default: { stale: 300, revalidate: 900, expire: 86400 },
    },
    useCacheTimeout: 0,
    durableUseCacheEntries: false,
    staticPageGenerationTimeout: 60,
    incrementalCache: {
      revalidateTag: revalidateTagImpl,
    },
  } as unknown as WorkStore;
}

describe('flushOriginCacheRevalidations', () => {
  it('is a no-op outside a Next work store', async () => {
    await expect(flushOriginCacheRevalidations()).resolves.toBeUndefined();
  });

  it('drains queued revalidateTag entries in-handler and clears drained items', async () => {
    const incrementalRevalidateTag = vi.fn(async () => undefined);
    const workStore = createMockWorkStore(incrementalRevalidateTag);

    await workAsyncStorage.run(workStore, async () => {
      revalidateTag('products-merchant-1', { expire: 0 });
      expect(workStore.pendingRevalidatedTags).toHaveLength(1);

      await flushOriginCacheRevalidations();

      expect(incrementalRevalidateTag).toHaveBeenCalledWith(
        ['products-merchant-1'],
        { expire: 0 }
      );
      expect(workStore.pendingRevalidatedTags).toEqual([]);
    });
  });

  it('preserves pendingRevalidatedTags and rejects when cache revalidation fails', async () => {
    const incrementalRevalidateTag = vi.fn(async () => {
      throw new Error('origin cache flush failed');
    });
    const workStore = createMockWorkStore(incrementalRevalidateTag);

    await workAsyncStorage.run(workStore, async () => {
      revalidateTag('products-merchant-1', { expire: 0 });

      await expect(flushOriginCacheRevalidations()).rejects.toThrow(
        'origin cache flush failed'
      );
      expect(workStore.pendingRevalidatedTags).toHaveLength(1);
    });
  });
});
