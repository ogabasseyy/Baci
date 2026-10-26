import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRepairDevicesForMerchant } from './repairs-device-catalog-data';

const mocks = vi.hoisted(() => ({ getPublicSupabaseClient: vi.fn() }));

vi.mock('@/lib/cached-data', () => ({
  getPublicSupabaseClient: mocks.getPublicSupabaseClient,
}));

type QueryResult = { data: unknown; error: unknown };

function makeBuilder(result: QueryResult) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.select = chain;
  builder.eq = chain;
  builder.order = chain;
  builder.in = chain;
  // biome-ignore lint/suspicious/noThenProperty: Supabase query builders are thenable.
  builder.then = (
    resolve: (value: QueryResult) => unknown,
    reject?: (reason: unknown) => unknown
  ) => Promise.resolve(result).then(resolve, reject);
  return builder;
}

function mockCatalog(productImages: unknown[]) {
  mocks.getPublicSupabaseClient.mockReturnValue({
    rpc: () =>
      Promise.resolve({
        data: [
          {
            id: 'd1',
            brand: 'Apple',
            model: 'iPhone 15',
            slug: 'iphone-15',
            product_id: 'p1',
            image_url: null,
          },
        ],
        error: null,
      }),
    from: (table: string) =>
      makeBuilder(
        table === 'repair_devices'
          ? {
              data: [
                {
                  id: 'd1',
                  brand: 'Apple',
                  model: 'iPhone 15',
                  slug: 'iphone-15',
                  product_id: 'p1',
                  image_url: null,
                },
              ],
              error: null,
            }
          : {
              data: [{ id: 'p1', images: productImages }],
              error: null,
            }
      ),
  });
}

describe('repair device catalog product images', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('uses the linked storefront product image when a device image is missing', async () => {
    mockCatalog([{ url: 'https://cdn.example.com/iphone-15.jpg' }]);

    const groups = await getRepairDevicesForMerchant('merchant-1', 'iphone');

    expect(groups[0]?.devices[0]?.imageUrl).toBe(
      'https://cdn.example.com/iphone-15.jpg'
    );
  });

  it('skips invalid leading product images and uses the next valid image', async () => {
    mockCatalog([
      { url: ' ' },
      'javascript:alert(1)',
      { url: 'https://cdn.example.com/iphone-15-valid.jpg' },
    ]);

    const groups = await getRepairDevicesForMerchant('merchant-1', 'iphone');

    expect(groups[0]?.devices[0]?.imageUrl).toBe(
      'https://cdn.example.com/iphone-15-valid.jpg'
    );
  });
});
