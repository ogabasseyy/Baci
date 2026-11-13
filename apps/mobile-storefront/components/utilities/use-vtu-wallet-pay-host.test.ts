import { act, renderHook } from '@testing-library/react-native';
import { vtuWalletPayApi } from '@/lib/wallet-pay/vtu-wallet-pay-api';
import { useVtuWalletPayHost } from './use-vtu-wallet-pay-host';
import { openVtuWalletPay, useVtuWalletPayStore } from './vtu-wallet-pay-store';

const mockWallet: { data: unknown; isRefetching: boolean; refetch: jest.Mock } =
  {
    data: { wallet: { balance: 0, primary_balance_kobo: 1_000_000 } },
    isRefetching: false,
    refetch: jest.fn(),
  };
jest.mock('@/hooks/use-wallet', () => ({ useWallet: () => mockWallet }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => 'key-1'),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async () => 'hash',
}));
jest.mock('@/env', () => ({ EXPO_PUBLIC_API_URL: 'https://api.test' }));
const mockAuth: {
  user: { id: string } | null;
  session: { access_token: string };
} = { user: { id: 'user-1' }, session: { access_token: 't' } };
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
const request = {
  amount: 500,
  phoneNumber: '08031234567',
  type: 'airtime' as const,
  walletAmount: 500,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockWallet.isRefetching = false;
  useVtuWalletPayStore.setState({ covers: () => false, pending: null });
});

describe('useVtuWalletPayHost (switched on)', () => {
  it('covers an amount the PiggyVest wallet can pay, never during a refresh', () => {
    const hook = renderHook(() => useVtuWalletPayHost({ canPay: true }));
    expect(useVtuWalletPayStore.getState().covers(500)).toBe(true);
    mockWallet.isRefetching = true;
    hook.rerender({});
    expect(useVtuWalletPayStore.getState().covers(500)).toBe(false);
  });

  it('opens the sheet for a handed-over purchase and frees it once closed', async () => {
    start.mockResolvedValue({
      httpStatus: 503,
      body: { code: 'PIGGYVEST_PAY_UNAVAILABLE' },
    });
    const hook = renderHook(() => useVtuWalletPayHost({ canPay: true }));
    await act(async () => {
      openVtuWalletPay(request, jest.fn());
    });
    expect(start).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        request,
        idempotencyKey: 'key-1',
        expectedUserId: 'user-1',
      })
    );
    expect(hook.result.current.sheet.outcome).toEqual({ kind: 'unavailable' });
    act(() => hook.result.current.sheet.close());
    expect(useVtuWalletPayStore.getState().pending).toBeNull();
  });
});

describe('bugfix: a balance not yet known could pay from PiggyVest (Fable walk)', () => {
  it('covers nothing while the wallet is loading, or beyond its balance', () => {
    const loaded = mockWallet.data;
    mockWallet.data = undefined;
    const hook = renderHook(() => useVtuWalletPayHost({ canPay: true }));
    expect(useVtuWalletPayStore.getState().covers(100)).toBe(false);
    expect(openVtuWalletPay(request, jest.fn())).toBe(false);
    mockWallet.data = loaded;
    hook.rerender({});
    expect(useVtuWalletPayStore.getState().covers(10_000)).toBe(true);
    expect(useVtuWalletPayStore.getState().covers(1_000_000)).toBe(false);
    hook.unmount();
  });
});

describe('bugfix: an answer after an account switch reached the new account (Codex P2)', () => {
  it('drops a delivered purchase when the account changed while it was out', async () => {
    let answer: (value: unknown) => void = () => undefined;
    start.mockImplementation(
      () => new Promise((resolve) => (answer = resolve))
    );
    const onDelivered = jest.fn();
    const hook = renderHook(() => useVtuWalletPayHost({ canPay: true }));
    await act(async () => {
      openVtuWalletPay(request, onDelivered);
    });
    mockAuth.user = { id: 'user-2' };
    await act(async () => {
      answer({
        httpStatus: 200,
        body: { status: 'successful', reference: 'REF', amount: 500 },
      });
    });
    expect(onDelivered).not.toHaveBeenCalled();
    mockAuth.user = { id: 'user-1' };
    hook.unmount();
  });
});

