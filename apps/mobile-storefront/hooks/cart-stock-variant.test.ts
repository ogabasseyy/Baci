import { getStorefrontProductVariantsByProductIds } from '@/lib/storefront-product-variants';
import { resolveVariantEffectiveStock } from './cart-stock-variant';

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ error: jest.fn(), warn: jest.fn() }),
}));

jest.mock('@/lib/storefront-product-variants', () => ({
  getStorefrontProductVariantsByProductIds: jest.fn(),
}));

const mockVariants = getStorefrontProductVariantsByProductIds as jest.Mock;

function mockProjection(rows: Record<string, unknown>[] | null) {
  mockVariants.mockResolvedValue(rows === null ? null : { 'product-1': rows });
}

describe('resolveVariantEffectiveStock', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('throws a retryable error when the projection lookup fails', async () => {
    mockProjection(null);
    await expect(
      resolveVariantEffectiveStock('product-1', 'v1', 7)
    ).rejects.toThrow('Cannot verify stock availability. Please try again.');
  });

  it('reports zero when the variant is absent from the projection', async () => {
    mockProjection([{ id: 'other', stock_quantity: 5 }]);
    await expect(
      resolveVariantEffectiveStock('product-1', 'v1', 7)
    ).resolves.toBe(0);
  });

  it('bypasses the cap for unlimited tracking', async () => {
    mockProjection([
      { id: 'v1', effective_policy: 'serialized_then_unlimited' },
    ]);
    await expect(
      resolveVariantEffectiveStock('product-1', 'v1', 7)
    ).resolves.toBe(Number.MAX_SAFE_INTEGER);
  });

  it('returns exact units for strict policy', async () => {
    mockProjection([
      {
        id: 'v1',
        effective_policy: 'serialized_strict',
        available_units: 2,
      },
    ]);
    await expect(
      resolveVariantEffectiveStock('product-1', 'v1', 7)
    ).resolves.toBe(2);
  });

  it('throws when strict policy reports no unit count', async () => {
    mockProjection([{ id: 'v1', effective_policy: 'serialized_strict' }]);
    await expect(
      resolveVariantEffectiveStock('product-1', 'v1', 7)
    ).rejects.toThrow('Cannot verify stock availability. Please try again.');
  });

  it('stays unbounded on explicitly unmanaged parents', async () => {
    mockProjection([{ id: 'v1', stock_quantity: 3 }]);
    await expect(
      resolveVariantEffectiveStock('product-1', 'v1', 7, true)
    ).resolves.toBe(Number.MAX_SAFE_INTEGER);
  });

  it('uses the finite variant quantity otherwise', async () => {
    mockProjection([{ id: 'v1', stock_quantity: 3 }]);
    await expect(
      resolveVariantEffectiveStock('product-1', 'v1', 7)
    ).resolves.toBe(3);
  });

  it('inherits parent stock when the variant quantity is missing', async () => {
    mockProjection([{ id: 'v1' }]);
    await expect(
      resolveVariantEffectiveStock('product-1', 'v1', 7)
    ).resolves.toBe(7);
  });
});
