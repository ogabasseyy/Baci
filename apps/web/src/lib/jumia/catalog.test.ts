import { describe, expect, it, vi } from 'vitest';
import {
  getAllBrands,
  getAllCategories,
  getAllProducts,
  getAttributeSet,
  getBrands,
  getCategories,
  getProducts,
  getStock,
} from '@/lib/jumia/catalog';
import type { JumiaClient } from '@/lib/jumia/client';
import {
  documentedAttributes,
  documentedCategories,
} from '@/schemas/jumia/catalog.test-fixtures.json';

function createMockClient(
  response: unknown,
  options?: { reject?: boolean }
): JumiaClient {
  return {
    request: options?.reject
      ? vi.fn().mockRejectedValue(response)
      : vi.fn().mockResolvedValue(response),
  } as unknown as JumiaClient;
}

// ── Products ──

describe('getProducts', () => {
  it('calls GET /catalog/products and returns products, nextToken, isLastPage', async () => {
    const mockProducts = [{ sku: 'SKU-1', name: 'Widget', status: 'active' }];
    const client = createMockClient({
      products: mockProducts,
      nextToken: 'abc123',
      isLastPage: false,
    });

    const result = await getProducts(client);

    expect(client.request).toHaveBeenCalledOnce();
    expect(client.request).toHaveBeenCalledWith(
      'GET',
      '/catalog/products',
      expect.any(Object)
    );
    expect(result).toEqual({
      products: mockProducts,
      nextToken: 'abc123',
      isLastPage: false,
    });
  });

  it('passes status and nextToken as query params', async () => {
    const client = createMockClient({
      products: [],
      nextToken: null,
      isLastPage: true,
    });

    await getProducts(client, { status: 'active', nextToken: 'tok99' });

    const calledPath = vi.mocked(client.request).mock.calls[0][1] as string;
    expect(calledPath).toContain('/catalog/products?');
    expect(calledPath).toContain('status=active');
    expect(calledPath).toContain('nextToken=tok99');
  });

  it('passes through nextToken and isLastPage from the validated response', async () => {
    const client = createMockClient({
      products: [],
      nextToken: null,
      isLastPage: true,
    });

    const result = await getProducts(client);

    expect(result.nextToken).toBeNull();
    expect(result.isLastPage).toBe(true);
  });

  it('propagates errors when client.request rejects', async () => {
    const client = createMockClient(new Error('Network timeout'), {
      reject: true,
    });

    await expect(getProducts(client)).rejects.toThrow('Network timeout');
  });
});

describe('getAllProducts', () => {
  it('auto-paginates through multiple pages and returns accumulated array', async () => {
    const p1 = { sku: 'SKU-1', name: 'Widget' };
    const p2 = { sku: 'SKU-2', name: 'Gadget' };

    const client = { request: vi.fn() } as unknown as JumiaClient;
    vi.mocked(client.request)
      .mockResolvedValueOnce({
        products: [p1],
        nextToken: 'page2tok',
        isLastPage: false,
      })
      .mockResolvedValueOnce({
        products: [p2],
        nextToken: null,
        isLastPage: true,
      });

    const result = await getAllProducts(client);

    expect(result).toEqual([p1, p2]);
    expect(client.request).toHaveBeenCalledTimes(2);

    // Second call should include the nextToken from first page
    const secondCallPath = vi.mocked(client.request).mock.calls[1][1] as string;
    expect(secondCallPath).toContain('nextToken=page2tok');
  });

  it('returns empty array when no products exist', async () => {
    const client = createMockClient({
      products: [],
      nextToken: null,
      isLastPage: true,
    });

    const result = await getAllProducts(client);

    expect(result).toEqual([]);
    expect(client.request).toHaveBeenCalledOnce();
  });

  it('passes status param through to each page request', async () => {
    const client = createMockClient({
      products: [],
      nextToken: null,
      isLastPage: true,
    });

    await getAllProducts(client, { status: 'inactive' });

    const calledPath = vi.mocked(client.request).mock.calls[0][1] as string;
    expect(calledPath).toContain('status=inactive');
  });

  it('propagates errors when request fails mid-pagination', async () => {
    const client = { request: vi.fn() } as unknown as JumiaClient;
    vi.mocked(client.request)
      .mockResolvedValueOnce({
        products: [{ sku: 'SKU-1' }],
        nextToken: 'page2',
        isLastPage: false,
      })
      .mockRejectedValueOnce(new Error('Connection reset'));

    await expect(getAllProducts(client)).rejects.toThrow('Connection reset');
  });
});

// ── Categories ──

