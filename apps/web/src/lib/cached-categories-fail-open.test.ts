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

import { getStorefrontNavigationCategories } from './cached-categories';

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
