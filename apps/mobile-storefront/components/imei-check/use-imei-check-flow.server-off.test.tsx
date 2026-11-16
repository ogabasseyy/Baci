import { act, renderHook } from '@testing-library/react-native';
import { useImeiCheckFlow } from './use-imei-check-flow';

const mockSubmit = jest.fn();
const mockFundWallet = jest.fn();
let mockBalance = 0;

jest.mock('./submit-imei-check', () => ({
  submitImeiCheck: (...args: unknown[]) => mockSubmit(...args),
}));
jest.mock('./use-imei-pending-lookup', () => ({
  useImeiPendingLookup: () => ({
    pending: null,
    terminal: null,
    paused: false,
    canResume: true,
    start: jest.fn(),
    clear: jest.fn(),
    clearTerminal: jest.fn(),
  }),
}));
jest.mock('./imei-check-screen-actions', () => {
  const actual = jest.requireActual<
    typeof import('./imei-check-screen-actions')
  >('./imei-check-screen-actions');
  return {
    imeiCheckScreenActions: {
      ...actual.imeiCheckScreenActions,
      fundWallet: (...args: unknown[]) => mockFundWallet(...args),
      networkErrorMessage: () => 'Network error',
    },
  };
});
jest.mock('@/hooks/use-wallet', () => ({
  useWallet: () => ({
    // A funded PiggyVest customer with no store credit.
    data: {
      wallet: { balance: mockBalance, primary_balance_kobo: 10_000_000 },
    },
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  }),
}));
jest.mock('@/hooks/use-store-credit-purchase-copy', () => ({
  useStoreCreditPurchaseCopy: () => false,
}));
jest.mock('@/stores/auth-store', () => {
  const state = {
    session: { access_token: 'token', user: { id: 'user-1' } },
    user: { id: 'user-1' },
    customer: { id: 'customer-1' },
    merchantId: 'merchant-1',
  };
  const useAuthStore = (selector: (s: typeof state) => unknown) =>
    selector(state);
  useAuthStore.getState = () => state;
  return { useAuthStore };
});
jest.mock('expo-crypto', () => ({
  randomUUID: () => '11111111-1111-4111-8111-111111111111',
  digestStringAsync: async () => 'digest',
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ error: jest.fn() }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockBalance = 0;
});

describe('useImeiCheckFlow while paying from PiggyVest is switched off', () => {
  it('sends a short store credit balance to a top-up, never to PiggyVest', async () => {
    const { result } = renderHook(() =>
      useImeiCheckFlow('smartphone', 'https://api.test')
    );
    await act(async () => {
      await result.current.handleVerify('blacklist', '490154203237518');
    });
    expect(result.current.walletPay.sheet.step).toBe('closed');
    expect(mockFundWallet).toHaveBeenCalledTimes(1);
    expect(mockSubmit).not.toHaveBeenCalled();
  });
});
