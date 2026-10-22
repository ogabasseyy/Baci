import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getRepairDeviceDetailBySlug,
  getRepairDevicesForMerchant,
} from './repairs-catalog-data';

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
  builder.maybeSingle = () => Promise.resolve(result);
  // biome-ignore lint/suspicious/noThenProperty: intentional thenable mocking a Supabase query builder awaited without a terminal method
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

describe('getRepairDeviceDetailBySlug', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when the device is missing', async () => {
    mocks.getPublicSupabaseClient.mockReturnValue(
      makeClient({ repair_devices: { data: null, error: null } })
    );

    const detail = await getRepairDeviceDetailBySlug('merchant-1', 'nope');

    expect(detail).toBeNull();
  });

  it('maps quotes to service type names and drops orphaned quotes', async () => {
    mocks.getPublicSupabaseClient.mockReturnValue(
      makeClient({
        repair_devices: {
          data: {
            id: 'd1',
            brand: 'Apple',
            model: 'iPhone 13',
            slug: 'iphone-13',
            product_id: null,
          },
          error: null,
        },
        repair_quotes: {
          data: [
            {
              id: 'q1',
              service_type_id: 'st1',
              price: 25000,
              is_from_price: true,
            },
            {
              id: 'q2',
              service_type_id: 'inactive',
              price: 5000,
              is_from_price: true,
            },
          ],
          error: null,
        },
        repair_service_types: {
          data: [{ id: 'st1', name: 'Screen Replacement' }],
          error: null,
        },
      })
    );

    const detail = await getRepairDeviceDetailBySlug('merchant-1', 'iphone-13');

    expect(detail).not.toBeNull();
    expect(detail?.quotes).toEqual([
      expect.objectContaining({
        id: 'q1',
        serviceTypeName: 'Screen Replacement',
        price: 25000,
      }),
    ]);
    expect(detail?.product).toBeNull();
  });

  it('includes the linked product summary with key specs', async () => {
    mocks.getPublicSupabaseClient.mockReturnValue(
      makeClient({
        repair_devices: {
          data: {
            id: 'd1',
            brand: 'Apple',
            model: 'iPhone 13',
            slug: 'iphone-13',
            product_id: 'p1',
          },
          error: null,
        },
        repair_quotes: { data: [], error: null },
        repair_service_types: { data: [], error: null },
        products: {
          data: {
            id: 'p1',
            slug: 'apple-iphone-13',
            name: 'Apple iPhone 13',
            images: ['https://cdn.example/iphone.jpg'],
          },
          error: null,
        },
        product_key_specs: {
          data: { chipset: 'A15 Bionic', ram_gb: 4, storage_gb: 128 },
          error: null,
        },
      })
    );

    const detail = await getRepairDeviceDetailBySlug('merchant-1', 'iphone-13');

    expect(detail?.product).toEqual({
      id: 'p1',
      slug: 'apple-iphone-13',
      name: 'Apple iPhone 13',
      imageUrl: 'https://cdn.example/iphone.jpg',
      keySpecs: [
        { label: 'Chipset', value: 'A15 Bionic' },
        { label: 'RAM', value: '4GB' },
        { label: 'Storage', value: '128GB' },
      ],
    });
  });
});

describe('getRepairDeviceDetailBySlug error paths', () => {
  const deviceRow = {
    id: 'd1',
    brand: 'Apple',
    model: 'iPhone 13',
    slug: 'iphone-13',
    product_id: null as string | null,
  };
  const boom = { message: 'boom' };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects when the repair_devices query errors', async () => {
    mocks.getPublicSupabaseClient.mockReturnValue(
      makeClient({ repair_devices: { data: null, error: boom } })
    );
    await expect(
      getRepairDeviceDetailBySlug('merchant-1', 'iphone-13')
    ).rejects.toEqual(boom);
  });

  it('rejects when the repair_quotes query errors', async () => {
    mocks.getPublicSupabaseClient.mockReturnValue(
      makeClient({
        repair_devices: { data: deviceRow, error: null },
        repair_quotes: { data: null, error: boom },
        repair_service_types: { data: [], error: null },
      })
    );
    await expect(
      getRepairDeviceDetailBySlug('merchant-1', 'iphone-13')
    ).rejects.toEqual(boom);
  });

  it('rejects when the repair_service_types query errors', async () => {
    mocks.getPublicSupabaseClient.mockReturnValue(
      makeClient({
        repair_devices: { data: deviceRow, error: null },
        repair_quotes: { data: [], error: null },
        repair_service_types: { data: null, error: boom },
      })
    );
    await expect(
      getRepairDeviceDetailBySlug('merchant-1', 'iphone-13')
    ).rejects.toEqual(boom);
  });

  it('rejects when the linked products query errors', async () => {
    mocks.getPublicSupabaseClient.mockReturnValue(
      makeClient({
        repair_devices: {
          data: { ...deviceRow, product_id: 'p1' },
          error: null,
        },
        repair_quotes: { data: [], error: null },
        repair_service_types: { data: [], error: null },
        products: { data: null, error: boom },
      })
    );
    await expect(
      getRepairDeviceDetailBySlug('merchant-1', 'iphone-13')
    ).rejects.toEqual(boom);
  });

  it('rejects when the product_key_specs query errors', async () => {
    mocks.getPublicSupabaseClient.mockReturnValue(
      makeClient({
        repair_devices: {
          data: { ...deviceRow, product_id: 'p1' },
          error: null,
        },
        repair_quotes: { data: [], error: null },
        repair_service_types: { data: [], error: null },
        products: {
          data: { id: 'p1', slug: 's', name: 'n', images: [] },
          error: null,
        },
        product_key_specs: { data: null, error: boom },
      })
    );
    await expect(
      getRepairDeviceDetailBySlug('merchant-1', 'iphone-13')
    ).rejects.toEqual(boom);
  });
});
