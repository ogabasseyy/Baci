import { describe, expect, it, vi } from 'vitest';
import type { JumiaClient } from '@/lib/jumia/client';
import {
  createProduct,
  getFeedStatus,
  updatePrice,
  updateProduct,
  updateStatus,
  updateStock,
} from '@/lib/jumia/feeds';

function createMockClient(response: unknown): JumiaClient {
  const mock: Pick<JumiaClient, 'request'> = {
    request: vi.fn().mockResolvedValue(response),
  };
  return mock as unknown as JumiaClient;
}

function createRejectingClient(error: Error): JumiaClient {
  const mock: Pick<JumiaClient, 'request'> = {
    request: vi.fn().mockRejectedValue(error),
  };
  return mock as unknown as JumiaClient;
}

describe('createProduct', () => {
  it('calls POST /feeds/products/create with shopId and products, returns feedId', async () => {
    const client = createMockClient({ feedId: 'FEED-001' });

    const products = [
      {
        name: { value: 'Test Product' },
        brand: { code: 1, name: 'TestBrand' },
        category: { code: 42 },
      },
    ];

    const result = await createProduct(client, 'SHOP-1', products);

    expect(client.request).toHaveBeenCalledWith(
      'POST',
      '/feeds/products/create',
      expect.objectContaining({ parse: expect.any(Function) }),
      { shopId: 'SHOP-1', products }
    );
    expect(result).toBe('FEED-001');
  });

  it('throws when products array is empty', async () => {
    const client = createMockClient({ feedId: 'FEED-001' });

    await expect(createProduct(client, 'SHOP-1', [])).rejects.toThrow(
      'products must be a non-empty array'
    );
    expect(client.request).not.toHaveBeenCalled();
  });

  it('propagates network errors from client.request', async () => {
    const client = createRejectingClient(new Error('Network failure'));

    const products = [
      {
        name: { value: 'Test' },
        brand: { code: 1, name: 'Brand' },
        category: { code: 1 },
      },
    ];

    await expect(createProduct(client, 'SHOP-1', products)).rejects.toThrow(
      'Network failure'
    );
  });
});

describe('updateProduct', () => {
  it('throws when products array is empty', async () => {
    const client = createMockClient({ feedId: 'FEED-002' });

    await expect(updateProduct(client, 'SHOP-1', [])).rejects.toThrow(
      'products must be a non-empty array'
    );
    expect(client.request).not.toHaveBeenCalled();
  });

  it('calls POST /feeds/products/update with shopId and products, returns feedId', async () => {
    const client = createMockClient({ feedId: 'FEED-002' });

    const products = [
      {
        id: 'PROD-1',
        name: { value: 'Updated Name' },
      },
    ];

    const result = await updateProduct(client, 'SHOP-1', products);

    expect(client.request).toHaveBeenCalledWith(
      'POST',
      '/feeds/products/update',
      expect.objectContaining({ parse: expect.any(Function) }),
      { shopId: 'SHOP-1', products }
    );
    expect(result).toBe('FEED-002');
  });

  it('propagates network errors from client.request', async () => {
    const client = createRejectingClient(new Error('Connection reset'));

    const products = [{ id: 'PROD-1', name: { value: 'Name' } }];

    await expect(updateProduct(client, 'SHOP-1', products)).rejects.toThrow(
      'Connection reset'
    );
  });
});

