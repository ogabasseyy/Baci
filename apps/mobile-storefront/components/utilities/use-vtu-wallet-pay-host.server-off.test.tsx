import { renderHook } from '@testing-library/react-native';
import { useVtuWalletPayHost } from './use-vtu-wallet-pay-host';
import { useVtuWalletPayStore } from './vtu-wallet-pay-store';

jest.mock('@/hooks/use-wallet', () => ({
  useWallet: () => ({
    data: { wallet: { balance: 0, primary_balance_kobo: 10_000_000 } },
    isRefetching: false,
    refetch: jest.fn(),
  }),
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
jest.mock('@/env', () => ({ EXPO_PUBLIC_API_URL: 'https://api.test' }));
jest.mock('@/stores/auth-store', () => {
  const state = { user: null, session: null };
  const useAuthStore = (selector: (s: typeof state) => unknown) =>
    selector(state);
  useAuthStore.getState = () => state;
  return { useAuthStore };
});

describe('useVtuWalletPayHost while paying from PiggyVest is switched off', () => {
  it('covers nothing, even for a funded PiggyVest customer', () => {
    const hook = renderHook(() => useVtuWalletPayHost());
    expect(useVtuWalletPayStore.getState().covers(500)).toBe(false);
    expect(hook.result.current.sheet.step).toBe('closed');
  });
});
