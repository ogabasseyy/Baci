import { act, renderHook } from '@testing-library/react-native';
import * as Crypto from 'expo-crypto';
import { imeiWalletPayApi } from '@/lib/wallet-pay/imei-wallet-pay-api';
import { useImeiWalletPay } from './use-imei-wallet-pay';

jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/lib/wallet-pay/imei-wallet-pay-api', () => ({
  imeiWalletPayApi: { start: jest.fn(), verifyPin: jest.fn(), pay: jest.fn() },
}));

const start = imeiWalletPayApi.start as jest.Mock;
const uuid = Crypto.randomUUID as jest.Mock;
const IMEI = '356938035643809';

function setup() {
  return renderHook(() =>
    useImeiWalletPay({
      accessToken: 'token',
      apiBaseUrl: 'https://api.test',
      device: 'smartphone',
      wallet: { balance: 0, primary_balance_kobo: 1_000_000 },
      onDelivered: jest.fn(),
      canPay: true,
    })
  );
}

const keyOfCall = (n: number) =>
  (start.mock.calls[n][1] as { idempotencyKey: string }).idempotencyKey;

async function openAndClose(hook: ReturnType<typeof setup>) {
  await act(async () => {
    await hook.result.current.open('basic', IMEI);
  });
  act(() => hook.result.current.sheet.close());
}

beforeEach(() => {
  jest.resetAllMocks();
  let n = 0;
  uuid.mockImplementation(() => {
    n += 1;
    return `key-${n}`;
  });
});

describe('bugfix: a lost start answer opened a second lookup (Muse review)', () => {
  it('retries a start whose answer was lost with the same key', async () => {
    start.mockRejectedValueOnce(new Error('network'));
    start.mockResolvedValueOnce({ httpStatus: 503, body: {} });
    const hook = setup();
    await openAndClose(hook);
    await openAndClose(hook);
    expect(keyOfCall(0)).toBe('key-1');
    expect(keyOfCall(1)).toBe('key-1');
  });

  it('uses a new key once the server answered, or for another check', async () => {
    start.mockResolvedValue({ httpStatus: 503, body: {} });
    const hook = setup();
    await openAndClose(hook);
    await openAndClose(hook);
    expect(keyOfCall(1)).toBe('key-2');

    start.mockRejectedValueOnce(new Error('network'));
    await openAndClose(hook);
    await act(async () => {
      await hook.result.current.open('full', IMEI);
    });
    expect(keyOfCall(3)).not.toBe(keyOfCall(2));
  });
});
