import { IMEI_SERVICE_TIERS } from '@baci/shared/imei';
import { imeiWalletPayApi } from '@/lib/wallet-pay/imei-wallet-pay-api';
import {
  createImeiWalletPayAdapter,
  imeiPayAnswer,
} from './imei-wallet-pay-adapter';

jest.mock('@/lib/wallet-pay/imei-wallet-pay-api', () => ({
  imeiWalletPayApi: { start: jest.fn(), verifyPin: jest.fn(), pay: jest.fn() },
}));

const api = imeiWalletPayApi as unknown as Record<
  'start' | 'verifyPin' | 'pay',
  jest.Mock
>;
const LOOKUP = '11111111-1111-4111-8111-111111111111';
const OP = '22222222-2222-4222-8222-222222222222';
const PROOF = 'a'.repeat(64);
const PRICE_KOBO = Math.round(IMEI_SERVICE_TIERS.basic.price * 100);
const RESULT = {
  imei: '356938035643809',
  device: 'iPhone 15',
  modelNumber: 'A3090',
  status: 'Clean',
  icloud: 'Off',
  icloudLock: 'Off',
  simLock: 'Unlocked',
  blacklistStatus: 'Clean',
  carrier: 'Unlocked',
  deviceImage: '',
  score: 100,
  deviceType: 'apple',
  verdict: 'Safe to buy',
  verdictType: 'safe',
};
const reply = (httpStatus: number, body: Record<string, unknown>) => ({
  httpStatus,
  body,
});

function adapter() {
  return createImeiWalletPayAdapter({
    connection: { apiBaseUrl: 'https://api.test', accessToken: 'token' },
    device: 'smartphone',
    tier: 'basic',
    imei: '356938035643809',
    idempotencyKey: OP,
  });
}

async function started() {
  api.start.mockResolvedValue(
    reply(202, {
      status: 'payment_required',
      lookupId: LOOKUP,
      operationId: OP,
      amountKobo: PRICE_KOBO,
    })
  );
  const pay = adapter();
  await expect(pay.start()).resolves.toEqual({
    kind: 'pin',
    operationId: OP,
    amountKobo: PRICE_KOBO,
  });
  return pay;
}

beforeEach(() => jest.resetAllMocks());

describe('createImeiWalletPayAdapter (mocked PiggyVest replies)', () => {
  it('asks for the PIN once the server issues the payment', async () => {
    await started();
  });

  it('checks on a payment already sent instead of paying again', async () => {
    api.start.mockResolvedValue(
      reply(202, {
        status: 'payment_pending',
        lookupId: LOOKUP,
        operationId: OP,
        amountKobo: PRICE_KOBO,
      })
    );
    await expect(adapter().start()).resolves.toMatchObject({ kind: 'recheck' });
  });

  it('keeps the customer on the PIN step after a wrong PIN, with tries left', async () => {
    const pay = await started();
    api.verifyPin.mockResolvedValue(
      reply(401, { code: 'PIN_INCORRECT', attemptsRemaining: 2 })
    );
    await expect(pay.verifyPin(OP, '0000')).resolves.toEqual({
      kind: 'retry',
      message: 'That PIN is not right. 2 tries left.',
    });
    expect(api.pay).not.toHaveBeenCalled();
  });

  it('returns the single-use proof for the right PIN', async () => {
    const pay = await started();
    api.verifyPin.mockResolvedValue(
      reply(200, { proof: PROOF, expiresAt: 'x' })
    );
    await expect(pay.verifyPin(OP, '1234')).resolves.toEqual({
      kind: 'proof',
      proof: PROOF,
    });
    expect(api.verifyPin).toHaveBeenCalledWith(expect.anything(), {
      lookupId: LOOKUP,
      operationId: OP,
      pin: '1234',
    });
  });

  it('sends a locked or missing PIN to a calm outcome', async () => {
    const pay = await started();
    api.verifyPin.mockResolvedValueOnce(reply(423, { code: 'PIN_LOCKED' }));
    await expect(pay.verifyPin(OP, '1234')).resolves.toMatchObject({
      outcome: { kind: 'pin_locked' },
    });
    api.verifyPin.mockResolvedValueOnce(reply(409, { code: 'PIN_NOT_SET' }));
    await expect(pay.verifyPin(OP, '1234')).resolves.toMatchObject({
      outcome: { kind: 'pin_setup' },
    });
  });

  it('delivers the check result once the payment is confirmed', async () => {
    const pay = await started();
    api.pay.mockResolvedValue(
      reply(200, {
        success: true,
        status: 'complete',
        lookupId: LOOKUP,
        data: RESULT,
      })
    );
    await expect(pay.pay(OP, PROOF)).resolves.toEqual({
      kind: 'delivered',
      result: { result: RESULT, lookupId: LOOKUP, tier: 'basic' },
    });
    expect(api.pay).toHaveBeenCalledTimes(1);
  });
});

