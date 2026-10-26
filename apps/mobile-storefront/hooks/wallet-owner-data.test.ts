import { readWalletOwner } from './wallet-owner-data';

const mockFrom = jest.fn();
const mockTrack = jest.fn();
const mockEq = jest.fn();
let mockResult: { data: unknown; error: unknown };
jest.mock('@/lib/supabase', () => ({
  supabase: { from: (...args: unknown[]) => mockFrom(...args) },
}));
jest.mock('@/services/analytics', () => ({
  trackEvent: (...args: unknown[]) => mockTrack(...args),
}));
beforeEach(() => {
  jest.clearAllMocks();
  mockResult = {
    data: [{ id: 'customer-1', loyalty_points: '10' }],
    error: null,
  };
  const query = {
    select: jest.fn(),
    eq: mockEq,
    limit: jest.fn(async () => mockResult),
  };
  query.select.mockReturnValue(query);
  mockEq.mockReturnValue(query);
  mockFrom.mockReturnValue(query);
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

it('scopes an existing customer to the merchant and preserves numeric loyalty points', async () => {
  expect(await readWalletOwner('customer-1', 'merchant-1', 'user-1')).toEqual({
    customerId: 'customer-1',
    loyaltyPoints: 10,
  });
  expect(mockEq.mock.calls).toEqual([
    ['merchant_id', 'merchant-1'],
    ['id', 'customer-1'],
  ]);
});
it('resolves a user-only owner within the merchant', async () => {
  expect((await readWalletOwner(null, 'merchant-1', 'user-1')).customerId).toBe(
    'customer-1'
  );
  expect(mockEq).toHaveBeenCalledWith('user_id', 'user-1');
});
it('makes no database request without an identity', async () => {
  expect(await readWalletOwner(null, 'merchant-1', null)).toEqual({
    customerId: null,
    loyaltyPoints: 0,
  });
  expect(mockFrom).not.toHaveBeenCalled();
});
it.each([
  { rows: [] },
  { rows: [{ id: 'one' }, { id: 'two' }] },
])('fails closed without exactly one customer row', async ({ rows }) => {
  mockResult.data = rows;
  expect(
    (await readWalletOwner(null, 'merchant-1', 'user-1')).customerId
  ).toBeNull();
});
it('propagates database errors instead of reporting an empty fresh wallet', async () => {
  mockResult.error = new Error('Offline');
  await expect(
    readWalletOwner('customer-1', 'merchant-1', 'user-1')
  ).rejects.toThrow('Offline');
});
