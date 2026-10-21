import { AsyncLocalStorage } from 'node:async_hooks';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OgabasseyHomeHeroShellResult } from './ogabassey-home-hero-shell-data';
import type { CanonicalOgabasseyHomeMerchant } from './ogabassey-home-settled-state';

const requestCacheStorage = new AsyncLocalStorage<Map<unknown, unknown>>();

// Mirror React 19's react-server cache() dispatcher: memoize per active
// request store and return an unmemoized value when called outside a request.
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    cache: <T extends (...args: never[]) => unknown>(fn: T) =>
      ((...args: never[]) => {
        const store = requestCacheStorage.getStore();
        if (!store) {
          return fn(...args);
        }
        if (!store.has(fn)) {
          store.set(fn, fn(...args));
        }
        return store.get(fn);
      }) as T,
  };
});

function merchant(id: string): CanonicalOgabasseyHomeMerchant {
  return {
    id,
    is_published: true,
  } as unknown as CanonicalOgabasseyHomeMerchant;
}

function publishedShell(merchantId: string): OgabasseyHomeHeroShellResult {
  return {
    status: 'published',
    merchantId,
  } as unknown as OgabasseyHomeHeroShellResult;
}

describe('ogabassey-home-settled-state request isolation', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('shares settled state across render scopes of one request but never with a concurrent request', async () => {
    const state = await import('./ogabassey-home-settled-state');
    const requestA = new Map<unknown, unknown>();
    const requestB = new Map<unknown, unknown>();

    requestCacheStorage.run(requestA, () => {
      state.recordSettledCanonicalOgabasseyHomeState({
        heroShell: publishedShell('merchant-a'),
        merchant: merchant('merchant-a'),
        slug: 'ogabassey.com',
      });
    });

    const seenByB = requestCacheStorage.run(requestB, () =>
      state.peekSettledCanonicalOgabasseyHomeState()
    );
    expect(seenByB).toBeNull();

    const seenByA = requestCacheStorage.run(requestA, () =>
      state.peekSettledCanonicalOgabasseyHomeState()
    );
    expect(seenByA?.merchant?.id).toBe('merchant-a');
  });

  it('does not leak settled state through module scope outside a request', async () => {
    const state = await import('./ogabassey-home-settled-state');

    state.recordSettledCanonicalOgabasseyHomeState({
      heroShell: publishedShell('merchant-a'),
      merchant: merchant('merchant-a'),
      slug: 'ogabassey.com',
    });

    expect(state.peekSettledCanonicalOgabasseyHomeState()).toBeNull();
    expect(
      requestCacheStorage.run(new Map(), () =>
        state.peekSettledCanonicalOgabasseyHomeState()
      )
    ).toBeNull();
  });

  it('keeps failed, unpublished, or mismatched lookups unsettled so reserve/404 guards still run', async () => {
    const state = await import('./ogabassey-home-settled-state');
    const cases = [
      { heroShell: null, merchant: merchant('merchant-a') },
      { heroShell: publishedShell('merchant-a'), merchant: null },
      {
        heroShell: publishedShell('merchant-a'),
        merchant: {
          id: 'merchant-a',
          is_published: false,
        } as unknown as CanonicalOgabasseyHomeMerchant,
      },
      {
        heroShell: publishedShell('other-merchant'),
        merchant: merchant('merchant-a'),
      },
    ];
    for (const lookup of cases) {
      const settled = requestCacheStorage.run(new Map(), () => {
        state.recordSettledCanonicalOgabasseyHomeState({
          ...lookup,
          slug: 'ogabassey.com',
        });
        return state.peekSettledCanonicalOgabasseyHomeState();
      });
      expect(settled).toBeNull();
    }
  });

  it('degrades ordinary merchant lookup errors to null while rethrowing Next.js interrupts', async () => {
    const state = await import('./ogabassey-home-settled-state');

    await expect(
      state.settleCanonicalOgabasseyHomeMerchant(
        Promise.reject(new Error('transient db failure'))
      )
    ).resolves.toBeNull();

    const notFoundInterrupt = Object.assign(
      new Error('NEXT_HTTP_ERROR_FALLBACK;404'),
      {
        digest: 'NEXT_HTTP_ERROR_FALLBACK;404',
      }
    );
    await expect(
      state.settleCanonicalOgabasseyHomeMerchant(
        Promise.reject(notFoundInterrupt)
      )
    ).rejects.toThrow('NEXT_HTTP_ERROR_FALLBACK;404');
  });
});
