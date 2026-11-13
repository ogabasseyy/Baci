import { act, renderHook } from '@testing-library/react-native';
import { useImeiWalletPay } from './use-imei-wallet-pay';

jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => 'key-1'),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async (_algorithm: string, value: string) =>
    `sha256(${value.length})`,
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
const mockState: { user: { id: string } | null; merchantId: string } = {
  user: { id: 'user-a' },
  merchantId: 'merchant-1',
};
jest.mock('@/stores/auth-store', () => {
  const useAuthStore = (selector: (s: typeof mockState) => unknown) =>
    selector(mockState);
  useAuthStore.getState = () => mockState;
  return { useAuthStore };
});
jest.mock('@/lib/wallet-pay/imei-wallet-pay-api', () => ({
  imeiWalletPayApi: {
    start: jest.fn(async () => ({
      httpStatus: 202,
      body: {
        status: 'payment_required',
        lookupId: '11111111-1111-4111-8111-111111111111',
        operationId: '22222222-2222-4222-8222-222222222222',
        amountKobo: 30_000,
      },
    })),
    verifyPin: jest.fn(async () => ({
      httpStatus: 200,
      body: { proof: 'a'.repeat(64) },
    })),
    pay: jest.fn(() => new Promise(() => undefined)),
  },
}));

const wallet = { balance: 0, primary_balance_kobo: 1_000_000 };

function setup(isRefetching = false) {
  return renderHook(() =>
    useImeiWalletPay({
      accessToken: 'token',
      apiBaseUrl: 'https://api.test',
      device: 'smartphone',
      walletQuery: { data: { wallet }, isRefetching },
      onDelivered: jest.fn(),
      canPay: true,
    })
  );
}

describe('bugfix: account switch with the wallet pay sheet open (Codex P1, Muse)', () => {
  it('closes the sheet when another account signs in', async () => {
    const hook = setup();
    await act(async () => {
      await hook.result.current.open('basic', '356938035643809');
    });
    expect(hook.result.current.sheet.step).toBe('enter');
    mockState.user = { id: 'user-b' };
    hook.rerender({});
    expect(hook.result.current.sheet.step).toBe('closed');
    mockState.user = { id: 'user-a' };
  });
});

describe('bugfix: a stale balance during a wallet refresh chose PiggyVest (Codex P2)', () => {
  it('waits for the refresh when paying from PiggyVest is on', () => {
    expect(setup(true).result.current.waitsForWallet).toBe(true);
    expect(setup(false).result.current.waitsForWallet).toBe(false);
  });
});

describe('bugfix: a payment in flight kept its sheet after an account switch (Codex P1)', () => {
  it('closes the paying sheet so its answer never shows on the new account', async () => {
    const hook = setup();
    await act(async () => {
      await hook.result.current.open('basic', '356938035643809');
    });
    act(() => hook.result.current.sheet.setPin('1234'));
    act(() => {
      void hook.result.current.sheet.submit();
    });
    await act(async () => undefined);
    expect(hook.result.current.sheet.step).toBe('paying');
    mockState.user = { id: 'user-b' };
    hook.rerender({});
    expect(hook.result.current.sheet.step).toBe('closed');
    mockState.user = { id: 'user-a' };
  });
});
