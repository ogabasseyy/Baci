import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook } from '@testing-library/react-native';
import * as Crypto from 'expo-crypto';
import { walletPayPurchaseKeys } from '@/components/wallet-pay/wallet-pay-purchase-keys';
import { imeiWalletPayApi } from '@/lib/wallet-pay/imei-wallet-pay-api';
import { useImeiWalletPay } from './use-imei-wallet-pay';

jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: {
    getState: () => ({ user: { id: 'user-1' }, merchantId: 'merchant-1' }),
  },
}));
jest.mock('@/lib/wallet-pay/imei-wallet-pay-api', () => ({
  imeiWalletPayApi: { start: jest.fn(), verifyPin: jest.fn(), pay: jest.fn() },
}));

const start = imeiWalletPayApi.start as jest.Mock;
const uuid = Crypto.randomUUID as jest.Mock;
const IMEI = '356938035643809';
const LOOKUP = '11111111-1111-4111-8111-111111111111';
const OP = '22222222-2222-4222-8222-222222222222';
const refetch = jest.fn();

function setup() {
  return renderHook(() =>
    useImeiWalletPay({
      accessToken: 'token',
      apiBaseUrl: 'https://api.test',
      device: 'smartphone',
      walletQuery: {
        data: { wallet: { balance: 0, primary_balance_kobo: 1_000_000 } },
        refetch,
      },
      onDelivered: jest.fn(),
      canPay: true,
    })
  );
}

const keyOfCall = (n: number) =>
  (start.mock.calls[n][1] as { idempotencyKey: string }).idempotencyKey;

async function openAndClose(
  hook: ReturnType<typeof setup>,
  tier: 'basic' | 'full' = 'basic'
) {
  await act(async () => {
    await hook.result.current.open(tier, IMEI);
  });
  act(() => hook.result.current.sheet.close());
}

beforeEach(async () => {
  start.mockReset();
  uuid.mockReset();
  refetch.mockReset();
  await AsyncStorage.clear();
  walletPayPurchaseKeys.resetMemory();
  let n = 0;
  uuid.mockImplementation(() => {
    n += 1;
    return `key-${n}`;
  });
});

describe('bugfix: closing a pending payment let the next tap pay again (Codex P1)', () => {
  it('resumes a payment still being confirmed with the same key, even after an app restart', async () => {
    start.mockResolvedValue({
      httpStatus: 202,
      body: {
        status: 'payment_review',
        lookupId: LOOKUP,
        operationId: OP,
        amountKobo: 30_000,
      },
    });
    const first = setup();
    await openAndClose(first);
    first.unmount();
    // An app restart: only what was saved on the phone survives.
    walletPayPurchaseKeys.resetMemory();
    const second = setup();
    await openAndClose(second);
    expect(keyOfCall(0)).toBe('key-1');
    expect(keyOfCall(1)).toBe('key-1');
    expect(refetch).not.toHaveBeenCalled();
  });

  it('retries a start whose answer was lost with the same key', async () => {
    start.mockRejectedValueOnce(new Error('network'));
    start.mockResolvedValueOnce({ httpStatus: 503, body: {} });
    const hook = setup();
    await openAndClose(hook);
    await openAndClose(hook);
    expect(keyOfCall(1)).toBe('key-1');
  });

  it('uses a new key once the purchase settled, and for another check', async () => {
    start.mockResolvedValue({ httpStatus: 503, body: {} });
    const hook = setup();
    await openAndClose(hook);
    await openAndClose(hook);
    expect(keyOfCall(1)).toBe('key-2');
    // Settled: the balance is read again.
    expect(refetch).toHaveBeenCalled();

    start.mockRejectedValueOnce(new Error('network'));
    await openAndClose(hook);
    await openAndClose(hook, 'full');
    expect(keyOfCall(3)).not.toBe(keyOfCall(2));
  });
});

describe('bugfix: a tier the server cannot bill kept opening the sheet (Codex P2)', () => {
  it('stops offering the PiggyVest wallet for a tier the server refused', async () => {
    start.mockResolvedValue({
      httpStatus: 409,
      body: { code: 'PIGGYVEST_PAY_UNAVAILABLE_FOR_TIER' },
    });
    const hook = setup();
    expect(hook.result.current.covers('basic')).toBe(true);
    await openAndClose(hook);
    expect(hook.result.current.covers('basic')).toBe(false);
  });
});
