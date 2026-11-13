import { imeiWalletPayApi, WALLET_PAY_TIMEOUT_MS } from './imei-wallet-pay-api';

const LOOKUP = '11111111-1111-4111-8111-111111111111';
const OP = '22222222-2222-4222-8222-222222222222';

function fakeFetch(status: number, body: unknown) {
  return jest.fn(async () => ({
    status,
    json: async () => {
      if (body instanceof Error) throw body;
      return body;
    },
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

describe('imeiWalletPayApi', () => {
  it('starts a PiggyVest wallet payment with the purchase key and no amount', async () => {
    const fetchImpl = fakeFetch(202, { status: 'payment_required' });
    const reply = await imeiWalletPayApi.start(
      { apiBaseUrl: 'https://api.test', accessToken: 'token', fetchImpl },
      {
        device: 'smartphone',
        tier: 'basic',
        imei: '356938035643809',
        idempotencyKey: OP,
      }
    );
    const request = sent(fetchImpl);
    expect(request.url).toBe('https://api.test/api/storefront/imei-check');
    expect(request.headers).toMatchObject({
      Authorization: 'Bearer token',
      'Idempotency-Key': OP,
    });
    expect(request.body).toMatchObject({
      paymentMethod: 'piggyvest_wallet',
      tier: 'basic',
    });
    expect(request.body).not.toHaveProperty('amountKobo');
    expect(reply).toEqual({
      httpStatus: 202,
      body: { status: 'payment_required' },
    });
  });

  it('sends the PIN only to the lookup PIN check', async () => {
    const fetchImpl = fakeFetch(200, { proof: 'a'.repeat(64) });
    await imeiWalletPayApi.verifyPin(
      { apiBaseUrl: 'https://api.test', accessToken: 'token', fetchImpl },
      { lookupId: LOOKUP, operationId: OP, pin: '1234' }
    );
    const request = sent(fetchImpl);
    expect(request.url).toBe(
      `https://api.test/api/storefront/imei-check/${LOOKUP}/wallet-pin`
    );
    expect(request.body).toEqual({ operationId: OP, pin: '1234' });
  });

  it('re-checks a sent payment with an empty proof', async () => {
    const fetchImpl = fakeFetch(202, { status: 'payment_pending' });
    await imeiWalletPayApi.pay(
      { apiBaseUrl: 'https://api.test', accessToken: undefined, fetchImpl },
      {
        lookupId: LOOKUP,
        operationId: OP,
        pinProof: '',
        imei: '356938035643809',
      }
    );
    const request = sent(fetchImpl);
    expect(request.url).toBe(
      `https://api.test/api/storefront/imei-check/${LOOKUP}/wallet-pay`
    );
    expect(request.body).toEqual({
      imei: '356938035643809',
      operationId: OP,
      pinProof: '',
    });
    expect(request.headers).not.toHaveProperty('Authorization');
  });

  it('answers an empty body when the reply is not JSON', async () => {
    const fetchImpl = fakeFetch(502, new Error('not json'));
    const reply = await imeiWalletPayApi.pay(
      { apiBaseUrl: 'https://api.test', accessToken: 'token', fetchImpl },
      {
        lookupId: LOOKUP,
        operationId: OP,
        pinProof: '',
        imei: '356938035643809',
      }
    );
    expect(reply).toEqual({ httpStatus: 502, body: {} });
  });
});

describe('bugfix: a hung wallet pay request held the sheet on "Paying..." (Muse review)', () => {
  it('gives up after the timeout so the sheet can show "confirming"', async () => {
    jest.useFakeTimers();
    const fetchImpl = jest.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new Error('aborted'))
          );
        })
    ) as unknown as typeof fetch;
    const reply = imeiWalletPayApi.pay(
      { apiBaseUrl: 'https://api.test', accessToken: 'token', fetchImpl },
      {
        lookupId: LOOKUP,
        operationId: OP,
        pinProof: '',
        imei: '356938035643809',
      }
    );
    jest.advanceTimersByTime(WALLET_PAY_TIMEOUT_MS);
    await expect(reply).rejects.toThrow('timed out');
    jest.useRealTimers();
  });
});

describe('bugfix: a body that never finished outlived the timeout (Codex P2)', () => {
  it('gives up when the headers arrive but the body stalls', async () => {
    jest.useFakeTimers();
    const fetchImpl = jest.fn(async () => ({
      status: 200,
      json: () => new Promise(() => undefined),
    })) as unknown as typeof fetch;
    const reply = imeiWalletPayApi.pay(
      { apiBaseUrl: 'https://api.test', accessToken: 'token', fetchImpl },
      {
        lookupId: LOOKUP,
        operationId: OP,
        pinProof: '',
        imei: '356938035643809',
      }
    );
    const settled = expect(reply).rejects.toThrow('timed out');
    await Promise.resolve();
    jest.advanceTimersByTime(WALLET_PAY_TIMEOUT_MS);
    await settled;
    jest.useRealTimers();
  });
});
