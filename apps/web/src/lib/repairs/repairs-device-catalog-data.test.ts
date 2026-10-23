import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getRepairDevicesForMerchant } from './repairs-device-catalog-data';

type QueryResult = { data: unknown; error: unknown };

const mocks = vi.hoisted(() => ({
  getPublicSupabaseClient: vi.fn(),
}));

vi.mock('@/lib/cached-data', () => ({
  getPublicSupabaseClient: mocks.getPublicSupabaseClient,
}));

function makeBuilder(
  result: QueryResult,
  onIn?: (column: string, values: string[]) => void
) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.select = chain;
  builder.eq = chain;
  builder.order = chain;
  builder.in = (column: string, values: string[]) => {
    onIn?.(column, values);
    return builder;
  };
  // biome-ignore lint/suspicious/noThenProperty: Supabase query builders are thenable.
  builder.then = (
    resolve: (value: QueryResult) => unknown,
    reject?: (reason: unknown) => unknown
  ) => Promise.resolve(result).then(resolve, reject);
  return builder;
}

function makeClient(
  results: Record<string, QueryResult>,
  onProductLookup?: (column: string, values: string[]) => void
) {
  return {
    from: (table: string) =>
      makeBuilder(
        results[table] ?? { data: null, error: null },
        table === 'products' ? onProductLookup : undefined
      ),
  };
}

