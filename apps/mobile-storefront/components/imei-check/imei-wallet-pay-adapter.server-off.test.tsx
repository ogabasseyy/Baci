import { imeiWalletPayApi } from '@/lib/wallet-pay/imei-wallet-pay-api';
import { createImeiWalletPayAdapter } from './imei-wallet-pay-adapter';

jest.mock('@/lib/wallet-pay/imei-wallet-pay-api', () => ({
  imeiWalletPayApi: { start: jest.fn(), verifyPin: jest.fn(), pay: jest.fn() },
}));

const api = imeiWalletPayApi as unknown as Record<
  'start' | 'verifyPin' | 'pay',
  jest.Mock
>;

describe('IMEI wallet pay with the server keeping PiggyVest off', () => {
  it('stops at "paused" and never asks for a PIN or pays', async () => {
    api.start.mockResolvedValue({
      httpStatus: 503,
      body: { code: 'PIGGYVEST_PAY_UNAVAILABLE' },
    });
    const pay = createImeiWalletPayAdapter({
      connection: { apiBaseUrl: 'https://api.test', accessToken: 'token' },
      device: 'smartphone',
      tier: 'basic',
      imei: '356938035643809',
      idempotencyKey: '22222222-2222-4222-8222-222222222222',
    });
    await expect(pay.start()).resolves.toEqual({
      kind: 'outcome',
      outcome: { kind: 'unavailable' },
    });
    expect(api.verifyPin).not.toHaveBeenCalled();
    expect(api.pay).not.toHaveBeenCalled();
  });
});
