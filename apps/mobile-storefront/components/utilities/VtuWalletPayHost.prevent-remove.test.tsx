import { act, render } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { vtuWalletPayApi } from '@/lib/wallet-pay/vtu-wallet-pay-api';
import { VtuWalletPayHost } from './VtuWalletPayHost';
import { openVtuWalletPay } from './vtu-wallet-pay-store';

jest.mock('@/hooks/use-wallet', () => ({
  useWallet: () => ({
    data: { wallet: { balance: 0, primary_balance_kobo: 1_000_000 } },
    isRefetching: false,
    refetch: jest.fn(),
  }),
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
const mockPreventRemove = jest.fn();
jest.mock('expo-router/react-navigation', () => ({
  usePreventRemove: (...args: unknown[]) => mockPreventRemove(...args),
}));
jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => 'key-remove'),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async () => 'remove-hash',
}));
jest.mock('@/env', () => ({ EXPO_PUBLIC_API_URL: 'https://api.test' }));
jest.mock('@react-native-vector-icons/ionicons', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/components/ui/ModalSheet', () => ({
  ModalSheet: ({
    visible,
    children,
  }: {
    visible: boolean;
    children: unknown;
  }) => (visible ? children : null),
}));
jest.mock('@/stores/auth-store', () => {
  const state = { user: { id: 'user-1' }, session: { access_token: 't' } };
  const useAuthStore = (selector: (s: typeof state) => unknown) =>
    selector(state);
  useAuthStore.getState = () => state;
  return { useAuthStore };
});
jest.mock('@/lib/wallet-pay/vtu-wallet-pay-api', () => ({
  vtuWalletPayApi: {
    start: jest.fn(),
    verifyPin: jest.fn(),
    pay: jest.fn(),
    cancel: jest.fn(async () => ({ httpStatus: 200, body: {} })),
  },
}));

describe('bugfix: leaving the utilities screen abandoned an open PiggyVest sheet (Codex P2)', () => {
  it('holds the screen while the sheet is open and goes back through the sheet', async () => {
    (vtuWalletPayApi.start as jest.Mock).mockResolvedValue({
      httpStatus: 202,
      body: {
        status: 'payment_required',
        transactionId: '33333333-3333-4333-8333-333333333333',
        operationId: '11111111-1111-4111-8111-111111111111',
        amountKobo: 50_000,
      },
    });
    render(<VtuWalletPayHost colors={Colors.light} canPay />);
    await act(async () => {
      openVtuWalletPay(
        {
          amount: 500,
          phoneNumber: '08031234567',
          type: 'airtime',
          walletAmount: 500,
        },
        jest.fn()
      );
    });
    const [held, onRemove] = mockPreventRemove.mock.calls.at(-1);
    expect(held).toBe(true);
    await act(async () => onRemove());
    expect(mockPreventRemove.mock.calls.at(-1)[0]).toBe(false);
  });
});
