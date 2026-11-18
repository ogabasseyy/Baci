import { useCartStore } from '@/stores/cart-store';
import { useNativeSharedCartStore } from '@/stores/native-shared-cart-store';
import { publishNativeCart } from './publish-native-cart';

jest.mock('expo-crypto', () => ({ randomUUID: () => 'generation-1' }));
jest.mock('@/lib/persist-checkout-generation', () => ({
  persistCheckoutGenerationDetached: jest.fn(),
}));

const snapshot = (cartId: string) =>
  ({ merchantId: 'm', cartId, version: 1, lines: [] }) as never;

it('shows the snapshot, points the cart at it and resets checkout review for a new cart', () => {
  useNativeSharedCartStore.setState({ checkoutReview: { id: 'old' } as never });
  publishNativeCart(snapshot('c1'), { items: [], metadataReady: true });
  expect(useCartStore.getState().sharedCartRef).toEqual({
    merchantId: 'm',
    cartId: 'c1',
  });
  expect(useNativeSharedCartStore.getState().checkoutReview).toBeNull();
  expect(useNativeSharedCartStore.getState().metadataReady).toBe(true);
});

it('keeps checkout review and generation when the same cart is republished', () => {
  publishNativeCart(snapshot('c1'), { items: [], metadataReady: true });
  const generation = useCartStore.getState().checkoutGeneration;
  useNativeSharedCartStore.setState({
    checkoutReview: { id: 'keep' } as never,
  });
  publishNativeCart(snapshot('c1'), { items: [], metadataReady: true });
  expect(useCartStore.getState().checkoutGeneration).toBe(generation);
  expect(useNativeSharedCartStore.getState().checkoutReview).toEqual({
    id: 'keep',
  });
});

it('drops a stale failure notice when a different cart replaces the old one', () => {
  publishNativeCart(snapshot('c1'), { items: [], metadataReady: true });
  useNativeSharedCartStore.setState({ writeNotice: 'old failure' });
  publishNativeCart(snapshot('c1'), { items: [], metadataReady: true });
  expect(useNativeSharedCartStore.getState().writeNotice).toBe('old failure');
  publishNativeCart(snapshot('c2'), { items: [], metadataReady: true });
  expect(useNativeSharedCartStore.getState().writeNotice).toBeNull();
});