describe('getCategories', () => {
  it('calls GET /catalog/categories', async () => {
    const mockCategories = documentedCategories.categories;
    const client = createMockClient(documentedCategories);

    const result = await getCategories(client);

    expect(client.request).toHaveBeenCalledWith(
      'GET',
      '/catalog/categories',
      expect.any(Object)
    );
    expect(result.categories).toEqual(mockCategories);
  });

  it('passes page param as query string', async () => {
    const client = createMockClient({
      categories: [],
      page: { current: 3, totalOfPages: 3 },
    });

    await getCategories(client, { page: 3 });

    const calledPath = vi.mocked(client.request).mock.calls[0][1] as string;
    expect(calledPath).toBe('/catalog/categories?page=3');
  });

  it('propagates errors when client.request rejects', async () => {
    const client = createMockClient(new Error('Service unavailable'), {
      reject: true,
    });

    await expect(getCategories(client)).rejects.toThrow('Service unavailable');
  });
});

describe('getAllCategories', () => {
  it('returns categories array from single-page fetch', async () => {
    const cats = documentedCategories.categories;
    const client = createMockClient({
      categories: cats,
      page: { current: 1, totalOfPages: 1 },
    });

    const result = await getAllCategories(client);

    expect(result).toEqual(cats);
    expect(client.request).toHaveBeenCalledOnce();
  });

  it('auto-paginates through multiple pages', async () => {
    const [c1, c2] = documentedCategories.categories;
    const c3 = { ...c2, code: 1020203, name: 'Home' };

    const client = { request: vi.fn() } as unknown as JumiaClient;
    vi.mocked(client.request)
      .mockResolvedValueOnce({
        categories: [c1, c2],
        page: { current: 1, totalOfPages: 2 },
      })
      .mockResolvedValueOnce({
        categories: [c3],
        page: { current: 2, totalOfPages: 2 },
      });

    const result = await getAllCategories(client);

    expect(result).toEqual([c1, c2, c3]);
    expect(client.request).toHaveBeenCalledTimes(2);

    // Verify page params on each call
    const firstPath = vi.mocked(client.request).mock.calls[0][1] as string;
    const secondPath = vi.mocked(client.request).mock.calls[1][1] as string;
    expect(firstPath).toBe('/catalog/categories?page=1');
    expect(secondPath).toBe('/catalog/categories?page=2');
  });

  it('propagates errors when request fails mid-pagination', async () => {
    const client = { request: vi.fn() } as unknown as JumiaClient;
    vi.mocked(client.request)
      .mockResolvedValueOnce({
        categories: [documentedCategories.categories[0]],
        page: { current: 1, totalOfPages: 3 },
      })
      .mockRejectedValueOnce(new Error('Gateway timeout'));

    await expect(getAllCategories(client)).rejects.toThrow('Gateway timeout');
  });
});

// ── Brands ──

describe('getBrands', () => {
  it('calls GET /catalog/brands', async () => {
    const mockBrands = [{ code: 1, name: 'Samsung' }];
    const client = createMockClient({
      brands: mockBrands,
      page: { current: 1, totalOfPages: 1 },
    });

    const result = await getBrands(client);

    expect(client.request).toHaveBeenCalledWith(
      'GET',
      '/catalog/brands',
      expect.any(Object)
    );
    expect(result.brands).toEqual(mockBrands);
  });

  it('passes page param as query string', async () => {
    const client = createMockClient({
      brands: [],
      page: { current: 2, totalOfPages: 3 },
    });

    await getBrands(client, { page: 2 });

    const calledPath = vi.mocked(client.request).mock.calls[0][1] as string;
    expect(calledPath).toBe('/catalog/brands?page=2');
  });

  it('propagates errors when client.request rejects', async () => {
    const client = createMockClient(new Error('Rate limited'), {
      reject: true,
    });

    await expect(getBrands(client)).rejects.toThrow('Rate limited');
  });
});

describe('getAllBrands', () => {
  it('auto-paginates through multiple pages', async () => {
    const b1 = { code: 1, name: 'Samsung' };
    const b2 = { code: 2, name: 'Apple' };
    const b3 = { code: 3, name: 'Nokia' };

    const client = { request: vi.fn() } as unknown as JumiaClient;
    vi.mocked(client.request)
      .mockResolvedValueOnce({
        brands: [b1, b2],
        page: { current: 1, totalOfPages: 2 },
      })
      .mockResolvedValueOnce({
        brands: [b3],
        page: { current: 2, totalOfPages: 2 },
      });

    const result = await getAllBrands(client);

    expect(result).toEqual([b1, b2, b3]);
    expect(client.request).toHaveBeenCalledTimes(2);

    // Verify page params on each call
    const firstPath = vi.mocked(client.request).mock.calls[0][1] as string;
    const secondPath = vi.mocked(client.request).mock.calls[1][1] as string;
    expect(firstPath).toBe('/catalog/brands?page=1');
    expect(secondPath).toBe('/catalog/brands?page=2');
  });

  it('returns single page without extra requests when totalOfPages is 1', async () => {
    const client = createMockClient({
      brands: [{ code: 1, name: 'OnlyBrand' }],
      page: { current: 1, totalOfPages: 1 },
    });

    const result = await getAllBrands(client);

    expect(result).toEqual([{ code: 1, name: 'OnlyBrand' }]);
    expect(client.request).toHaveBeenCalledOnce();
  });

  it('propagates errors when request fails mid-pagination', async () => {
    const client = { request: vi.fn() } as unknown as JumiaClient;
    vi.mocked(client.request)
      .mockResolvedValueOnce({
        brands: [{ code: 1, name: 'Samsung' }],
        page: { current: 1, totalOfPages: 2 },
      })
      .mockRejectedValueOnce(new Error('Server error'));

    await expect(getAllBrands(client)).rejects.toThrow('Server error');
  });
});