describe('updateStock', () => {
  it('throws when updates array is empty', async () => {
    const client = createMockClient({ feedId: 'FEED-003' });

    await expect(updateStock(client, [])).rejects.toThrow(
      'updates must be a non-empty array'
    );
    expect(client.request).not.toHaveBeenCalled();
  });

  it('calls POST /feeds/products/stock with products body, returns feedId', async () => {
    const client = createMockClient({ feedId: 'FEED-003' });

    const updates = [{ sellerSku: 'SKU-1', id: 'VAR-1', stock: 50 }];

    const result = await updateStock(client, updates);

    expect(client.request).toHaveBeenCalledWith(
      'POST',
      '/feeds/products/stock',
      expect.objectContaining({ parse: expect.any(Function) }),
      { products: updates }
    );
    expect(result).toBe('FEED-003');
  });

  it('fails closed when the selected marketplace is not uniquely addressable', async () => {
    const client = Object.assign(createMockClient({ feedId: 'FEED-003' }), {
      shopId: 'shop-1',
      marketplaceKey: 'NG-RETAIL',
      getShops: vi.fn().mockResolvedValue([
        {
          id: 'shop-1',
          businessClients: [
            { code: 'NG-RETAIL', status: 'active' },
            { code: 'NG-EXPRESS', status: 'active' },
          ],
        },
      ]),
    });

    await expect(
      updateStock(client, [{ sellerSku: 'SKU-1', id: 'VAR-1', stock: 50 }])
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('business-client selector'),
    });
    expect(client.request).not.toHaveBeenCalled();
  });

  it('fails closed for an OAuth shop with multiple active business clients', async () => {
    const client = Object.assign(createMockClient({ feedId: 'FEED-003' }), {
      shopId: 'shop-1',
      marketplaceKey: 'oauth',
      getShops: vi.fn().mockResolvedValue([
        {
          id: 'shop-1',
          businessClients: [
            { code: 'NG-RETAIL', status: 'active' },
            { code: 'GH-RETAIL', status: 'active' },
          ],
        },
      ]),
    });

    await expect(
      updateStock(client, [{ sellerSku: 'SKU-1', id: 'VAR-1', stock: 50 }])
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('business-client selector'),
    });
    expect(client.request).not.toHaveBeenCalled();
  });

  it('pushes stock for an OAuth shop with a single active business client', async () => {
    const client = Object.assign(createMockClient({ feedId: 'FEED-003' }), {
      shopId: 'shop-1',
      marketplaceKey: 'oauth',
      getShops: vi.fn().mockResolvedValue([
        {
          id: 'shop-1',
          businessClients: [{ code: 'NG-RETAIL', status: 'active' }],
        },
      ]),
    });

    await expect(
      updateStock(client, [{ sellerSku: 'SKU-1', id: 'VAR-1', stock: 50 }])
    ).resolves.toBe('FEED-003');
  });

  it('throws when sellerSku is empty', async () => {
    const client = createMockClient({ feedId: 'FEED-003' });

    const updates = [{ sellerSku: '', id: 'VAR-1', stock: 10 }];

    await expect(updateStock(client, updates)).rejects.toThrow(
      'updateStock: each sellerSku must be a non-empty string'
    );
    expect(client.request).not.toHaveBeenCalled();
  });

  it('throws when sellerSku is whitespace-only', async () => {
    const client = createMockClient({ feedId: 'FEED-003' });

    const updates = [{ sellerSku: '   ', id: 'VAR-1', stock: 10 }];

    await expect(updateStock(client, updates)).rejects.toThrow(
      'updateStock: each sellerSku must be a non-empty string'
    );
    expect(client.request).not.toHaveBeenCalled();
  });

  it('throws when stock is negative', async () => {
    const client = createMockClient({ feedId: 'FEED-003' });

    const updates = [{ sellerSku: 'SKU-1', id: 'VAR-1', stock: -5 }];

    await expect(updateStock(client, updates)).rejects.toThrow(
      'updateStock: stock must be >= 0 for sellerSku "SKU-1"'
    );
    expect(client.request).not.toHaveBeenCalled();
  });

  it('accepts stock of zero (boundary)', async () => {
    const client = createMockClient({ feedId: 'FEED-003' });

    await expect(
      updateStock(client, [{ sellerSku: 'SKU-1', id: 'VAR-1', stock: 0 }])
    ).resolves.toBe('FEED-003');
  });

  it('rejects batch when any sellerSku is empty, without calling client.request', async () => {
    const client = createMockClient({ feedId: 'FEED-003' });

    const updates = [
      { sellerSku: 'SKU-1', id: 'VAR-1', stock: 10 },
      { sellerSku: '', id: 'VAR-2', stock: 5 },
    ];

    await expect(updateStock(client, updates)).rejects.toThrow(
      'updateStock: each sellerSku must be a non-empty string'
    );
    expect(client.request).not.toHaveBeenCalled();
  });

  it('propagates errors when client.request rejects', async () => {
    const client = createRejectingClient(new Error('Server error'));

    const updates = [{ sellerSku: 'SKU-1', id: 'VAR-1', stock: 50 }];

    await expect(updateStock(client, updates)).rejects.toThrow('Server error');
  });
});

