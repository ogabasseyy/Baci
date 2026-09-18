import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockOrder = vi.fn();
const mockIs = vi.fn(() => builder);
const mockEq = vi.fn(() => builder);
const builder = { eq: mockEq, is: mockIs, order: mockOrder };
const mockSelect = vi.fn(() => builder);
const mockFrom = vi.fn(() => ({ select: mockSelect }));
const mockCreateClient = vi.fn((..._args: unknown[]) => ({ from: mockFrom }));

vi.mock('next/cache', () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }));
vi.mock('@/env', () => ({
  getSupabaseUrl: vi.fn(() => 'https://test.supabase.co'),
  getSupabaseAnonKey: vi.fn(() => 'test-anon-key'),
}));
vi.mock('react', () => ({ cache: vi.fn((fn: unknown) => fn) }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}));

import { cacheLife, cacheTag } from 'next/cache';
import {
  getCachedNavigationCategories,
  getStorefrontNavigationCategories,
} from './cached-categories';
import { createPublicClient } from './supabase/public';

describe('getCachedNavigationCategories', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('returns categories in the storefront priority order on success', async () => {
    mockOrder.mockResolvedValueOnce({
      data: [
        { name: 'Audio', slug: 'audio' },
        { name: 'Smartphones', slug: 'smartphones' },
      ],
      error: null,
    });

    const result = await getCachedNavigationCategories('merchant-1');

    // smartphones is priority index 0, audio index 5 -> smartphones first.
    expect(result).toEqual([
      { name: 'Smartphones', slug: 'smartphones' },
      { name: 'Audio', slug: 'audio' },
    ]);
    expect(mockEq).toHaveBeenCalledWith('merchant_id', 'merchant-1');
    expect(mockIs).toHaveBeenCalledWith('parent_id', null);
    expect(cacheLife).toHaveBeenCalledWith('categories');
    expect(cacheTag).toHaveBeenCalledWith(
      'categories',
      'navigation-categories',
      'navigation-categories-merchant-1'
    );
  });

  it('throws on a transient error so it is never cached as an empty nav', async () => {
    const consoleSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    mockOrder.mockResolvedValueOnce({
      data: null,
      error: { code: '57014', message: 'canceling statement due to timeout' },
    });

    await expect(
      getCachedNavigationCategories('merchant-1')
    ).rejects.toMatchObject({ code: '57014' });
    expect(consoleSpy).toHaveBeenCalled();
  });

  it('returns an empty list for a merchant with no top-level categories', async () => {
    mockOrder.mockResolvedValueOnce({ data: [], error: null });

    await expect(getCachedNavigationCategories('merchant-1')).resolves.toEqual(
      []
    );
  });

  it('takes the priority lane past the bounded build-read envelope', async () => {
    vi.stubEnv('BACI_STOREFRONT_BUILD_READS', 'bounded');
    mockOrder.mockResolvedValueOnce({ data: [], error: null });
    const releases: Array<() => void> = [];
    const upstream = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) =>
        // Bulk reads park on manual releases (envelope-bound); the nav URL
        // resolves immediately to prove it never needed a release.
        String(input).includes('/nav')
          ? new Response('ok')
          : new Promise<Response>((resolve) => {
              releases.push(() => resolve(new Response('ok')));
            })
      );

    await getCachedNavigationCategories('merchant-1');
    createPublicClient({ clientInfo: 'baci-storefront-other-read-1' });
    createPublicClient({ clientInfo: 'baci-storefront-other-read-2' });
    createPublicClient({ clientInfo: 'baci-storefront-other-read-3' });

    const configuredFetches = mockCreateClient.mock.calls.map(
      ([_url, _key, options]) =>
        (options as { global?: { fetch?: typeof fetch } }).global?.fetch
    );
    // Nav client first, then the three bulk clients.
    const [navFetch, ...bulkFetches] = configuredFetches;
    const bulkReads = bulkFetches.map((bulkFetch, index) =>
      (bulkFetch ?? globalThis.fetch)(`https://example.com/bulk-${index}`)
    );

    try {
      // Bulk reads hold all three envelope slots...
      await vi.waitFor(() => expect(upstream).toHaveBeenCalledTimes(3));
      // ...yet the nav read sails through with no release: the shell-static
      // nav must land inside the prerender window, not behind bulk reads.
      await expect(
        (navFetch ?? globalThis.fetch)('https://example.com/nav')
      ).resolves.toBeInstanceOf(Response);
      expect(upstream).toHaveBeenCalledTimes(4);
    } finally {
      for (const release of releases) release();
    }

    await expect(Promise.all(bulkReads)).resolves.toHaveLength(3);
  });
});

