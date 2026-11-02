import { renderHook } from '@testing-library/react-native';
import { useStartSavingsIdentity } from './use-start-savings-identity';

let mockMerchantId: string | null = '10000000-0000-4000-8000-000000000001';
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (select: (value: unknown) => unknown) =>
    select({ merchantId: mockMerchantId, user: { id: 'user-1' } }),
}));
jest.mock('@/lib/config', () => ({
  CONFIG: {
    MERCHANT_ID: '10000000-0000-4000-8000-000000000003',
    MERCHANT_SLUG: ' ogabassey ',
  },
}));

it('keeps the authenticated merchant and user for transfer verification', () => {
  mockMerchantId = '10000000-0000-4000-8000-000000000001';
  const { result } = renderHook(() => useStartSavingsIdentity());
  expect(result.current).toEqual({
    userId: 'user-1',
    activeMerchantId: mockMerchantId,
    activeMerchantSlug: 'ogabassey',
  });
});

it('uses configured merchant identity when the store has none', () => {
  mockMerchantId = null;
  const { result } = renderHook(() => useStartSavingsIdentity());
  expect(result.current.activeMerchantId).toBe(
    '10000000-0000-4000-8000-000000000003'
  );
});
