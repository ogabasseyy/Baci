import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook } from '@testing-library/react-native';
import * as Crypto from 'expo-crypto';
import { walletPayPurchaseKeys } from '@/components/wallet-pay/wallet-pay-purchase-keys';
import { imeiWalletPayApi } from '@/lib/wallet-pay/imei-wallet-pay-api';
import { useImeiWalletPay } from './use-imei-wallet-pay';

const mockRefreshActivity = jest.fn();
jest.mock('@/hooks/use-refresh-wallet-activity', () => ({
  useRefreshWalletActivity: () => mockRefreshActivity,
}));
jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => 'key-1'),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async (_algorithm: string, value: string) =>
    `sha256(${value.length})`,
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/stores/auth-store', () => {
  const state = { user: { id: 'user-1' }, merchantId: 'merchant-1' };
  const useAuthStore = (selector: (s: typeof state) => unknown) =>
    selector(state);
  useAuthStore.getState = () => state;
  return { useAuthStore };
});
jest.mock('@/lib/wallet-pay/imei-wallet-pay-api', () => ({
  imeiWalletPayApi: { start: jest.fn(), verifyPin: jest.fn(), pay: jest.fn() },
}));

const IMEI = '356938035643809';
const LOOKUP = '11111111-1111-4111-8111-111111111111';
const OP = '22222222-2222-4222-8222-222222222222';

beforeEach(async () => {
  jest.clearAllMocks();
  (Crypto.randomUUID as jest.Mock).mockReturnValue('key-1');
  await AsyncStorage.clear();
  walletPayPurchaseKeys.resetMemory();
});

describe('bugfix: a pay that failed in flight left the wallet activity stale (CodeRabbit)', () => {
  it('refreshes the activity list when the pay request rejects, as the sheet reads it as pending', async () => {
    (imeiWalletPayApi.start as jest.Mock).mockResolvedValue({
      httpStatus: 202,
      body: {
        status: 'payment_required',
        lookupId: LOOKUP,
        operationId: OP,
        amountKobo: 30_000,
      },
    });
    (imeiWalletPayApi.verifyPin as jest.Mock).mockResolvedValue({
      httpStatus: 200,
      body: { proof: 'a'.repeat(64) },
    });
    (imeiWalletPayApi.pay as jest.Mock).mockRejectedValue(new Error('timeout'));
    const hook = renderHook(() =>
      useImeiWalletPay({
        apiBaseUrl: 'https://api.test',
        device: 'smartphone',
        walletQuery: {
          data: { wallet: { balance: 0, primary_balance_kobo: 1_000_000 } },
          refetch: jest.fn(),
        },
        onDelivered: jest.fn(),
        canPay: true,
      })
    );
    await act(async () => {
      await hook.result.current.open('basic', IMEI);
    });
    act(() => hook.result.current.sheet.setPin('1234'));
    await act(async () => {
      await hook.result.current.sheet.submit();
    });
    expect(imeiWalletPayApi.pay).toHaveBeenCalled();
    expect(mockRefreshActivity).toHaveBeenCalled();
    hook.unmount();
  });
});
