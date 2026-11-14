import { vtuWalletPayApi } from './vtu-wallet-pay-api';

jest.mock('@/lib/config', () => ({ CONFIG: { MERCHANT_SLUG: 'shop' } }));

const KEY = '22222222-2222-4222-8222-222222222222';
const request = {
  amount: 500,
  phoneNumber: '08031234567',
  networkProvider: 'mtn',
  type: 'airtime' as const,
  walletAmount: 500,
};

function fakeFetch(
  status = 202,
  body: unknown = { status: 'payment_required' }
) {
  return jest.fn(async () => ({
    status,
    json: async () => body,
  })) as unknown as jest.Mock & typeof fetch;
}
const sent = (fetchImpl: jest.Mock) => {
  const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
  return {
    url,
    headers: init.headers as Record<string, string>,
    body: JSON.parse(String(init.body)) as Record<string, unknown>,
  };
};

describe('vtuWalletPayApi', () => {
  it('starts the purchase as PiggyVest-paid with the purchase key', async () => {
    const fetchImpl = fakeFetch();
    await vtuWalletPayApi.start(
      { apiBaseUrl: 'https://api.test', accessToken: 'token', fetchImpl },
      { request, idempotencyKey: KEY, expectedUserId: 'user-1' }
    );
    const call = sent(fetchImpl);
    expect(call.url).toBe('https://api.test/api/vtu/checkout/wallet-only');
    expect(call.headers['Idempotency-Key']).toBe(KEY);
    expect(call.body).toMatchObject({
      paymentMethod: 'piggyvest_wallet',
      merchantSlug: 'shop',
      expectedUserId: 'user-1',
      amount: 500,
    });
    expect(call.body).not.toHaveProperty('walletPayPinProof');
  });

  it('pays with the same purchase, key, operation and proof', async () => {
    const fetchImpl = fakeFetch(200, { status: 'successful', reference: 'R' });
    await vtuWalletPayApi.pay(
      { apiBaseUrl: 'https://api.test', accessToken: 'token', fetchImpl },
      { request, idempotencyKey: KEY, operationId: 'op', pinProof: 'proof' }
    );
    const call = sent(fetchImpl);
    expect(call.headers['Idempotency-Key']).toBe(KEY);
    expect(call.body).toMatchObject({
      walletPayOperationId: 'op',
      walletPayPinProof: 'proof',
    });
  });

  it('sends the PIN only to the PIN check', async () => {
    const fetchImpl = fakeFetch(200, { proof: 'a'.repeat(64) });
    await vtuWalletPayApi.verifyPin(
      { apiBaseUrl: 'https://api.test', accessToken: 'token', fetchImpl },
      { transactionId: 'txn', operationId: 'op', pin: '1234' }
    );
    const call = sent(fetchImpl);
    expect(call.url).toBe('https://api.test/api/vtu/checkout/wallet-pin');
    expect(call.body).toEqual({
      transactionId: 'txn',
      operationId: 'op',
      pin: '1234',
    });
    expect(call.headers).not.toHaveProperty('Idempotency-Key');
  });
});