describe('bugfix: a ready ₦549,700 PiggyVest wallet was not offered for ₦100 airtime (Fable walk)', () => {
  it('covers ₦100 and publishes the savings balance', () => {
    const loaded = mockWallet.data;
    mockWallet.data = {
      wallet: { balance: 0, primary_balance_kobo: 54_970_000 },
    };
    const hook = renderHook(() => useVtuWalletPayHost({ canPay: true }));
    expect(useVtuWalletPayStore.getState().covers(100)).toBe(true);
    expect(useVtuWalletPayStore.getState().balanceKobo).toBe(54_970_000);
    hook.unmount();
    mockWallet.data = loaded;
  });

  it('offers nothing to a customer the server reports no PiggyVest wallet for', () => {
    const loaded = mockWallet.data;
    mockWallet.data = { wallet: { balance: 0 } };
    const hook = renderHook(() => useVtuWalletPayHost({ canPay: true }));
    expect(useVtuWalletPayStore.getState().covers(100)).toBe(false);
    expect(useVtuWalletPayStore.getState().balanceKobo).toBeNull();
    hook.unmount();
    mockWallet.data = loaded;
  });
});

describe('bugfix: a sheet closed before the PIN left the purchase blocking store credit (Codex P2)', () => {
  const issued = {
    httpStatus: 202,
    body: {
      status: 'payment_required',
      transactionId: '33333333-3333-4333-8333-333333333333',
      operationId: '11111111-1111-4111-8111-111111111111',
      amountKobo: 50_000,
    },
  };

  it('cancels the issued payment when the sheet closes before any pay', async () => {
    const cancel = vtuWalletPayApi.cancel as jest.Mock;
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
    await act(async () => hook.result.current.sheet.close());
    expect(cancel).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        operationId: '11111111-1111-4111-8111-111111111111',
        idempotencyKey: 'key-1',
      })
    );
    hook.unmount();
  });

  it('never cancels once the pay request was sent', async () => {
    const cancel = vtuWalletPayApi.cancel as jest.Mock;
    start.mockResolvedValue(issued);
    (vtuWalletPayApi.verifyPin as jest.Mock).mockResolvedValue({
      httpStatus: 200,
      body: { proof: 'a'.repeat(64) },
    });
    (vtuWalletPayApi.pay as jest.Mock).mockResolvedValue({
      httpStatus: 202,
      body: { status: 'payment_pending' },
    });
    const hook = renderHook(() => useVtuWalletPayHost({ canPay: true }));
    await act(async () => {
      openVtuWalletPay(request, jest.fn());
    });
    act(() => hook.result.current.sheet.setPin('1234'));
    await act(async () => {
      await hook.result.current.sheet.submit();
    });
    await act(async () => hook.result.current.sheet.close());
    expect(cancel).not.toHaveBeenCalled();
    hook.unmount();
  });
});

describe('bugfix: a start that answered after the sheet closed stayed issued (Codex P2)', () => {
  it('cancels the issued payment right away', async () => {
    const cancel = vtuWalletPayApi.cancel as jest.Mock;
    cancel.mockResolvedValue({
      httpStatus: 200,
      body: { status: 'cancelled' },
    });
    let answer: (value: unknown) => void = () => undefined;
    start.mockImplementation(
      () => new Promise((resolve) => (answer = resolve))
    );
    const hook = renderHook(() => useVtuWalletPayHost({ canPay: true }));
    await act(async () => {
      openVtuWalletPay(request, jest.fn());
    });
    await act(async () => hook.result.current.sheet.close());
    await act(async () => {
      answer({
        httpStatus: 202,
        body: {
          status: 'payment_required',
          transactionId: '33333333-3333-4333-8333-333333333333',
          operationId: '11111111-1111-4111-8111-111111111111',
          amountKobo: 50_000,
        },
      });
    });
    expect(cancel).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        operationId: '11111111-1111-4111-8111-111111111111',
      })
    );
    hook.unmount();
  });
});
