import { vtuWalletPayApi } from '@/lib/wallet-pay/vtu-wallet-pay-api';
import {
  createVtuWalletPayAdapter,
  vtuPayAnswer,
} from './vtu-wallet-pay-adapter';

jest.mock('@/lib/wallet-pay/vtu-wallet-pay-api', () => ({
  vtuWalletPayApi: { start: jest.fn(), verifyPin: jest.fn(), pay: jest.fn() },
}));

const api = vtuWalletPayApi as unknown as Record<
  'start' | 'verifyPin' | 'pay',
  jest.Mock
>;
const TXN = '33333333-3333-4333-8333-333333333333';
const OP = '11111111-1111-4111-8111-111111111111';
const PROOF = 'a'.repeat(64);
const reply = (httpStatus: number, body: Record<string, unknown>) => ({
  httpStatus,
  body,
});
const request = {
  amount: 500,
  phoneNumber: '08031234567',
  type: 'airtime' as const,
  walletAmount: 500,
};

function adapter() {
  return createVtuWalletPayAdapter({
    connection: { apiBaseUrl: 'https://api.test', accessToken: 'token' },
    request,
    idempotencyKey: 'key',
  });
}

async function started() {
  api.start.mockResolvedValue(
    reply(202, {
      status: 'payment_required',
      transactionId: TXN,
      operationId: OP,
      amountKobo: 50_000,
    })
  );
  const pay = adapter();
  await expect(pay.start()).resolves.toEqual({
    kind: 'pin',
    operationId: OP,
    amountKobo: 50_000,
  });
  return pay;
}

beforeEach(() => jest.resetAllMocks());

describe('createVtuWalletPayAdapter (mocked PiggyVest replies)', () => {
  it('asks for the PIN for the purchase the server prepared', async () => {
    const pay = await started();
    api.verifyPin.mockResolvedValue(reply(200, { proof: PROOF }));
    await expect(pay.verifyPin(OP, '1234')).resolves.toEqual({
      kind: 'proof',
      proof: PROOF,
    });
    expect(api.verifyPin).toHaveBeenCalledWith(expect.anything(), {
      transactionId: TXN,
      operationId: OP,
      pin: '1234',
    });
  });

  it('keeps the customer on the PIN step after a wrong PIN', async () => {
    const pay = await started();
    api.verifyPin.mockResolvedValue(
      reply(401, { code: 'PIN_INCORRECT', attemptsRemaining: 1 })
    );
    await expect(pay.verifyPin(OP, '0000')).resolves.toEqual({
      kind: 'retry',
      message: 'That PIN is not right. 1 try left.',
    });
    expect(api.pay).not.toHaveBeenCalled();
  });

  it('delivers a vended purchase once the payment is confirmed', async () => {
    const pay = await started();
    api.pay.mockResolvedValue(
      reply(200, { status: 'successful', reference: 'R', amount: 500 })
    );
    await expect(pay.pay(OP, PROOF)).resolves.toEqual({
      kind: 'delivered',
      result: { amount: 500, reference: 'R', voucherPin: undefined },
    });
    expect(api.pay).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        operationId: OP,
        pinProof: PROOF,
        idempotencyKey: 'key',
      })
    );
  });

  it('checks on a payment already sent instead of asking for a PIN', async () => {
    api.start.mockResolvedValue(
      reply(202, {
        status: 'payment_pending',
        transactionId: TXN,
        operationId: OP,
        amountKobo: 50_000,
      })
    );
    await expect(adapter().start()).resolves.toMatchObject({ kind: 'recheck' });
  });

  it('never charges for a store credit purchase', async () => {
    api.start.mockResolvedValue(
      reply(409, { code: 'PAYMENT_METHOD_MISMATCH' })
    );
    await expect(adapter().start()).resolves.toEqual({
      kind: 'outcome',
      outcome: { kind: 'failed' },
    });
  });
});

describe('vtuPayAnswer', () => {
  it('reports a refund when the vend failed', () => {
    expect(
      vtuPayAnswer(reply(400, { error: 'x', refund: 'piggyvest_wallet' }))
    ).toEqual({
      kind: 'outcome',
      outcome: { kind: 'refunded' },
    });
  });

  it('keeps confirming while the vend is processing, never failed', () => {
    expect(
      vtuPayAnswer(reply(202, { status: 'processing', reference: 'R' }))
    ).toMatchObject({
      outcome: { kind: 'pending' },
    });
    expect(
      vtuPayAnswer(reply(503, { code: 'PAYMENT_STATUS_UNKNOWN' }))
    ).toMatchObject({
      outcome: { kind: 'pending' },
    });
  });

  it('never says nothing was taken after a lost session on a re-check', () => {
    expect(vtuPayAnswer(reply(401, {}))).toEqual({
      kind: 'outcome',
      outcome: { kind: 'sign_in', maybePaid: true },
    });
  });

  it('asks for the PIN again when the proof was refused', () => {
    expect(
      vtuPayAnswer(reply(403, { code: 'PIN_PROOF_REFUSED' }))
    ).toMatchObject({ kind: 'pin_again' });
  });
});

describe('bugfix: a PIN check without a started payment said failed (Muse)', () => {
  it('asks to try again instead', async () => {
    await expect(adapter().verifyPin(OP, '1234')).resolves.toEqual({
      kind: 'outcome',
      outcome: { kind: 'not_started' },
    });
    expect(api.verifyPin).not.toHaveBeenCalled();
  });
});

describe('bugfix: an ambiguous 5xx start forgot its key (Codex P1, as IMEI)', () => {
  it('answers not started (key kept) for a server error with no known code', async () => {
    api.start.mockResolvedValue(reply(500, { code: 'INTERNAL_ERROR' }));
    await expect(adapter().start()).resolves.toEqual({
      kind: 'outcome',
      outcome: { kind: 'not_started' },
    });
  });
});

describe('bugfix: success reported the request amount (Muse low)', () => {
  it('reports the issued payment amount when the answer carries none', async () => {
    const a = await started();
    api.pay.mockResolvedValue(
      reply(200, { status: 'successful', reference: 'REF' })
    );
    await expect(a.pay(OP, PROOF)).resolves.toMatchObject({
      kind: 'delivered',
      result: { amount: 500, reference: 'REF' },
    });
  });
});