describe('getRepairDevicesForMerchant', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps the active catalog device type and groups the device by brand', async () => {
    mocks.getPublicSupabaseClient.mockReturnValue(
      makeClient({
        repair_devices: {
          data: [
            {
              id: 'device-1',
              brand: 'Apple',
              model: 'iPhone 15',
              slug: 'iphone-15',
              device_type: 'Smartphone',
              product_id: null,
              image_url: null,
            },
          ],
          error: null,
        },
      })
    );

    await expect(getRepairDevicesForMerchant('merchant-1')).resolves.toEqual([
      {
        brand: 'Apple',
        devices: [
          expect.objectContaining({
            id: 'device-1',
            model: 'iPhone 15',
            deviceType: 'Smartphone',
          }),
        ],
      },
    ]);
  });

  it('groups active devices by brand', async () => {
    mocks.getPublicSupabaseClient.mockReturnValue(
      makeClient({
        repair_devices: {
          data: [
            { id: 'd1', brand: 'Apple', model: 'iPhone 13', slug: 'iphone-13' },
            { id: 'd2', brand: 'Apple', model: 'iPhone 14', slug: 'iphone-14' },
            { id: 'd3', brand: 'Samsung', model: 'S23', slug: 's23' },
          ],
          error: null,
        },
      })
    );

    const groups = await getRepairDevicesForMerchant('merchant-1');

    expect(groups).toEqual([
      {
        brand: 'Apple',
        devices: [
          expect.objectContaining({ id: 'd1', model: 'iPhone 13' }),
          expect.objectContaining({ id: 'd2', model: 'iPhone 14' }),
        ],
      },
      {
        brand: 'Samsung',
        devices: [expect.objectContaining({ id: 'd3', model: 'S23' })],
      },
    ]);
  });

  it('uses the linked storefront product image when a device image is missing', async () => {
    mocks.getPublicSupabaseClient.mockReturnValue(
      makeClient({
        repair_devices: {
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
        },
        products: {
          data: [
            {
              id: 'p1',
              images: [{ url: 'https://cdn.example.com/iphone-15.jpg' }],
            },
          ],
          error: null,
        },
      })
    );

    const groups = await getRepairDevicesForMerchant('merchant-1', 'iphone');

    expect(groups[0]?.devices[0]?.imageUrl).toBe(
      'https://cdn.example.com/iphone-15.jpg'
    );
  });

  it('skips invalid leading product images and uses the next valid image', async () => {
    mocks.getPublicSupabaseClient.mockReturnValue(
      makeClient({
        repair_devices: {
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
        },
        products: {
          data: [
            {
              id: 'p1',
              images: [
                { url: ' ' },
                'javascript:alert(1)',
                { url: 'https://cdn.example.com/iphone-15-valid.jpg' },
              ],
            },
          ],
          error: null,
        },
      })
    );

    const groups = await getRepairDevicesForMerchant('merchant-1', 'iphone');

    expect(groups[0]?.devices[0]?.imageUrl).toBe(
      'https://cdn.example.com/iphone-15-valid.jpg'
    );
  });

  it('filters matching devices before looking up linked product images', async () => {
    const productLookups: string[][] = [];
    mocks.getPublicSupabaseClient.mockReturnValue(
      makeClient(
        {
          repair_devices: {
            data: [
              {
                id: 'd1',
                brand: 'Apple',
                model: 'iPhone 15',
                slug: 'iphone-15',
                product_id: 'p1',
                image_url: null,
              },
              {
                id: 'd2',
                brand: 'Samsung',
                model: 'Galaxy S23',
                slug: 'galaxy-s23',
                product_id: 'p2',
                image_url: null,
              },
            ],
            error: null,
          },
          products: { data: [], error: null },
        },
        (_column, values) => productLookups.push(values)
      )
    );

    const groups = await getRepairDevicesForMerchant('merchant-1', 'iphone');

    expect(
      groups.flatMap((group) => group.devices.map((device) => device.id))
    ).toEqual(['d1']);
    expect(productLookups).toEqual([['p1']]);
  });

  it('returns devices without fallback images when product lookup fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mocks.getPublicSupabaseClient.mockReturnValue(
      makeClient({
        repair_devices: {
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
        },
        products: { data: null, error: { message: 'lookup failed' } },
      })
    );

    const groups = await getRepairDevicesForMerchant('merchant-1');

    expect(groups[0]?.devices[0]).toMatchObject({
      id: 'd1',
      imageUrl: null,
    });
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('chunks unfiltered linked product image lookups', async () => {
    const productLookups: string[][] = [];
    const devices = Array.from({ length: 101 }, (_, index) => ({
      id: `d${index}`,
      brand: 'Apple',
      model: `iPhone ${index}`,
      slug: `iphone-${index}`,
      product_id: `p${index}`,
      image_url: null,
    }));
    mocks.getPublicSupabaseClient.mockReturnValue(
      makeClient(
        {
          repair_devices: { data: devices, error: null },
          products: { data: [], error: null },
        },
        (_column, values) => productLookups.push(values)
      )
    );

    await getRepairDevicesForMerchant('merchant-1');

    expect(productLookups.map((lookup) => lookup.length)).toEqual([100, 1]);
  });

  it('filters by query across brand, model, and aliases', async () => {
    mocks.getPublicSupabaseClient.mockReturnValue(
      makeClient({
        repair_devices: {
          data: [
            { id: 'd1', brand: 'Apple', model: 'iPhone 13', slug: 'iphone-13' },
            {
              id: 'd2',
              brand: 'Samsung',
              model: 'Galaxy S23',
              slug: 's23',
              aliases: ['iphone killer'],
            },
            { id: 'd3', brand: 'Tecno', model: 'Camon', slug: 'camon' },
          ],
          error: null,
        },
      })
    );

    const groups = await getRepairDevicesForMerchant('merchant-1', 'iphone');

    const ids = groups.flatMap((group) =>
      group.devices.map((device) => device.id)
    );
    expect(ids).toEqual(['d1', 'd2']);
  });

  it('throws when the query errors so the caller can surface a 500', async () => {
    mocks.getPublicSupabaseClient.mockReturnValue(
      makeClient({
        repair_devices: { data: null, error: { message: 'boom' } },
      })
    );

    await expect(getRepairDevicesForMerchant('merchant-1')).rejects.toEqual({
      message: 'boom',
    });
  });
});
