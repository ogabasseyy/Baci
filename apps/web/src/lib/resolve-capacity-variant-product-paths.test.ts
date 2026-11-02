import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetCachedProductCanonicalPaths } = vi.hoisted(() => ({
  mockGetCachedProductCanonicalPaths: vi.fn(),
}));

vi.mock('@/lib/cached-product-canonical-paths', () => ({
  getCachedProductCanonicalPaths: (...args: unknown[]) =>
    mockGetCachedProductCanonicalPaths(...args),
}));

import {
  getCapacityBaseSlugs,
  resolveCapacityVariantProductPaths,
} from './resolve-capacity-variant-product-paths';

describe('getCapacityBaseSlugs', () => {
  it('returns an empty list when no capacity suffix is present', () => {
    expect(getCapacityBaseSlugs('google-pixel-6')).toEqual([]);
  });

  it('strips RAM and storage suffixes into the parent base slug', () => {
    expect(getCapacityBaseSlugs('google-pixel-6-8gb-256gb')).toEqual([
      'google-pixel-6',
    ]);
  });

  it('returns the network-qualified base slug before the unqualified base slug', () => {
    expect(getCapacityBaseSlugs('samsung-galaxy-a17-128gb-5g')).toEqual([
      'samsung-galaxy-a17-5g',
      'samsung-galaxy-a17',
    ]);
  });
});

describe('resolveCapacityVariantProductPaths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCachedProductCanonicalPaths.mockResolvedValue({});
  });

  it('returns empty paths without querying when no candidate has a capacity suffix', async () => {
    const result = await resolveCapacityVariantProductPaths(
      'merchant-1',
      ['iphone-13'],
      {}
    );

    expect(result).toEqual({});
    expect(mockGetCachedProductCanonicalPaths).not.toHaveBeenCalled();
  });

  it('reuses existing product paths without an additional canonical lookup', async () => {
    const result = await resolveCapacityVariantProductPaths(
      'merchant-1',
      ['google-pixel-6-8gb-256gb'],
      { 'google-pixel-6': '/smartphones/google-pixel-6' }
    );

    expect(result).toEqual({
      'google-pixel-6-8gb-256gb': '/smartphones/google-pixel-6',
    });
    expect(mockGetCachedProductCanonicalPaths).not.toHaveBeenCalled();
  });

  it('prefers the network-qualified base path before the unqualified base path', async () => {
    mockGetCachedProductCanonicalPaths.mockResolvedValueOnce({
      'samsung-galaxy-a17': '/smartphones/samsung-galaxy-a17',
      'samsung-galaxy-a17-5g': '/smartphones/samsung-galaxy-a17-5g',
    });

    const result = await resolveCapacityVariantProductPaths(
      'merchant-1',
      ['samsung-galaxy-a17-128gb-5g'],
      {}
    );

    expect(result).toEqual({
      'samsung-galaxy-a17-128gb-5g': '/smartphones/samsung-galaxy-a17-5g',
    });
    expect(mockGetCachedProductCanonicalPaths).toHaveBeenCalledWith(
      'merchant-1',
      ['samsung-galaxy-a17-5g', 'samsung-galaxy-a17'],
      { throwOnQueryError: true }
    );
  });

  it('ignores inherited prototype properties on missing base-path lookups', async () => {
    const result = await resolveCapacityVariantProductPaths(
      'merchant-1',
      ['constructor-128gb'],
      {}
    );

    expect(result).toEqual({});
  });
});
