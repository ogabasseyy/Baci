import { renderHook } from '@testing-library/react-native';
import { useImeiWalletPay } from './use-imei-wallet-pay';

jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: { getState: () => ({ user: null, merchantId: null }) },
}));

describe('useImeiWalletPay while paying from PiggyVest is switched off', () => {
  it('never offers the PiggyVest wallet, even to a funded PiggyVest customer', () => {
    const hook = renderHook(() =>
      useImeiWalletPay({
        accessToken: 'token',
        apiBaseUrl: 'https://api.test',
        device: 'smartphone',
        walletQuery: {
          data: { wallet: { balance: 0, primary_balance_kobo: 10_000_000 } },
        },
        onDelivered: jest.fn(),
      })
    );
    expect(hook.result.current.covers('basic')).toBe(false);
    expect(hook.result.current.sheet.step).toBe('closed');
  });

  it('never offers it when the server sent no PiggyVest verdict', () => {
    const hook = renderHook(() =>
      useImeiWalletPay({
        accessToken: 'token',
        apiBaseUrl: 'https://api.test',
        device: 'smartphone',
        walletQuery: { data: { wallet: { balance: 0 } } },
        onDelivered: jest.fn(),
        canPay: true,
      })
    );
    expect(hook.result.current.covers('basic')).toBe(false);
  });
});
