import { imeiWalletPayApi } from './imei-wallet-pay-api';

// With the server keeping PiggyVest off it answers 503
// PIGGYVEST_PAY_UNAVAILABLE; the call hands that back unchanged so the sheet
// can say "paused, nothing was taken". Nothing in the app calls this unless
// paying from the PiggyVest wallet is switched on.
describe('imeiWalletPayApi with the server keeping PiggyVest off', () => {
  it('returns the unavailable answer as it came', async () => {
    const fetchImpl = jest.fn(async () => ({
      status: 503,
      json: async () => ({
        code: 'PIGGYVEST_PAY_UNAVAILABLE',
        error: 'Paying from your PiggyVest wallet is not available right now.',
      }),
    })) as unknown as typeof fetch;
    const reply = await imeiWalletPayApi.start(
      { apiBaseUrl: 'https://api.test', accessToken: 'token', fetchImpl },
      {
        device: 'smartphone',
        tier: 'basic',
        imei: '356938035643809',
        idempotencyKey: '22222222-2222-4222-8222-222222222222',
      }
    );
    expect(reply.httpStatus).toBe(503);
    expect(reply.body.code).toBe('PIGGYVEST_PAY_UNAVAILABLE');
  });
});
