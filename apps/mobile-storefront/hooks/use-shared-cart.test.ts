import { act, renderHook, waitFor } from '@testing-library/react-native';
import { hasSharedCartWriter } from '@/stores/shared-cart-writer';
import { useSharedCart } from './use-shared-cart';

jest.mock('@/stores/cart-store', () => ({
  useCartStore: { getState: () => ({ items: [] }), setState: jest.fn() },
}));
jest.mock('@/hooks/product-utils', () => ({
  fetchProductRow: jest.fn(),
  transformProduct: jest.fn(),
}));
jest.mock('@/lib/persist-checkout-generation', () => ({
  persistCheckoutGenerationDetached: jest.fn(),
}));
jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'operation' }));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
const options = {
  enabled: true,
  merchantId: '11111111-1111-4111-8111-111111111111',
  merchantSlug: 'shop',
  apiOrigin: 'https://usebaci.com',
  subjectKey: 'guest',
};
it('installs one owner only in enabled mode and fences late callbacks on cleanup', async () => {
  const client = {
    context: jest.fn().mockResolvedValue(null),
    bootstrap: jest.fn(),
    read: jest.fn(),
    create: jest.fn(),
    command: jest.fn(),
    recoverCreation: jest.fn(),
  };
  const deps = {
    client: jest.fn(() => client),
    loadProduct: jest.fn().mockResolvedValue(null),
    receipts: {
      read: jest.fn().mockResolvedValue(null),
      save: jest.fn(),
      clear: jest.fn(),
    },
  };
  const { rerender, unmount } = renderHook(
    (p: typeof options) => useSharedCart(p, deps),
    { initialProps: { ...options, enabled: false } }
  );
  expect(hasSharedCartWriter()).toBe(false);
  await act(async () => rerender(options));
  await waitFor(() => expect(client.context).toHaveBeenCalled());
  expect(hasSharedCartWriter()).toBe(true);
  unmount();
  expect(hasSharedCartWriter()).toBe(false);
});
