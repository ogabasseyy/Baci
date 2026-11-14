import { renderHook } from '@testing-library/react-native';
import { useHomeOrderShortcuts } from './use-home-order-shortcuts';

let mockUserId: string | undefined;
const mockLimit = jest.fn();
const mockIn = jest.fn();
const mockEq = jest.fn();
const mockSelect = jest.fn();
const mockFrom = jest.fn();
let mockQuery: { enabled: boolean; queryFn: () => Promise<unknown> };
let mockError = false;

jest.mock('@tanstack/react-query', () => ({
  useQuery: (options: typeof mockQuery) => {
    mockQuery = options;
    return { data: { receipts: true, tracking: true }, isError: mockError };
  },
}));
jest.mock('@/hooks/product-utils', () => ({ CONSTANT_MERCHANT_ID: 'default' }));
jest.mock('@/lib/supabase', () => ({
  supabase: { from: (...args: unknown[]) => mockFrom(...args) },
}));
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (select: (state: unknown) => unknown) =>
    select({
      user: mockUserId ? { id: mockUserId } : undefined,
      merchantId: 'store',
    }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockUserId = 'buyer';
  mockError = false;
  const query = {
    select: mockSelect,
    eq: mockEq,
    in: mockIn,
    limit: mockLimit,
  };
  mockFrom.mockReturnValue(query);
  mockSelect.mockReturnValue(query);
  mockEq.mockReturnValue(query);
  mockIn.mockReturnValue(query);
});

it('disables the query and hides order shortcuts for guests', () => {
  mockUserId = undefined;
  const { result } = renderHook(() => useHomeOrderShortcuts(true));
  expect(mockQuery.enabled).toBe(false);
  expect(result.current).toBeUndefined();
});

it('scopes both queries to the signed-in shopper and store and only tracks awaiting shipments', async () => {
  mockLimit
    .mockResolvedValueOnce({ data: [{ id: 'past' }] })
    .mockResolvedValueOnce({ data: [] });
  renderHook(() => useHomeOrderShortcuts(true));
  expect(mockQuery.enabled).toBe(true);
  await expect(mockQuery.queryFn()).resolves.toEqual({
    receipts: true,
    tracking: false,
  });
  expect(mockEq.mock.calls).toEqual([
    ['customers.user_id', 'buyer'],
    ['merchant_id', 'store'],
    ['customers.user_id', 'buyer'],
    ['merchant_id', 'store'],
  ]);
  expect(mockIn).toHaveBeenCalledWith('shipping_status', [
    'pending',
    'processing',
  ]);
});

it('propagates database errors and hides stale shortcuts in the error state', async () => {
  const failure = new Error('unavailable');
  mockLimit
    .mockResolvedValueOnce({ data: [] })
    .mockResolvedValueOnce({ error: failure });
  mockError = true;
  const { result } = renderHook(() => useHomeOrderShortcuts(true));
  await expect(mockQuery.queryFn()).rejects.toBe(failure);
  expect(result.current).toBeUndefined();
});
