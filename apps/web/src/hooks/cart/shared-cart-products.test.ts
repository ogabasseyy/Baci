import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createClient } from '@/lib/supabase/client';

import { fetchSharedCartProducts } from './shared-cart-client';

vi.mock('@/lib/api-client', () => ({
  fetchWithCsrf: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(),
}));

describe('shared-cart-client product hydration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mockProductsQuery(rows: unknown[] | null, error: unknown = null) {
    const query = {
      eq: vi.fn(),
      in: vi.fn(),
      select: vi.fn(),
    };
    query.select.mockReturnValue(query);
    query.in.mockReturnValue(query);
    query.eq.mockImplementation((column: string) =>
      column === 'status' ? { data: rows, error } : query
    );
    vi.mocked(createClient).mockReturnValue({
      from: vi.fn(() => query),
    } as never);
    return query;
  }

  it('fetches active merchant products and resolves their images', async () => {
    const query = mockProductsQuery([
      {
        brand: 'Brand',
        gtin: '',
        id: 'prod-1',
        image_hint: 'phone',
        images: ['https://img.test/phone.png'],
        manage_stock: false,
        merchant_id: 'merchant-1',
        mpn: '',
        name: 'Phone',
        price: 100,
        status: 'active',
        stock: 10,
      },
    ]);

    const products = await fetchSharedCartProducts(['prod-1'], 'merchant-1');

    expect(query.in).toHaveBeenCalledWith('id', ['prod-1']);
    expect(products.get('prod-1')).toMatchObject({
      id: 'prod-1',
      image: 'https://img.test/phone.png',
      imageLarge: 'https://img.test/phone.png',
      name: 'Phone',
    });
  });

  it('skips the query for empty ids and degrades to empty on error', async () => {
    await expect(fetchSharedCartProducts([], 'merchant-1')).resolves.toEqual(
      new Map()
    );
    expect(createClient).not.toHaveBeenCalled();

    mockProductsQuery(null, new Error('catalog down'));
    await expect(
      fetchSharedCartProducts(['prod-1'], 'merchant-1')
    ).resolves.toEqual(new Map());
  });
});