describe('imeiPayAnswer', () => {
  it('reports a refund when the check could not be completed', () => {
    expect(
      imeiPayAnswer(
        reply(502, {
          code: 'LOOKUP_NOT_COMPLETED',
          refund: 'piggyvest_wallet',
          status: 'error',
        }),
        'basic'
      )
    ).toEqual({ kind: 'outcome', outcome: { kind: 'refunded' } });
    expect(
      imeiPayAnswer(reply(202, { status: 'payment_refunding' }), 'basic')
    ).toMatchObject({
      outcome: { kind: 'refunded' },
    });
  });

  it('treats anything unknown as still confirming, never failed', () => {
    expect(
      imeiPayAnswer(reply(202, { status: 'delivering' }), 'basic')
    ).toMatchObject({
      outcome: { kind: 'pending' },
    });
    expect(
      imeiPayAnswer(reply(503, { code: 'PAYMENT_STATUS_UNKNOWN' }), 'basic')
    ).toMatchObject({ outcome: { kind: 'pending' } });
  });

  it('asks for the PIN again when the proof was refused', () => {
    expect(
      imeiPayAnswer(reply(403, { code: 'PIN_PROOF_REFUSED' }), 'basic')
    ).toMatchObject({
      kind: 'pin_again',
    });
  });

  it('says nothing was taken when the wallet is short', () => {
    expect(
      imeiPayAnswer(reply(409, { code: 'INSUFFICIENT_FUNDS' }), 'basic')
    ).toMatchObject({
      outcome: { kind: 'insufficient' },
    });
  });
});

describe('bugfix: server error text reached the outcome card (Muse review)', () => {
  it('shows only the app wording for a refused start', async () => {
    api.start.mockResolvedValue(
      reply(400, { code: 'SOMETHING_NEW', error: 'raw server text' })
    );
    await expect(adapter().start()).resolves.toEqual({
      kind: 'outcome',
      outcome: { kind: 'failed' },
    });
  });

  it('uses the app wording for an IMEI mismatch', () => {
    const answer = imeiPayAnswer(
      reply(409, { code: 'IMEI_MISMATCH', error: 'raw server text' }),
      'basic'
    );
    expect(answer).toMatchObject({ outcome: { kind: 'failed' } });
    expect(JSON.stringify(answer)).not.toContain('raw server text');
  });
});

describe('bugfix: an unreadable PIN check answer showed a failure (Muse)', () => {
  it('lets the customer try the PIN again', async () => {
    const pay = await started();
    api.verifyPin.mockResolvedValue(reply(200, { proof: 'NOT-HEX' }));
    await expect(pay.verifyPin(OP, '1234')).resolves.toEqual({
      kind: 'retry',
      message: 'Could not check your PIN. Please try again.',
    });
    expect(api.pay).not.toHaveBeenCalled();
  });
});

describe('bugfix: a replayed start was treated as failed and forgotten (Codex P1)', () => {
  it('shows the result of a purchase that already finished', async () => {
    api.start.mockResolvedValue(
      reply(200, {
        success: true,
        status: 'complete',
        lookupId: LOOKUP,
        data: RESULT,
      })
    );
    await expect(adapter().start()).resolves.toEqual({
      kind: 'delivered',
      result: { result: RESULT, lookupId: LOOKUP, tier: 'basic' },
    });
  });

  it('reports a refund that already happened', async () => {
    api.start.mockResolvedValue(
      reply(502, {
        code: 'LOOKUP_NOT_COMPLETED',
        refund: 'piggyvest_wallet',
        lookupId: LOOKUP,
      })
    );
    await expect(adapter().start()).resolves.toEqual({
      kind: 'outcome',
      outcome: { kind: 'refunded' },
    });
  });

  it('keeps confirming while the delivery is still running', async () => {
    api.start.mockResolvedValue(
      reply(409, { code: 'IDEMPOTENT_REQUEST_IN_FLIGHT' })
    );
    await expect(adapter().start()).resolves.toEqual({
      kind: 'outcome',
      outcome: { kind: 'pending' },
    });
  });
});

