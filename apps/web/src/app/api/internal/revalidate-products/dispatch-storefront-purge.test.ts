import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPurgeStorefrontProductConfirmed = vi.fn();
const mockScheduleStorefrontProductPurge = vi.fn();
const mockPurgeStorefrontHostnameConfirmed = vi.fn();
const mockScheduleStorefrontHostnamePurge = vi.fn();

vi.mock('@/lib/storefront-product-purge', () => ({
  purgeStorefrontProductConfirmed: (...args: unknown[]) =>
    mockPurgeStorefrontProductConfirmed(...args),
  scheduleStorefrontProductPurge: (...args: unknown[]) =>
    mockScheduleStorefrontProductPurge(...args),
}));

vi.mock('@/lib/storefront-product-purge-hostnames', () => ({
  purgeStorefrontHostnameConfirmed: (...args: unknown[]) =>
    mockPurgeStorefrontHostnameConfirmed(...args),
  scheduleStorefrontHostnamePurge: (...args: unknown[]) =>
    mockScheduleStorefrontHostnamePurge(...args),
}));

import { dispatchStorefrontProductPurge } from './dispatch-storefront-purge';

const ENTRIES = [{ slug: 'iphone-15', categorySegment: 'smartphones' }];

describe('dispatchStorefrontProductPurge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('falls back to hostname purge when blogPostSlugsIncomplete is true', async () => {
    mockPurgeStorefrontHostnameConfirmed.mockResolvedValueOnce(true);

    await expect(
      dispatchStorefrontProductPurge({
        merchantSlug: 'ogabassey',
        entries: ENTRIES,
        blogPostSlugs: ['iphone-guide'],
        blogPostSlugsIncomplete: true,
        confirmEdgeEviction: true,
      })
    ).resolves.toBe(true);

    expect(mockPurgeStorefrontHostnameConfirmed).toHaveBeenCalledWith(
      'ogabassey'
    );
    expect(mockPurgeStorefrontProductConfirmed).not.toHaveBeenCalled();

    await expect(
      dispatchStorefrontProductPurge({
        merchantSlug: 'ogabassey',
        entries: ENTRIES,
        blogPostSlugs: [],
        blogPostSlugsIncomplete: true,
        confirmEdgeEviction: false,
      })
    ).resolves.toBe(false);

    expect(mockScheduleStorefrontHostnamePurge).toHaveBeenCalledWith(
      'ogabassey'
    );
    expect(mockScheduleStorefrontProductPurge).not.toHaveBeenCalled();
  });

  it('forwards blogPostSlugs when non-empty and omits options when empty for confirmed purge', async () => {
    mockPurgeStorefrontProductConfirmed
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    await expect(
      dispatchStorefrontProductPurge({
        merchantSlug: 'ogabassey',
        entries: ENTRIES,
        blogPostSlugs: ['iphone-guide'],
        blogPostSlugsIncomplete: false,
        confirmEdgeEviction: true,
      })
    ).resolves.toBe(true);

    expect(mockPurgeStorefrontProductConfirmed).toHaveBeenNthCalledWith(
      1,
      'ogabassey',
      ENTRIES,
      { blogPostSlugs: ['iphone-guide'] }
    );

    await expect(
      dispatchStorefrontProductPurge({
        merchantSlug: 'ogabassey',
        entries: ENTRIES,
        blogPostSlugs: [],
        blogPostSlugsIncomplete: false,
        confirmEdgeEviction: true,
      })
    ).resolves.toBe(false);

    expect(mockPurgeStorefrontProductConfirmed).toHaveBeenNthCalledWith(
      2,
      'ogabassey',
      ENTRIES
    );
  });

  it('schedules product purge with or without blogPostSlugs when confirmEdgeEviction is false', async () => {
    await expect(
      dispatchStorefrontProductPurge({
        merchantSlug: 'ogabassey',
        entries: ENTRIES,
        blogPostSlugs: ['iphone-guide'],
        blogPostSlugsIncomplete: false,
        confirmEdgeEviction: false,
      })
    ).resolves.toBe(false);

    expect(mockScheduleStorefrontProductPurge).toHaveBeenNthCalledWith(
      1,
      'ogabassey',
      ENTRIES,
      { blogPostSlugs: ['iphone-guide'] }
    );

    await expect(
      dispatchStorefrontProductPurge({
        merchantSlug: 'ogabassey',
        entries: ENTRIES,
        blogPostSlugs: [],
        blogPostSlugsIncomplete: false,
        confirmEdgeEviction: false,
      })
    ).resolves.toBe(false);

    expect(mockScheduleStorefrontProductPurge).toHaveBeenNthCalledWith(
      2,
      'ogabassey',
      ENTRIES
    );
  });
});
