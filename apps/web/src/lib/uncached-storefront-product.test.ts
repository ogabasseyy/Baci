import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  client: {},
  getStorefrontSnapshotSupabaseClient: vi.fn(),
  normalize: vi.fn(),
  read: vi.fn(),
  sanitize: vi.fn(),
}));

vi.mock('./storefront-pdp-snapshot-client', () => ({
  getStorefrontSnapshotSupabaseClient:
    mocks.getStorefrontSnapshotSupabaseClient,
}));
vi.mock('./storefront-pdp-core-normalizer', () => ({
  normalizeCachedStorefrontPdpCore: mocks.normalize,
}));
vi.mock('./public-fulfillment-sanitizer', () => ({
  sanitizePublicProduct: mocks.sanitize,
}));
vi.mock('./storefront-pdp-core-snapshot', () => ({
  readStorefrontPdpCoreSnapshot: mocks.read,
}));

import { getUncachedProductWithDetails } from './uncached-storefront-product';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getStorefrontSnapshotSupabaseClient.mockReturnValue(mocks.client);
  mocks.read.mockResolvedValue({
    status: 'found',
    value: { kind: 'product', product: { id: 'product-1' } },
  });
  mocks.normalize.mockReturnValue({ id: 'product-1', price: 100 });
  mocks.sanitize.mockReturnValue({ id: 'product-1', price: 100 });
});

describe('getUncachedProductWithDetails', () => {
  it('reads the direct merchant-scoped snapshot and applies shared mapping sanitation', async () => {
    const result = await getUncachedProductWithDetails(
      'trusted-merchant',
      'phone-one'
    );

    expect(mocks.read).toHaveBeenCalledWith(mocks.client, {
      merchantId: 'trusted-merchant',
      productSlug: 'phone-one',
    });
    expect(mocks.normalize).toHaveBeenCalledWith({ id: 'product-1' });
    expect(mocks.sanitize).toHaveBeenCalledWith({
      id: 'product-1',
      price: 100,
    });
    expect(result).toEqual({ id: 'product-1', price: 100 });
  });

  it('returns null for a missing snapshot without normalizing it', async () => {
    mocks.read.mockResolvedValue({ status: 'not_found' });

    await expect(
      getUncachedProductWithDetails('trusted-merchant', 'missing')
    ).resolves.toBeNull();
    expect(mocks.normalize).not.toHaveBeenCalled();
  });

  it('preserves fail-closed snapshot errors', async () => {
    mocks.read.mockResolvedValue({
      status: 'unavailable',
      error: {
        kind: 'database',
        operation: 'pdp_core_snapshot',
        retryable: false,
      },
    });

    await expect(
      getUncachedProductWithDetails('trusted-merchant', 'phone-one')
    ).rejects.toMatchObject({ name: 'StorefrontReadUnavailableError' });
  });
});