describe('bugfix: a refused re-check claimed nothing was taken (Codex P2)', () => {
  it('marks a lost session or pause after a payment as maybe paid', () => {
    expect(
      imeiPayAnswer(reply(401, { code: 'UNAUTHORIZED' }), 'basic')
    ).toEqual({
      kind: 'outcome',
      outcome: { kind: 'sign_in', maybePaid: true },
    });
    expect(
      imeiPayAnswer(reply(409, { code: 'PIGGYVEST_WALLET_NOT_READY' }), 'basic')
    ).toEqual({
      kind: 'outcome',
      outcome: { kind: 'unavailable', maybePaid: true },
    });
  });
});

describe('bugfix: an unreadable accepted start showed a failure (Muse)', () => {
  it('keeps confirming instead', async () => {
    api.start.mockResolvedValue(reply(202, { status: 'payment_required' }));
    await expect(adapter().start()).resolves.toEqual({
      kind: 'outcome',
      outcome: { kind: 'pending' },
    });
  });
});

describe('bugfix: a re-check refusal claimed nothing was taken (Muse)', () => {
  it('keeps confirming when a re-check is answered with an invalid operation', () => {
    expect(
      imeiPayAnswer(
        reply(409, { code: 'PAYMENT_OPERATION_INVALID' }),
        'basic',
        true
      )
    ).toEqual({
      kind: 'outcome',
      outcome: { kind: 'pending', maybePaid: true },
    });
  });

  it('still trusts the payment record: short of money or released moved nothing', () => {
    expect(
      imeiPayAnswer(reply(409, { code: 'INSUFFICIENT_FUNDS' }), 'basic', true)
    ).toMatchObject({ outcome: { kind: 'insufficient' } });
    expect(
      imeiPayAnswer(
        reply(409, { code: 'PAYMENT_NOT_COMPLETED' }),
        'basic',
        true
      )
    ).toMatchObject({ outcome: { kind: 'not_completed' } });
  });
});

describe('bugfix: a reviewed payment stopped being checked (Codex P2)', () => {
  it('keeps the operation of a start under review and checks on it', async () => {
    api.start.mockResolvedValue(
      reply(202, {
        status: 'payment_review',
        lookupId: LOOKUP,
        operationId: OP,
        amountKobo: 30_000,
      })
    );
    await expect(adapter().start()).resolves.toEqual({
      kind: 'recheck',
      operationId: OP,
      amountKobo: 30_000,
    });
  });
});

describe('bugfix: an uppercase proof looped on try again (Muse)', () => {
  it('accepts it and sends it lowercased', async () => {
    const pay = await started();
    api.verifyPin.mockResolvedValue(reply(200, { proof: 'A'.repeat(64) }));
    await expect(pay.verifyPin(OP, '1234')).resolves.toEqual({
      kind: 'proof',
      proof: 'a'.repeat(64),
    });
  });
});

describe('bugfix: an IMEI mismatch on a re-check said nothing was taken (Muse)', () => {
  it('reports it as under review, never "nothing taken"', () => {
    expect(
      imeiPayAnswer(reply(409, { code: 'IMEI_MISMATCH' }), 'basic', true)
    ).toEqual({ kind: 'outcome', outcome: { kind: 'review' } });
    expect(
      imeiPayAnswer(reply(409, { code: 'IMEI_MISMATCH' }), 'basic')
    ).toMatchObject({
      outcome: { kind: 'failed', failedReason: 'imei_mismatch' },
    });
  });
});

describe('bugfix: an ambiguous 5xx start forgot its key (Codex P1)', () => {
  it('answers not started (key kept) for a server error with no known code', async () => {
    api.start.mockResolvedValue(reply(500, { code: 'INTERNAL_ERROR' }));
    await expect(adapter().start()).resolves.toEqual({
      kind: 'outcome',
      outcome: { kind: 'not_started' },
    });
  });

  it('still answers failed for a definite 4xx refusal', async () => {
    api.start.mockResolvedValue(reply(409, { code: 'IDEMPOTENCY_CONFLICT' }));
    await expect(adapter().start()).resolves.toMatchObject({
      outcome: { kind: 'failed' },
    });
  });
});
