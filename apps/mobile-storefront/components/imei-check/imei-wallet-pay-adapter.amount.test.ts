import { IMEI_SERVICE_TIERS } from '@baci/shared/imei';
import { imeiWalletPayApi } from '@/lib/wallet-pay/imei-wallet-pay-api';
import { createImeiWalletPayAdapter } from './imei-wallet-pay-adapter';

jest.mock('@/lib/wallet-pay/imei-wallet-pay-api', () => ({
  imeiWalletPayApi: { start: jest.fn(), verifyPin: jest.fn(), pay: jest.fn() },
}));

const start = imeiWalletPayApi.start as jest.Mock;
const shownKobo = Math.round(IMEI_SERVICE_TIERS.basic.price * 100);
const issued = (amountKobo: number) => ({
  httpStatus: 202,
  body: {
    status: 'payment_required',
    lookupId: '11111111-1111-4111-8111-111111111111',
    operationId: '22222222-2222-4222-8222-222222222222',
    amountKobo,
  },
});
const adapter = () =>
  createImeiWalletPayAdapter({
    connection: { apiBaseUrl: 'https://api.test', accessToken: () => 't' },
    device: 'smartphone',
    tier: 'basic',
    imei: '356938035643809',
    idempotencyKey: '33333333-3333-4333-8333-333333333333',
  });

describe('bugfix: an issued amount above the shown price was asked for (Muse)', () => {
  it('refuses before the PIN when the server asks for more than the price shown', async () => {
    start.mockResolvedValue(issued(shownKobo + 100));
    await expect(adapter().start()).resolves.toEqual({
      kind: 'outcome',
      outcome: { kind: 'failed', failedReason: 'check_details' },
    });
  });

  it('asks for the PIN at the shown price or an older, lower recorded price', async () => {
    for (const amountKobo of [shownKobo, shownKobo - 100]) {
      start.mockResolvedValue(issued(amountKobo));
      await expect(adapter().start()).resolves.toMatchObject({
        kind: 'pin',
        amountKobo,
      });
    }
  });
});
