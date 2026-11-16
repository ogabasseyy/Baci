import { vtuWalletPayApi } from './vtu-wallet-pay-api';

// With the server keeping PiggyVest off it answers 503
// PIGGYVEST_PAY_UNAVAILABLE; the call hands that back unchanged. Nothing in
// the app calls this unless paying from the PiggyVest wallet is switched on.
describe('vtuWalletPayApi with the server keeping PiggyVest off', () => {
  it('returns the unavailable answer as it came', async () => {
    const fetchImpl = jest.fn(async () => ({
      status: 503,
      json: async () => ({ code: 'PIGGYVEST_PAY_UNAVAILABLE' }),
    })) as unknown as typeof fetch;
    const reply = await vtuWalletPayApi.start(
      { apiBaseUrl: 'https://api.test', accessToken: 'token', fetchImpl },
      {
        request: {
          amount: 500,
          phoneNumber: '08031234567',
          type: 'airtime',
          walletAmount: 500,
        },
        idempotencyKey: '22222222-2222-4222-8222-222222222222',
      }
    );
    expect(reply).toEqual({
      httpStatus: 503,
      body: { code: 'PIGGYVEST_PAY_UNAVAILABLE' },
    });
  });
});
