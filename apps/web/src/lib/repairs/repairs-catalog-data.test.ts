import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getRepairDeviceDetailBySlug } from './repairs-catalog-data';

type QueryResult = { data: unknown; error: unknown };

const mocks = vi.hoisted(() => ({
  getPublicSupabaseClient: vi.fn(),
}));

vi.mock('@/lib/cached-data', () => ({
  getPublicSupabaseClient: mocks.getPublicSupabaseClient,
}));

function makeBuilder(result: QueryResult) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.select = chain;
  builder.eq = chain;
  builder.order = chain;
  builder.maybeSingle = () => Promise.resolve(result);
  // biome-ignore lint/suspicious/noThenProperty: intentional thenable mocking a Supabase query builder awaited without a terminal method
  builder.then = (
    resolve: (value: QueryResult) => unknown,
    reject?: (reason: unknown) => unknown
  ) => Promise.resolve(result).then(resolve, reject);
  return builder;
}

function makeClient(results: Record<string, QueryResult>) {
  return {
    from: (table: string) =>
      makeBuilder(results[table] ?? { data: null, error: null }),
  };
}

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