describe('getStorefrontNavigationCategories (request-local fail-open boundary)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes successful navigation categories straight through', async () => {
    mockOrder.mockResolvedValueOnce({
      data: [{ name: 'Smartphones', slug: 'smartphones' }],
      error: null,
    });

    await expect(
      getStorefrontNavigationCategories('merchant-1')
    ).resolves.toEqual([{ name: 'Smartphones', slug: 'smartphones' }]);
  });

  it('degrades a transient failure to an empty nav outside the cache scope', async () => {
    const consoleSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    mockOrder.mockResolvedValueOnce({
      data: null,
      error: { code: '57014', message: 'canceling statement due to timeout' },
    });

    await expect(
      getStorefrontNavigationCategories('merchant-1')
    ).resolves.toEqual([]);
    expect(consoleSpy).toHaveBeenCalledWith(
      'Navigation categories query failed outside cache:',
      expect.objectContaining({ merchantId: 'merchant-1' })
    );
  });

  it('serves a direct uncached read when the cache scope ended mid-prerender', async () => {
    const consoleSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    mockOrder.mockRejectedValueOnce(
      Object.assign(
        new Error(
          'During prerendering, "use cache" called after prerender ended rejects'
        ),
        { digest: 'HANGING_PROMISE_REJECTION' }
      )
    );
    mockOrder.mockResolvedValueOnce({
      data: [
        { name: 'Audio', slug: 'audio' },
        { name: 'Smartphones', slug: 'smartphones' },
      ],
      error: null,
    });

    // The cached fill throws; the boundary answers with one direct read, so
    // prerendered pages keep their real nav instead of an empty one.
    await expect(
      getStorefrontNavigationCategories('merchant-1')
    ).resolves.toEqual([
      { name: 'Smartphones', slug: 'smartphones' },
      { name: 'Audio', slug: 'audio' },
    ]);
    expect(consoleSpy).not.toHaveBeenCalledWith(
      'Navigation categories query failed outside cache:',
      expect.anything()
    );
  });

  it('matches the prerender-ended guard by message when no digest is set', async () => {
    const consoleSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    mockOrder.mockRejectedValueOnce(
      new Error('"use cache" called after prerender ended')
    );
    mockOrder.mockResolvedValueOnce({
      data: [{ name: 'Smartphones', slug: 'smartphones' }],
      error: null,
    });

    await expect(
      getStorefrontNavigationCategories('merchant-1')
    ).resolves.toEqual([{ name: 'Smartphones', slug: 'smartphones' }]);
    expect(consoleSpy).not.toHaveBeenCalledWith(
      'Navigation categories query failed outside cache:',
      expect.anything()
    );
  });

  it('returns a quiet empty nav when the prerender itself ended (fetch variant)', async () => {
    const consoleSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    mockOrder.mockRejectedValueOnce(
      new Error(
        'During prerendering, fetch() rejects when the prerender is complete. ' +
          'Typically these errors are handled by React.'
      )
    );

    // The prerender is over: no retry (a second fetch would fail identically),
    // no log line (expected build-time contention, not a data failure).
    await expect(
      getStorefrontNavigationCategories('merchant-1')
    ).resolves.toEqual([]);
    expect(mockOrder).toHaveBeenCalledTimes(1);
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it('stays quiet when the retry loses the prerender-teardown race too', async () => {
    const consoleSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    mockOrder.mockRejectedValueOnce(
      Object.assign(new Error('cache scope ended mid-prerender'), {
        digest: 'HANGING_PROMISE_REJECTION',
      })
    );
    mockOrder.mockRejectedValueOnce(
      new Error(
        'During prerendering, fetch() rejects when the prerender is complete.'
      )
    );

    await expect(
      getStorefrontNavigationCategories('merchant-1')
    ).resolves.toEqual([]);
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it('still degrades to an empty nav when the direct read fails too', async () => {
    const consoleSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    mockOrder.mockRejectedValueOnce(
      Object.assign(new Error('prerender ended'), {
        digest: 'HANGING_PROMISE_REJECTION',
      })
    );
    mockOrder.mockRejectedValueOnce(new Error('connection refused'));

    await expect(
      getStorefrontNavigationCategories('merchant-1')
    ).resolves.toEqual([]);
    expect(consoleSpy).toHaveBeenCalledWith(
      'Navigation categories query failed outside cache:',
      expect.objectContaining({ merchantId: 'merchant-1' })
    );
  });
});

describe('cached-categories cache directive', () => {
  const source = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), 'cached-categories.ts'),
    'utf8'
  );

  it('reads nav categories off the local cache handler with a bounded life', () => {
    // PR4a: ~19-row {name,slug} indexed read (<10ms). No cross-instance need,
    // and the coarse remote SET is the exit-128 write hazard the plan targets.
    expect(source).not.toContain("'use cache: remote';");
    expect(source).toContain("'use cache';");
    expect(source).toContain("cacheLife('categories');");
  });
});
