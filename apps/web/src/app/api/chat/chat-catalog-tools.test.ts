import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handleGetProductDetails: vi.fn(),
  handleSearchProducts: vi.fn(),
}));

vi.mock('@/ai/chat-catalog-handlers', () => mocks);

import { createReadOnlyCatalogTools } from './chat-catalog-tools';

describe('read-only catalog tools', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('exposes only search and details, forwarding results to the collector', async () => {
    const onToolResult = vi.fn();
    const products = { products: [{ id: 'p1' }], total: 1 };
    const product = { id: 'p1', name: 'Phone' };
    mocks.handleSearchProducts.mockResolvedValue(products);
    mocks.handleGetProductDetails.mockResolvedValue(product);

    const tools = createReadOnlyCatalogTools('session-1', { onToolResult });

    expect(Object.keys(tools).sort()).toEqual([
      'getProductDetails',
      'searchProducts',
    ]);
    await expect(
      tools.searchProducts.execute({ query: 'phone' })
    ).resolves.toBe(JSON.stringify(products));
    await expect(
      tools.getProductDetails.execute({ productId: 'p1' })
    ).resolves.toBe(JSON.stringify(product));
    expect(mocks.handleSearchProducts).toHaveBeenCalledWith({ query: 'phone' });
    expect(mocks.handleGetProductDetails).toHaveBeenCalledWith({
      productId: 'p1',
    });
    expect(onToolResult.mock.calls).toEqual([
      ['searchProducts', products],
      ['getProductDetails', product],
    ]);
  });

  it('propagates search errors without reporting a result', async () => {
    const onToolResult = vi.fn();
    const error = new Error('Catalog unavailable');
    mocks.handleSearchProducts.mockRejectedValue(error);

    await expect(
      createReadOnlyCatalogTools('session-1', {
        onToolResult,
      }).searchProducts.execute({
        query: 'phone',
      })
    ).rejects.toBe(error);
    expect(onToolResult).not.toHaveBeenCalled();
  });
});