// ── Attribute Sets ──

describe('getAttributeSet', () => {
  it('calls GET /catalog/attribute-sets/:id with the given ID', async () => {
    const mockResponse = documentedAttributes;
    const client = createMockClient(mockResponse);

    const result = await getAttributeSet(client, 'as-42');

    expect(client.request).toHaveBeenCalledWith(
      'GET',
      '/catalog/attribute-sets/as-42',
      expect.any(Object)
    );
    expect(result).toEqual(mockResponse);
  });

  it('propagates errors when client.request rejects', async () => {
    const client = createMockClient(new Error('Not found'), { reject: true });

    await expect(getAttributeSet(client, 'as-99')).rejects.toThrow('Not found');
  });
});

// ── Stock ──

describe('getStock', () => {
  it('calls GET /catalog/stock without params', async () => {
    const client = createMockClient({
      products: [],
      nextToken: null,
      isLastPage: true,
    });

    const result = await getStock(client);

    expect(client.request).toHaveBeenCalledWith(
      'GET',
      '/catalog/stock',
      expect.any(Object)
    );
    expect(result).toEqual({ products: [], nextToken: null, isLastPage: true });
  });

  it('passes nextToken and sellerSku as query params', async () => {
    const client = createMockClient({
      products: [],
      nextToken: null,
      isLastPage: true,
    });

    await getStock(client, { nextToken: 'stok1', sellerSku: 'MY-SKU' });

    const calledPath = vi.mocked(client.request).mock.calls[0][1] as string;
    expect(calledPath).toContain('/catalog/stock?');
    expect(calledPath).toContain('nextToken=stok1');
    expect(calledPath).toContain('sellerSku=MY-SKU');
  });

  it('omits query string when no params are provided', async () => {
    const client = createMockClient({
      products: [],
      nextToken: null,
      isLastPage: true,
    });

    await getStock(client);

    const calledPath = vi.mocked(client.request).mock.calls[0][1] as string;
    expect(calledPath).toBe('/catalog/stock');
  });

  it('propagates errors when client.request rejects', async () => {
    const client = createMockClient(new Error('Forbidden'), { reject: true });

    await expect(getStock(client)).rejects.toThrow('Forbidden');
  });
});

// ── MAX_PAGES overflow safety ──

describe('getAllProducts MAX_PAGES overflow', () => {
  it('throws when pagination exceeds MAX_PAGES limit', async () => {
    const client = {
      request: vi.fn().mockImplementation(() =>
        Promise.resolve({
          products: [{ sku: 'SKU-X' }],
          nextToken: 'always-more',
          isLastPage: false,
        })
      ),
    } as unknown as JumiaClient;

    await expect(getAllProducts(client)).rejects.toThrow(
      /getAllProducts exceeded .+ pages/
    );
  });
});

describe('getAllCategories MAX_PAGES overflow', () => {
  it('throws when pagination exceeds MAX_PAGES limit', async () => {
    const client = {
      request: vi.fn().mockImplementation(() =>
        Promise.resolve({
          categories: [documentedCategories.categories[0]],
          page: { current: 1, totalOfPages: 99999 },
        })
      ),
    } as unknown as JumiaClient;

    await expect(getAllCategories(client)).rejects.toThrow(
      /getAllCategories exceeded .+ pages/
    );
  });
});

describe('getAllBrands MAX_PAGES overflow', () => {
  it('throws when pagination exceeds MAX_PAGES limit', async () => {
    const client = {
      request: vi.fn().mockImplementation(() =>
        Promise.resolve({
          brands: [{ code: 1, name: 'Infinite' }],
          page: { current: 1, totalOfPages: 99999 },
        })
      ),
    } as unknown as JumiaClient;

    await expect(getAllBrands(client)).rejects.toThrow(
      /getAllBrands exceeded .+ pages/
    );
  });
});
