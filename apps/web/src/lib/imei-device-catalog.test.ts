import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImeiCheckResult } from '@/app/api/storefront/imei-check/sickw-parser.types';
import { enrichImeiDeviceResult } from './imei-device-catalog';

const mocks = vi.hoisted(() => ({ client: vi.fn() }));
vi.mock('@/lib/public-supabase-client', () => ({
  getPublicSupabaseClient: mocks.client,
}));
const result = {
  device: 'iPhone 17 Pro Max 512GB Silver',
  deviceImage: '',
} as ImeiCheckResult;
function builder(data: unknown, error: unknown = null) {
  const query = {
    abortSignal: vi.fn(),
    select: vi.fn(),
    eq: vi.fn(),
    ilike: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
  };
  for (const name of ['abortSignal', 'select', 'eq', 'ilike', 'order'] as const)
    query[name].mockReturnValue(query);
  query.limit.mockImplementation((_limit: number, options?: unknown) =>
    options ? query : Promise.resolve({ data, error })
  );
  return query;
}
beforeEach(() => vi.clearAllMocks());
describe('merchant catalog result enrichment', () => {
  it('scopes public catalog reads to the merchant and uses colour variant images', async () => {
    const query = builder([
      {
        id: 'p1',
        name: 'iPhone 17 Pro Max',
        brand: 'Apple',
        images: ['https://cdn.example.com/orange.jpg'],
      },
    ]);
    const rpcQuery = builder([
      {
        product_id: 'p1',
        attributes: { color: 'Silver' },
        images: ['https://cdn.example.com/silver.jpg'],
        primary_image: null,
      },
    ]);
    const rpc = vi.fn().mockReturnValue(rpcQuery);
    mocks.client.mockReturnValue({ from: () => query, rpc });
    const enriched = await enrichImeiDeviceResult('merchant-1', result);
    expect(rpc).toHaveBeenCalledWith('get_storefront_product_variants', {
      p_product_ids: ['p1'],
    });
    expect(query.eq).toHaveBeenCalledWith('merchant_id', 'merchant-1');
    expect(query.eq).toHaveBeenCalledWith('status', 'active');
    expect(enriched).toMatchObject({
      deviceImage: 'https://cdn.example.com/silver.jpg',
      deviceProfile: {
        color: 'Silver',
        storage: '512GB',
        catalogProductId: 'p1',
        imageMatch: 'color',
      },
    });
  });
  it('retains identity with an icon fallback when the catalog is unavailable', async () => {
    mocks.client.mockReturnValue({
      from: () => builder(null, { message: 'unavailable' }),
    });
    const enriched = await enrichImeiDeviceResult('merchant-1', result);
    expect(enriched.deviceImage).toBe('');
    expect(enriched.deviceProfile?.model).toBe('iPhone 17 Pro Max');
  });
});

afterEach(() => vi.useRealTimers());
it('shares one deadline across sequential enrichment queries and returns fallback before persistence can be delayed', async () => {
  vi.useFakeTimers();
  const product = builder([
    { id: 'p1', name: 'iPhone 17 Pro Max', brand: 'Apple', images: [] },
  ]);
  const variant = builder([]);
  product.limit.mockImplementation(
    () =>
      new Promise((resolve) =>
        setTimeout(
          () =>
            resolve({
              data: [
                {
                  id: 'p1',
                  name: 'iPhone 17 Pro Max',
                  brand: 'Apple',
                  images: [],
                },
              ],
              error: null,
            }),
          900
        )
      )
  );
  variant.limit.mockImplementation(
    () =>
      new Promise((resolve) =>
        setTimeout(() => resolve({ data: [], error: null }), 900)
      )
  );
  mocks.client.mockReturnValue({ from: () => product, rpc: () => variant });
  let settled = false;
  const pending = enrichImeiDeviceResult('merchant-1', result).then((value) => {
    settled = true;
    return value;
  });
  await vi.advanceTimersByTimeAsync(1500);
  try {
    expect(settled).toBe(true);
    expect(product.abortSignal).toHaveBeenCalledOnce();
    const signal = product.abortSignal.mock.calls[0][0] as AbortSignal;
    expect(variant.abortSignal).toHaveBeenCalledWith(signal);
    expect(signal.aborted).toBe(true);
    expect(await pending).toMatchObject({
      deviceImage: '',
      deviceProfile: { imageMatch: 'none' },
    });
  } finally {
    await vi.advanceTimersByTimeAsync(1000);
  }
});

it.each([
  {
    lastModel: 'iPhone 17 Pro',
    expectedImage: 'https://cdn.example.com/target-silver.jpg',
    expectedMatch: 'color',
  },
  { lastModel: 'iPhone 17 Pro Max', expectedImage: '', expectedMatch: 'none' },
])('matches a bounded 21-row catalog response by exact model and colour: $lastModel', async ({
  lastModel,
  expectedImage,
  expectedMatch,
}) => {
  const products = [
    ...Array.from({ length: 20 }, (_, index) => ({
      id: `other-${index}`,
      name: index % 2 === 0 ? 'iPhone 17 Pro Max' : 'iPhone 17 Pro Case',
      brand: 'Apple',
      images: ['https://cdn.example.com/wrong.jpg'],
    })),
    {
      id: 'target',
      name: lastModel,
      brand: 'Apple',
      images: ['https://cdn.example.com/target-orange.jpg'],
    },
  ];
  const query = builder(products);
  const variantQuery = builder(
    products.map((product) => ({
      product_id: product.id,
      attributes: { color: 'Silver', storage: '512GB' },
      images: [
        product.id === 'target'
          ? 'https://cdn.example.com/target-silver.jpg'
          : 'https://cdn.example.com/wrong-silver.jpg',
      ],
      primary_image: null,
    }))
  );
  const rpc = vi.fn().mockReturnValue(variantQuery);
  mocks.client.mockReturnValue({ from: () => query, rpc });
  const enriched = await enrichImeiDeviceResult('merchant-1', {
    ...result,
    device: 'iPhone 17 Pro 512GB Silver',
  });
  expect(enriched).toMatchObject({
    deviceImage: expectedImage,
    deviceProfile: {
      model: 'iPhone 17 Pro',
      color: 'Silver',
      imageMatch: expectedMatch,
    },
  });
  expect(query.limit).toHaveBeenCalledWith(21);
  expect(variantQuery.limit).toHaveBeenCalledWith(201);
  expect(rpc).toHaveBeenCalledWith('get_storefront_product_variants', {
    p_product_ids: products.map((product) => product.id),
  });
});
