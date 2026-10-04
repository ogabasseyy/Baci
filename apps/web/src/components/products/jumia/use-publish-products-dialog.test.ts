import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { usePublishProductsDialog } from './use-publish-products-dialog';

const mockToast = vi.fn();
const mockFetchWithCsrf = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock('@/lib/api-client', () => ({
  fetchWithCsrf: (...args: unknown[]) => mockFetchWithCsrf(...args),
}));

function createFetchMock(
  handlers: Record<
    string,
    () => Promise<{
      ok: boolean;
      json: () => Promise<unknown>;
    }>
  >
) {
  return vi.fn((url: string) => {
    for (const [pattern, handler] of Object.entries(handlers)) {
      if (url.includes(pattern)) {
        return handler();
      }
    }
    throw new Error(`Unexpected fetch URL: ${url}`);
  });
}

describe('usePublishProductsDialog', () => {
  it('loads active products across pages when the dialog opens', async () => {
    const fetchMock = createFetchMock({
      'mapped-product-ids': async () => ({
        ok: true,
        json: async () => ({ mappings: [] }),
      }),
      'page=1': async () => ({
        ok: true,
        json: async () => ({
          products: [{ id: 'prod-1', name: 'Phone', price: 10 }],
          pagination: { page: 1, limit: 100, totalPages: 2 },
        }),
      }),
      'page=2': async () => ({
        ok: true,
        json: async () => ({
          products: [{ id: 'prod-2', name: 'Tablet', price: 20 }],
          pagination: { page: 2, limit: 100, totalPages: 2 },
        }),
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() =>
      usePublishProductsDialog({
        integrationId: 'integration-1',
        open: true,
        onOpenChange: vi.fn(),
      })
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/marketplace/jumia/products/mapped-product-ids?integrationId=integration-1',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/products?status=active&limit=100&page=1',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/products?status=active&limit=100&page=2',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(result.current.filteredProducts).toHaveLength(2);
  });

  it('sets load error when product pagination fetch is not ok', async () => {
    const fetchMock = createFetchMock({
      'mapped-product-ids': async () => ({
        ok: true,
        json: async () => ({ mappings: [] }),
      }),
      '/api/products': async () => ({
        ok: false,
        json: async () => ({}),
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() =>
      usePublishProductsDialog({
        integrationId: 'integration-1',
        open: true,
        onOpenChange: vi.fn(),
      })
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.loadError).toBe('Failed to load active products');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('sends the search term to the products API instead of filtering only the preload', async () => {
    const fetchMock = createFetchMock({
      'mapped-product-ids': async () => ({
        ok: true,
        json: async () => ({ mappings: [] }),
      }),
      '/api/products': async () => ({
        ok: true,
        json: async () => ({
          products: [{ id: 'prod-1', name: 'Legacy Phone', price: 10 }],
        }),
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() =>
      usePublishProductsDialog({
        integrationId: 'integration-1',
        open: true,
        onOpenChange: vi.fn(),
      })
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => result.current.setSearch('Legacy Phone'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/products?status=active&limit=100&page=1&search=Legacy+Phone',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });
    expect(result.current.filteredProducts).toEqual([
      { id: 'prod-1', name: 'Legacy Phone', price: 10 },
    ]);
  });

  it('keeps SKU-only search results visible after the server returns them', async () => {
    const fetchMock = createFetchMock({
      'mapped-product-ids': async () => ({
        ok: true,
        json: async () => ({ mappings: [] }),
      }),
      '/api/products': async () => ({
        ok: true,
        json: async () => ({
          products: [
            {
              id: 'prod-1',
              name: 'Wireless Controller',
              sku: 'GAME-42',
              price: 49.99,
            },
          ],
        }),
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() =>
      usePublishProductsDialog({
        integrationId: 'integration-1',
        open: true,
        onOpenChange: vi.fn(),
      })
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => result.current.setSearch('GAME-42'));

    await waitFor(() => {
      expect(result.current.filteredProducts).toEqual([
        {
          id: 'prod-1',
          name: 'Wireless Controller',
          sku: 'GAME-42',
          price: 49.99,
        },
      ]);
    });
  });

  it('retains selected products when search results replace the list', async () => {
    let productRequestCount = 0;
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('mapped-product-ids')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ mappings: [] }),
        });
      }
      productRequestCount += 1;
      const products =
        productRequestCount === 1
          ? [
              {
                id: 'prod-1',
                name: 'Phone',
                price: 10,
                sku: 'PHONE-1',
                image: 'https://example.com/phone.png',
              },
            ]
          : [
              {
                id: 'prod-2',
                name: 'Tablet',
                price: 20,
                sku: 'TABLET-1',
                image: 'https://example.com/tablet.png',
              },
            ];
      return Promise.resolve({
        ok: true,
        json: async () => ({ products }),
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() =>
      usePublishProductsDialog({
        integrationId: 'integration-1',
        open: true,
        onOpenChange: vi.fn(),
      })
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    act(() => result.current.toggleProduct('prod-1'));
    expect(result.current.selectedIds).toEqual(new Set(['prod-1']));

    act(() => result.current.setSearch('Tablet'));

    await waitFor(() => {
      expect(result.current.products).toEqual([
        {
          id: 'prod-1',
          name: 'Phone',
          price: 10,
          sku: 'PHONE-1',
          image: 'https://example.com/phone.png',
        },
        {
          id: 'prod-2',
          name: 'Tablet',
          price: 20,
          sku: 'TABLET-1',
          image: 'https://example.com/tablet.png',
        },
      ]);
    });
    expect(result.current.selectedIds).toEqual(new Set(['prod-1']));
  });

  it('retains products from a single page when pagination metadata is missing', async () => {
    const fetchMock = createFetchMock({
      'mapped-product-ids': async () => ({
        ok: true,
        json: async () => ({ mappings: [] }),
      }),
      '/api/products': async () => ({
        ok: true,
        json: async () => ({
          products: [{ id: 'prod-1', name: 'Phone', price: 10 }],
        }),
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() =>
      usePublishProductsDialog({
        integrationId: 'integration-1',
        open: true,
        onOpenChange: vi.fn(),
      })
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.filteredProducts).toEqual([
      { id: 'prod-1', name: 'Phone', price: 10 },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('blocks selecting heterogeneous products into one Jumia mapping batch', async () => {
    const fetchMock = createFetchMock({
      'mapped-product-ids': async () => ({
        ok: true,
        json: async () => ({ mappings: [] }),
      }),
      '/api/products': async () => ({
        ok: true,
        json: async () => ({
          products: [
            {
              id: 'prod-1',
              name: 'Phone',
              price: 10,
              sku: 'PHONE-1',
              image: 'https://example.com/phone.png',
              category: 'Phones',
              brand: 'Acme',
            },
            {
              id: 'prod-2',
              name: 'Tablet',
              price: 20,
              sku: 'TABLET-1',
              image: 'https://example.com/tablet.png',
              category: 'Tablets',
              brand: 'Acme',
            },
          ],
        }),
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() =>
      usePublishProductsDialog({
        integrationId: 'integration-1',
        open: true,
        onOpenChange: vi.fn(),
      })
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => result.current.toggleProduct('prod-1'));
    expect(result.current.selectedIds).toEqual(new Set(['prod-1']));
    const secondProduct = result.current.filteredProducts[1];
    expect(secondProduct).toBeDefined();
    if (!secondProduct) return;
    expect(result.current.getPublishBlockReason(secondProduct)).toBe(
      'Select products with the same category and brand as the first selected product.'
    );

    act(() => result.current.toggleProduct('prod-2'));
    expect(result.current.selectedIds).toEqual(new Set(['prod-1']));
  });

  it('ignores inventory-anchor variants when validating submit SKUs', async () => {
    const fetchMock = createFetchMock({
      'mapped-product-ids': async () => ({
        ok: true,
        json: async () => ({ mappings: [] }),
      }),
      '/api/products': async () => ({
        ok: true,
        json: async () => ({
          products: [
            {
              id: 'prod-1',
              name: 'Phone',
              price: 100,
              image: 'https://cdn.example.com/phone.jpg',
              category: 'Phones',
              brand: 'Acme',
              variants: [
                { sku: 'PHONE-RED', stock_quantity: 2 },
                { sku: null, is_inventory_anchor: true },
              ],
            },
          ],
        }),
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    mockFetchWithCsrf.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    });
    const onOpenChange = vi.fn();

    const { result } = renderHook(() =>
      usePublishProductsDialog({
        integrationId: 'integration-1',
        open: true,
        onOpenChange,
      })
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.setCategoryCode(42);
      result.current.setBrand({ code: 1, name: 'Generic' });
    });
    act(() => result.current.toggleProduct('prod-1'));
    act(() => result.current.submit());

    await waitFor(() => {
      expect(mockFetchWithCsrf).toHaveBeenCalledWith(
        '/api/marketplace/jumia/products/export',
        expect.objectContaining({ method: 'POST' })
      );
    });
    expect(mockToast).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: 'SKU required' })
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('blocks a partially mapped variant product from create retries', async () => {
    const fetchMock = createFetchMock({
      'mapped-product-ids': async () => ({
        ok: true,
        json: async () => ({
          mappings: [
            {
              productId: 'prod-1',
              sellerSku: 'PHONE-BLACK',
              syncStatus: 'synced',
            },
            {
              productId: 'prod-1',
              sellerSku: 'PHONE-WHITE',
              syncStatus: 'error',
            },
          ],
        }),
      }),
      '/api/products': async () => ({
        ok: true,
        json: async () => ({
          products: [
            {
              id: 'prod-1',
              name: 'Phone',
              price: 100,
              image: 'https://cdn.example.com/phone.jpg',
              category: 'Phones',
              brand: 'Acme',
              variants: [
                { sku: 'PHONE-BLACK', stock_quantity: 2 },
                { sku: 'PHONE-WHITE', stock_quantity: 3 },
              ],
            },
          ],
        }),
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() =>
      usePublishProductsDialog({
        integrationId: 'integration-1',
        open: true,
        onOpenChange: vi.fn(),
      })
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const [firstProduct] = result.current.products;
    if (!firstProduct) throw new Error('Expected a loaded product');
    // The accepted variant blocks another create (the server would 409),
    // so the rejected variant recovers through the listing update flow.
    expect(result.current.getPublishBlockReason(firstProduct)).toBe(
      'Already published to this Jumia integration.'
    );
    act(() => result.current.toggleProduct('prod-1'));
    expect(result.current.selectedIds).toEqual(new Set([]));
  });

  it('reports an accepted 207 export as reconciliation pending', async () => {
    mockToast.mockClear();
    mockFetchWithCsrf.mockReset();
    mockFetchWithCsrf.mockResolvedValue({
      ok: true,
      status: 207,
      json: async () => ({
        success: false,
        partial: true,
        feedId: 'feed-1',
      }),
    });
    vi.stubGlobal(
      'fetch',
      createFetchMock({
        'mapped-product-ids': async () => ({
          ok: true,
          json: async () => ({ mappings: [] }),
        }),
        '/api/products': async () => ({
          ok: true,
          json: async () => ({
            products: [
              {
                id: 'prod-1',
                name: 'Phone',
                sku: 'PHONE-1',
                price: 100,
                image: 'https://cdn.example.com/phone.jpg',
                category: 'Phones',
                brand: 'Acme',
              },
            ],
          }),
        }),
      })
    );
    const onOpenChange = vi.fn();

    const { result } = renderHook(() =>
      usePublishProductsDialog({
        integrationId: 'integration-1',
        open: true,
        onOpenChange,
      })
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    act(() => {
      result.current.setCategoryCode(42);
      result.current.setBrand({ code: 1, name: 'Generic' });
    });
    act(() => result.current.toggleProduct('prod-1'));
    act(() => result.current.submit());

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Products submitted to Jumia',
          description: expect.stringContaining('reconciliation is pending'),
        })
      );
    });
    expect(mockToast).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Submission failed' })
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
