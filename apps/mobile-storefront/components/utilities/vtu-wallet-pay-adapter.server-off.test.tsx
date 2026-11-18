import { vtuWalletPayApi } from '@/lib/wallet-pay/vtu-wallet-pay-api';
import { createVtuWalletPayAdapter } from './vtu-wallet-pay-adapter';

jest.mock('@/lib/wallet-pay/vtu-wallet-pay-api', () => ({
  vtuWalletPayApi: { start: jest.fn(), verifyPin: jest.fn(), pay: jest.fn() },
}));

const api = vtuWalletPayApi as unknown as Record<
  'start' | 'verifyPin' | 'pay',
  jest.Mock
>;

describe('VTU wallet pay with the server keeping PiggyVest off', () => {
  it('stops at "paused" and never asks for a PIN or pays', async () => {
    api.start.mockResolvedValue({
      httpStatus: 503,
      body: { code: 'PIGGYVEST_PAY_UNAVAILABLE' },
    });
    const pay = createVtuWalletPayAdapter({
      connection: { apiBaseUrl: 'https://api.test', accessToken: 'token' },
      request: {
        amount: 500,
        phoneNumber: '08031234567',
        type: 'airtime',
        walletAmount: 500,
      },
      idempotencyKey: 'key',
    });
    await expect(pay.start()).resolves.toEqual({
      kind: 'outcome',
      outcome: { kind: 'unavailable' },
    });
    expect(api.verifyPin).not.toHaveBeenCalled();
    expect(api.pay).not.toHaveBeenCalled();
  });
});