describe('updatePrice', () => {
  it('throws when updates array is empty', async () => {
    const client = createMockClient({ feedId: 'FEED-004' });

    await expect(updatePrice(client, [])).rejects.toThrow(
      'updates must be a non-empty array'
    );
    expect(client.request).not.toHaveBeenCalled();
  });

  it('calls POST /feeds/products/price with products body, returns feedId', async () => {
    const client = createMockClient({ feedId: 'FEED-004' });

    const updates = [
      {
        sellerSku: 'SKU-1',
        id: 'VAR-1',
        price: { value: 9999, currency: 'NGN' },
      },
    ];

    const result = await updatePrice(client, updates);

    expect(client.request).toHaveBeenCalledWith(
      'POST',
      '/feeds/products/price',
      expect.objectContaining({ parse: expect.any(Function) }),
      { products: updates }
    );
    expect(result).toBe('FEED-004');
  });

  it('throws when sellerSku is an empty string', async () => {
    const client = createMockClient({ feedId: 'FEED-004' });

    const updates = [
      {
        sellerSku: '',
        id: 'VAR-1',
        price: { value: 9999, currency: 'NGN' },
      },
    ];

    await expect(updatePrice(client, updates)).rejects.toThrow(
      'updatePrice: each sellerSku must be a non-empty string'
    );
    expect(client.request).not.toHaveBeenCalled();
  });

  it('throws when sellerSku is empty or whitespace', async () => {
    const client = createMockClient({ feedId: 'FEED-004' });

    const updates = [
      {
        sellerSku: '  ',
        id: 'VAR-1',
        price: { value: 9999, currency: 'NGN' },
      },
    ];

    await expect(updatePrice(client, updates)).rejects.toThrow(
      'updatePrice: each sellerSku must be a non-empty string'
    );
    expect(client.request).not.toHaveBeenCalled();
  });

  it('throws when price.value is negative', async () => {
    const client = createMockClient({ feedId: 'FEED-004' });

    const updates = [
      {
        sellerSku: 'SKU-1',
        id: 'VAR-1',
        price: { value: -100, currency: 'NGN' },
      },
    ];

    await expect(updatePrice(client, updates)).rejects.toThrow(
      'updatePrice: price.value must be a number >= 0 for sellerSku "SKU-1"'
    );
    expect(client.request).not.toHaveBeenCalled();
  });

  it('accepts price.value of 0', async () => {
    const client = createMockClient({ feedId: 'FEED-004' });

    const updates = [
      {
        sellerSku: 'SKU-1',
        id: 'VAR-1',
        price: { value: 0, currency: 'NGN' },
      },
    ];

    const result = await updatePrice(client, updates);
    expect(result).toBe('FEED-004');
  });

  it('propagates errors when client.request rejects', async () => {
    const client = createRejectingClient(new Error('Rate limited'));

    const updates = [
      {
        sellerSku: 'SKU-1',
        id: 'VAR-1',
        price: { value: 9999, currency: 'NGN' },
      },
    ];

    await expect(updatePrice(client, updates)).rejects.toThrow('Rate limited');
  });
});

describe('updateStatus', () => {
  it('throws when updates array is empty', async () => {
    const client = createMockClient({ feedId: 'FEED-005' });

    await expect(updateStatus(client, [])).rejects.toThrow(
      'updates must be a non-empty array'
    );
    expect(client.request).not.toHaveBeenCalled();
  });

  it('throws when sellerSku is empty', async () => {
    const client = createMockClient({ feedId: 'FEED-005' });

    const updates = [{ sellerSku: '', id: 'VAR-1', status: 'active' as const }];

    await expect(updateStatus(client, updates)).rejects.toThrow(
      'updateStatus: each sellerSku must be a non-empty string'
    );
    expect(client.request).not.toHaveBeenCalled();
  });

  it('throws when sellerSku is whitespace-only', async () => {
    const client = createMockClient({ feedId: 'FEED-005' });

    const updates = [
      { sellerSku: '  ', id: 'VAR-1', status: 'active' as const },
    ];

    await expect(updateStatus(client, updates)).rejects.toThrow(
      'updateStatus: each sellerSku must be a non-empty string'
    );
    expect(client.request).not.toHaveBeenCalled();
  });

  it('calls POST /feeds/products/status with products body, returns feedId', async () => {
    const client = createMockClient({ feedId: 'FEED-005' });

    const updates = [
      { sellerSku: 'SKU-1', id: 'VAR-1', status: 'active' as const },
    ];

    const result = await updateStatus(client, updates);

    expect(client.request).toHaveBeenCalledWith(
      'POST',
      '/feeds/products/status',
      expect.objectContaining({ parse: expect.any(Function) }),
      { products: updates }
    );
    expect(result).toBe('FEED-005');
  });

  it('propagates errors when client.request rejects', async () => {
    const client = createRejectingClient(new Error('Timeout'));

    const updates = [
      { sellerSku: 'SKU-1', id: 'VAR-1', status: 'active' as const },
    ];

    await expect(updateStatus(client, updates)).rejects.toThrow('Timeout');
  });
});

describe('getFeedStatus', () => {
  it('calls GET /feeds/:feedId and returns full response', async () => {
    const mockResponse = {
      feedId: 'FEED-001',
      status: 'completed',
      totalProducts: 10,
      successCount: 9,
      failureCount: 1,
      errors: [{ sku: 'SKU-BAD', message: 'Invalid category' }],
    };
    const client = createMockClient(mockResponse);

    const result = await getFeedStatus(client, 'FEED-001');

    expect(client.request).toHaveBeenCalledWith(
      'GET',
      '/feeds/FEED-001',
      expect.objectContaining({ parse: expect.any(Function) })
    );
    expect(result).toEqual(mockResponse);
  });

  it('encodes feedId with special characters', async () => {
    const client = createMockClient({ feedId: 'a/b' });

    await getFeedStatus(client, 'a/b');

    expect(client.request).toHaveBeenCalledWith(
      'GET',
      '/feeds/a%2Fb',
      expect.objectContaining({ parse: expect.any(Function) })
    );
  });

  it('propagates errors when client.request rejects', async () => {
    const client = createRejectingClient(new Error('Feed service down'));

    await expect(getFeedStatus(client, 'FEED-001')).rejects.toThrow(
      'Feed service down'
    );
  });
});
