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
  digestStringAsync: async () => 'switch-hash',
}));
jest.mock('@/env', () => ({ EXPO_PUBLIC_API_URL: 'https://api.test' }));
const mockAuth = {
  user: { id: 'user-1' },
  session: { access_token: 'token-1' },
};
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
  mockAuth.user = { id: 'user-1' };
  mockAuth.session = { access_token: 'token-1' };
  useVtuWalletPayStore.setState({ covers: () => false, pending: null });
});

describe("bugfix: an account switch left the old account's payment issued (Codex P2)", () => {
  it("cancels with the issuing account's own token when the switch closes the sheet", async () => {
    cancel.mockResolvedValue({
      httpStatus: 200,
      body: { status: 'cancelled' },
    });
    start.mockResolvedValue(issued);
    const hook = renderHook(() => useVtuWalletPayHost({ canPay: true }));
    await act(async () => {
      openVtuWalletPay(request, jest.fn());
    });
    expect(hook.result.current.sheet.step).toBe('enter');
    // Arrange: another account signs in while the PIN is asked.
    mockAuth.user = { id: 'user-2' };
    mockAuth.session = { access_token: 'token-2' };
    await act(async () => hook.rerender({}));
    expect(cancel).toHaveBeenCalledTimes(1);
    const [connection, input] = cancel.mock.calls[0];
    expect(connection.accessToken()).toBe('token-1');
    expect(input).toEqual(
      expect.objectContaining({ expectedUserId: 'user-1' })
    );
    hook.unmount();
  });
});

describe('bugfix: a retained PiggyVest purchase fell back to store credit (Codex P1)', () => {
  it('reports a purchase whose PiggyVest key is kept, and none once it is gone', async () => {
    // A cancellation that does not go through keeps the key.
    cancel.mockResolvedValue({ httpStatus: 503, body: {} });
    start.mockResolvedValue(issued);
    const hook = renderHook(() => useVtuWalletPayHost({ canPay: true }));
    const retains = () => useVtuWalletPayStore.getState().retains(request);
    await expect(retains()).resolves.toBe(false);
    await act(async () => {
      openVtuWalletPay(request, jest.fn());
    });
    await act(async () => hook.result.current.sheet.close());
    await expect(retains()).resolves.toBe(true);
    hook.unmount();
  });
});

describe('bugfix: a kept PiggyVest key was hidden while the utilities switch was off (Codex P1)', () => {
  it('still reports the kept key with the switch off, so a rollback replays it', async () => {
    cancel.mockResolvedValue({ httpStatus: 503, body: {} });
    start.mockResolvedValue(issued);
    const on = renderHook(() => useVtuWalletPayHost({ canPay: true }));
    await act(async () => {
      openVtuWalletPay(request, jest.fn());
    });
    await act(async () => on.result.current.sheet.close());
    on.unmount();
    const off = renderHook(() => useVtuWalletPayHost({ canPay: false }));
    await expect(
      useVtuWalletPayStore.getState().retains(request)
    ).resolves.toBe(true);
    off.unmount();
  });
});

describe('bugfix: a hand-over from another account opened its sheet (Codex P1)', () => {
  it('never shows the PIN sheet to an account that did not hand it over', async () => {
    const hook = renderHook(() => useVtuWalletPayHost({ canPay: true }));
    useVtuWalletPayStore.setState({ covers: () => true });
    start.mockClear();
    // Handed over by user-1; user-2 is signed in by the time it opens.
    mockAuth.user = { id: 'user-2' };
    await act(async () => {
      useVtuWalletPayStore.setState({
        pending: { request, onDelivered: jest.fn(), userId: 'user-1' },
      });
    });
    expect(hook.result.current.sheet.step).toBe('closed');
    expect(start).not.toHaveBeenCalled();
    expect(useVtuWalletPayStore.getState().pending).toBeNull();
    hook.unmount();
  });
});

describe('bugfix: the issuing token was read after the start answered (Codex P2)', () => {
  it('cancels with the token captured before the start, even if the account switched mid-start', async () => {
    cancel.mockResolvedValue({
      httpStatus: 200,
      body: { status: 'cancelled' },
    });
    let answer: (value: unknown) => void = () => undefined;
    start.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      })
    );
    const hook = renderHook(() => useVtuWalletPayHost({ canPay: true }));
    await act(async () => {
      openVtuWalletPay(request, jest.fn());
    });
    // The start is out; another account signs in, then it answers.
    mockAuth.user = { id: 'user-2' };
    mockAuth.session = { access_token: 'token-2' };
    await act(async () => {
      answer(issued);
      hook.rerender({});
    });
    expect(cancel).toHaveBeenCalled();
    const [connection] = cancel.mock.calls.at(-1);
    expect(connection.accessToken()).toBe('token-1');
    hook.unmount();
  });
});
