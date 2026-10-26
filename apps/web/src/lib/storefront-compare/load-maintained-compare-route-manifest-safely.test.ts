import { describe, expect, it, vi } from 'vitest';
import { getCachedMaintainedCompareRouteManifest } from './get-cached-maintained-compare-route-manifest';
import { loadMaintainedCompareRouteManifestSafely } from './load-maintained-compare-route-manifest-safely';

vi.mock('./get-cached-maintained-compare-route-manifest', () => ({
  getCachedMaintainedCompareRouteManifest: vi.fn(),
}));

const mockGet = vi.mocked(getCachedMaintainedCompareRouteManifest);
const args = {
  merchantId: 'merchant-1',
  categorySlug: 'smartphones',
  storeSlug: 'store',
  storeUrl: 'https://store.test',
};

describe('loadMaintainedCompareRouteManifestSafely', () => {
  it('returns the maintained slugs as a set on success', async () => {
    mockGet.mockResolvedValue(['a-vs-b', 'c-vs-d']);
    await expect(
      loadMaintainedCompareRouteManifestSafely(args)
    ).resolves.toEqual(new Set(['a-vs-b', 'c-vs-d']));
  });

  it('returns an empty set instead of throwing on failure', async () => {
    mockGet.mockRejectedValue(new Error('manifest unavailable'));
    await expect(
      loadMaintainedCompareRouteManifestSafely(args)
    ).resolves.toEqual(new Set());
  });
});
