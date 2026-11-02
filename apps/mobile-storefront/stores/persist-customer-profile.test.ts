import { persistCustomerProfile } from './persist-customer-profile';

const mockRpc = jest.fn();
const mockFrom = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

const original = { ...process.env };
beforeEach(() => {
  jest.clearAllMocks();
  process.env.EXPO_PUBLIC_HOSTED_STOREFRONT = '1';
  process.env.EXPO_PUBLIC_API_URL = 'https://staging.ogabassey.com';
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://staging-auth.ogabassey.com';
});
afterAll(() => {
  process.env = original;
});

it('uses only the own-phone RPC for pinned sandbox phone saves', async () => {
  mockRpc.mockResolvedValue({ data: { phone: '08000007891' }, error: null });
  await persistCustomerProfile({
    customerId: 'customer',
    merchantId: 'merchant',
    userId: 'user',
    updates: { phone: '08000007891' },
  });
  expect(mockRpc).toHaveBeenCalledWith('set_customer_wallet_phone', {
    p_merchant_id: 'merchant',
    p_expected_user_id: 'user',
    p_phone: '08000007891',
  });
  expect(mockFrom).not.toHaveBeenCalled();
});

it('keeps ordinary production profile updates on the existing RLS path', async () => {
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://production.invalid';
  const query = {
    update: jest.fn(),
    eq: jest.fn(),
    select: jest.fn(),
    single: jest.fn(),
  };
  query.update.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.select.mockReturnValue(query);
  query.single.mockResolvedValue({ data: {}, error: null });
  mockFrom.mockReturnValue(query);
  await persistCustomerProfile({
    customerId: 'customer',
    merchantId: 'merchant',
    userId: 'user',
    updates: { phone: '08000007891' },
  });
  expect(mockRpc).not.toHaveBeenCalled();
  expect(query.eq).toHaveBeenCalledWith('id', 'customer');
  expect(query.eq).toHaveBeenCalledWith('merchant_id', 'merchant');
});

it('saves only own names through the restricted sandbox wallet profile RPC', async () => {
  mockRpc.mockResolvedValue({ data: {}, error: null });
  await persistCustomerProfile({
    customerId: 'customer',
    merchantId: 'merchant',
    userId: 'user',
    updates: { first_name: 'Ada', last_name: 'Okafor' },
  });
  expect(mockRpc).toHaveBeenCalledWith('set_customer_wallet_profile', {
    p_merchant_id: 'merchant',
    p_expected_user_id: 'user',
    p_first_name: 'Ada',
    p_last_name: 'Okafor',
  });
  expect(mockFrom).not.toHaveBeenCalled();
});
