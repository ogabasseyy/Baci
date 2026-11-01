import { jest } from '@jest/globals';
import { resolveOfferStock } from '../hooks/cart-stock-offers';
import { CONFIG } from './config';
import { getStorefrontProductOffersByProductIds } from './fetch-storefront-product-offers';

const merchant = '33333333-3333-4333-8333-333333333333';
const product = '11111111-1111-4111-8111-111111111111';
const mockRpc =
  jest.fn<
    (name: string, args: unknown) => Promise<{ data: unknown[]; error: null }>
  >();
jest.mock('@/lib/config', () => ({
  CONFIG: { MERCHANT_ID: '33333333-3333-4333-8333-333333333333' },
}));
jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: (name: string, args: unknown) => mockRpc(name, args) },
}));
jest.mock('@/lib/api', () => ({
  withSupabaseRetry: (operation: () => Promise<unknown>) => operation(),
}));
jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ error: jest.fn(), warn: jest.fn() }),
}));
afterEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
});
it('scopes discovery and stock to the configured merchant', async () => {
  mockRpc.mockResolvedValue({ data: [], error: null });
  await getStorefrontProductOffersByProductIds([product]);
  await resolveOfferStock(product, product);
  expect(mockRpc).toHaveBeenCalledWith('get_storefront_offer_resolution', {
    p_merchant_id: merchant,
    p_product_ids: [product],
  });
  expect(mockRpc.mock.calls).toHaveLength(2);
});
it('never falls back to a cross-merchant read when unconfigured', async () => {
  jest.replaceProperty(CONFIG, 'MERCHANT_ID', '');
  await expect(
    getStorefrontProductOffersByProductIds([product])
  ).resolves.toBeNull();
  await expect(resolveOfferStock(product, product)).rejects.toThrow(
    'configuration'
  );
  expect(mockRpc).not.toHaveBeenCalled();
});
