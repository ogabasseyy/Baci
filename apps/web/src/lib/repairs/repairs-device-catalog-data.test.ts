import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRepairDevicesForMerchant } from './repairs-device-catalog-data';

const mocks = vi.hoisted(() => ({ getPublicSupabaseClient: vi.fn() }));

vi.mock('@/lib/cached-data', () => ({
  getPublicSupabaseClient: mocks.getPublicSupabaseClient,
}));

function makeBuilder(table: string) {
  const data =
    table === 'repair_devices'
      ? [
          {
            id: 'device-1',
            brand: 'Apple',
            model: 'iPhone 15',
            slug: 'iphone-15',
            device_type: 'Smartphone',
            product_id: null,
            image_url: null,
          },
        ]
      : [];
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.select = chain;
  builder.eq = chain;
  builder.order = chain;
  // biome-ignore lint/suspicious/noThenProperty: Supabase query builders are thenable.
  builder.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve({ data, error: null }).then(resolve);
  return builder;
}

describe('getRepairDevicesForMerchant', () => {
  afterEach(() => vi.resetAllMocks());

  it('returns active catalog devices grouped by brand', async () => {
    mocks.getPublicSupabaseClient.mockReturnValue({
      from: (table: string) => makeBuilder(table),
    });

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
});
