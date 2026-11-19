import { act, renderHook } from '@testing-library/react-native';
import { vtuWalletPayApi } from '@/lib/wallet-pay/vtu-wallet-pay-api';
import { useVtuWalletPayHost } from './use-vtu-wallet-pay-host';
import { openVtuWalletPay, useVtuWalletPayStore } from './vtu-wallet-pay-store';

jest.mock('@/hooks/use-wallet', () => ({
  useWallet: () => ({
    data: { wallet: { balance: 0, primary_balance_kobo: 1_000_000 } },
    isRefetching: false,
    refetch: jest.fn(),
  }),
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
let mockKeys = 0;
jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => `key-${++mockKeys}`),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async () => 'race-hash',
}));
jest.mock('@/env', () => ({ EXPO_PUBLIC_API_URL: 'https://api.test' }));
const mockAuth = { user: { id: 'user-1' }, session: { access_token: 't' } };
jest.mock('@/stores/auth-store', () => {
  const useAuthStore = (selector: (s: typeof mockAuth) => unknown) =>
    selector(mockAuth);
  useAuthStore.getState = () => mockAuth;
  return { useAuthStore };
});
jest.mock('@/lib/wallet-pay/vtu-wallet-pay-api', () => ({
  vtuWalletPayApi: {
    start: jest.fn(),
    verifyPin: jest.fn(),
    pay: jest.fn(),
    cancel: jest.fn(),
  },
}));

const start = vtuWalletPayApi.start as jest.Mock;
const cancel = vtuWalletPayApi.cancel as jest.Mock;
const request = {
  amount: 700,
  phoneNumber: '08039876543',
  type: 'airtime' as const,
  walletAmount: 700,
};
const issued = {
  httpStatus: 202,
  body: {
    status: 'payment_required',
    transactionId: '33333333-3333-4333-8333-333333333333',
    operationId: '11111111-1111-4111-8111-111111111111',
    amountKobo: 70_000,
  },
};

beforeEach(() => {
  useVtuWalletPayStore.setState({ covers: () => false, pending: null });
});

describe('bugfix: a retry adopted an operation still being cancelled (Codex P2)', () => {
  it('starts the retried purchase only after the cancellation settles, with a fresh key', async () => {
    // Arrange: a cancellation the server has not answered yet.
    let settle: (value: unknown) => void = () => undefined;
    cancel.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      })
    );
    start.mockResolvedValue(issued);
    const hook = renderHook(() => useVtuWalletPayHost({ canPay: true }));
    await act(async () => {
      openVtuWalletPay(request, jest.fn());
    });
    await act(async () => hook.result.current.sheet.close());
    expect(cancel).toHaveBeenCalledTimes(1);

    // Act: the customer retries the same purchase at once.
    await act(async () => {
      openVtuWalletPay(request, jest.fn());
    });

    // Assert: nothing reuses the operation being cancelled.
    expect(start).toHaveBeenCalledTimes(1);
    await act(async () => {
      settle({ httpStatus: 200, body: { status: 'cancelled' } });
    });
    expect(start).toHaveBeenCalledTimes(2);
    expect(start.mock.calls[1][1]).toEqual(
      expect.objectContaining({ idempotencyKey: 'key-2' })
    );
    hook.unmount();
  });
});
