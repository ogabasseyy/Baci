import { useNativeSharedCartStore } from '@/stores/native-shared-cart-store';
import { bindSharedCartRealtime } from './bind-shared-cart-realtime';

const mockSync = jest.fn();
const mockStop = jest.fn();
jest.mock('./shared-cart-realtime', () => ({
  startSharedCartRealtime: () => ({ sync: mockSync, stop: mockStop }),
}));
jest.mock('./shared-cart-realtime-transport', () => ({
  createNativeRealtimeDeps: jest.fn(),
}));

it('re-syncs when the cart changes and stops watching on teardown', () => {
  const stop = bindSharedCartRealtime({
    merchantId: 'm',
    merchantSlug: 's',
    apiOrigin: 'https://x.test',
    subjectKey: 'guest',
    isCurrent: () => true,
    refresh: () => Promise.resolve(),
  });
  useNativeSharedCartStore.setState({ snapshot: { cartId: 'c1' } as never });
  expect(mockSync).toHaveBeenCalledTimes(1);
  useNativeSharedCartStore.setState({ status: 'ready' });
  expect(mockSync).toHaveBeenCalledTimes(1);
  stop();
  expect(mockStop).toHaveBeenCalledTimes(1);
  useNativeSharedCartStore.setState({ snapshot: { cartId: 'c2' } as never });
  expect(mockSync).toHaveBeenCalledTimes(1);
});
