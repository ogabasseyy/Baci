import NetInfo from '@react-native-community/netinfo';
import { supabase } from '@/lib/supabase';
import { getCustomerOrders, getOrder } from './orders-queries';

jest.mock('@react-native-community/netinfo', () => ({ fetch: jest.fn() }));
jest.mock('@/services/analytics', () => ({ trackError: jest.fn() }));
jest.mock('@/lib/supabase', () => ({ supabase: { from: jest.fn() } }));
jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ error: jest.fn() }),
}));
function query(data: unknown, error: unknown = null) {
  const chain = {
    select: jest.fn(),
    eq: jest.fn(),
    single: jest.fn().mockResolvedValue({ data, error }),
    order: jest.fn().mockResolvedValue({ data, error }),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  jest.mocked(supabase.from).mockReturnValue(chain as never);
  return chain;
}
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(NetInfo.fetch).mockResolvedValue({
    isConnected: true,
    isInternetReachable: true,
  } as never);
});
it('scopes an individual order lookup to its customer and returns the safe projection', async () => {
  const order = { id: 'order' };
  const chain = query(order);
  expect(await getOrder('order', 'customer')).toEqual(order);
  expect(chain.eq.mock.calls).toEqual([
    ['id', 'order'],
    ['customer_id', 'customer'],
  ]);
  expect(chain.select).toHaveBeenCalledWith(expect.not.stringContaining('*'));
});
it('scopes order history to both customer and merchant', async () => {
  const chain = query([{ id: 'order' }]);
  expect(await getCustomerOrders('customer', 'merchant')).toEqual([
    { id: 'order' },
  ]);
  expect(chain.eq.mock.calls).toEqual([
    ['customer_id', 'customer'],
    ['merchant_id', 'merchant'],
  ]);
  expect(chain.order).toHaveBeenCalledWith('created_at', { ascending: false });
});
it('rejects offline reads before querying tenant data', async () => {
  jest.mocked(NetInfo.fetch).mockResolvedValue({
    isConnected: true,
    isInternetReachable: false,
  } as never);
  await expect(getCustomerOrders('customer', 'merchant')).rejects.toMatchObject(
    { code: 'NETWORK_ERROR' }
  );
  await expect(getOrder('order', 'customer')).rejects.toMatchObject({
    code: 'NETWORK_ERROR',
  });
  expect(supabase.from).not.toHaveBeenCalled();
});
it('preserves single-order miss and history error contracts', async () => {
  query(null, { message: 'unavailable' });
  expect(await getOrder('order', 'customer')).toBeNull();
  await expect(getCustomerOrders('customer', 'merchant')).rejects.toMatchObject(
    { code: 'FETCH_ERROR' }
  );
});
