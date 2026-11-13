import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runVtuWalletPayStep } from './run-vtu-wallet-pay-step';

vi.mock('server-only', () => ({}));

const TXN = '33333333-3333-4333-8333-333333333333';
const OP = '11111111-1111-4111-8111-111111111111';
const TOKEN = '22222222-2222-4222-8222-222222222222';
const PROOF = 'a'.repeat(64);
const runtime: Record<string, string> = {
  merchantId: 'merchant-1',
  integrationId: 'integration-1',
  environment: 'staging',
};
const identity = {
  merchantId: 'merchant-1',
  customerId: 'customer-1',
  userId: 'user-1',
};
const delivery = {
  claim: vi.fn(),
  finish: vi.fn(),
  refund: vi.fn(),
  deliveryState: vi.fn(),
};
const deps = {
  readPurchase: vi.fn(),
  readRuntime: vi.fn(),
  readRecoveryRuntime: vi.fn(),
  resolveIdentity: vi.fn(),
  findForPurchase: vi.fn(),
  issue: vi.fn(),
  check: vi.fn(),
  pay: vi.fn(),
  delivery: () => delivery,
};
const fulfil = vi.fn();
const base = {
  transactionId: TXN,
  merchantId: 'merchant-1',
  customerId: 'customer-1',
  fulfil,
};
const json = async (response: Response) => ({
  status: response.status,
  body: await response.json(),
});

vi.mock('@/lib/piggyvest/wallet-pay-scope', () => ({
  walletPayScope: () => ({ scope: true }),
}));

beforeEach(() => {
  vi.resetAllMocks();
  deps.readPurchase.mockResolvedValue({ piggyvestPaid: true, amount: 1000 });
  deps.readRuntime.mockReturnValue(runtime);
  deps.readRecoveryRuntime.mockReturnValue(runtime);
  deps.resolveIdentity.mockResolvedValue(identity);
  deps.findForPurchase.mockResolvedValue(null);
  deps.check.mockResolvedValue({
    purpose: 'vtu',
    purchaseRef: TXN,
    amountKobo: 100000,
  });
  delivery.refund.mockResolvedValue('pending');
});

describe('runVtuWalletPayStep: start', () => {
  it('issues a payment of exactly the purchase amount, charging nothing', async () => {
    deps.issue.mockResolvedValue({
      status: 'issued',
      operationId: OP,
      amountKobo: 100000,
      expiresAt: 'soon',
    });
    const answer = await json(await runVtuWalletPayStep(base, deps));
    expect(answer).toEqual({
      status: 202,
      body: {
        status: 'payment_required',
        operationId: OP,
        transactionId: TXN,
        amountKobo: 100000,
        expiresAt: 'soon',
      },
    });
    expect(deps.issue).toHaveBeenCalledWith(
      expect.objectContaining({
        request: { purpose: 'vtu', purchaseRef: TXN, amountKobo: 100000 },
      })
    );
    expect(deps.pay).not.toHaveBeenCalled();
  });

  it('reports a payment that already moved money instead of issuing another', async () => {
    deps.findForPurchase.mockResolvedValue({
      operationId: OP,
      state: 'confirmed',
    });
    const answer = await json(await runVtuWalletPayStep(base, deps));
    expect(answer.body).toMatchObject({
      status: 'payment_pending',
      operationId: OP,
    });
    expect(deps.issue).not.toHaveBeenCalled();
  });

  it('answers 503 and issues nothing while wallet pay is switched off', async () => {
    deps.readRuntime.mockReturnValue(null);
    const answer = await json(await runVtuWalletPayStep(base, deps));
    expect(answer).toMatchObject({
      status: 503,
      body: { code: 'PIGGYVEST_PAY_UNAVAILABLE' },
    });
    expect(deps.issue).not.toHaveBeenCalled();
  });

  it('refuses another merchant and a customer whose PiggyVest wallet is not this one', async () => {
    deps.readRuntime.mockReturnValue({ ...runtime, merchantId: 'merchant-2' });
    expect((await runVtuWalletPayStep(base, deps)).status).toBe(409);
    deps.readRuntime.mockReturnValue(runtime);
    deps.resolveIdentity.mockResolvedValue({
      ...identity,
      customerId: 'other',
    });
    expect(await json(await runVtuWalletPayStep(base, deps))).toMatchObject({
      status: 409,
      body: { code: 'PIGGYVEST_WALLET_NOT_READY' },
    });
    expect(deps.issue).not.toHaveBeenCalled();
  });
});

describe('runVtuWalletPayStep: only PiggyVest-paid purchases', () => {
  it('never charges the PiggyVest wallet for a store credit purchase', async () => {
    deps.readPurchase.mockResolvedValue({ piggyvestPaid: false, amount: 1000 });
    expect(await json(await runVtuWalletPayStep(base, deps))).toMatchObject({
      status: 409,
      body: { code: 'PAYMENT_METHOD_MISMATCH' },
    });
    expect(
      await json(
        await runVtuWalletPayStep(
          { ...base, operationId: OP, pinProof: PROOF },
          deps
        )
      )
    ).toMatchObject({ status: 409 });
    expect(deps.issue).not.toHaveBeenCalled();
    expect(deps.pay).not.toHaveBeenCalled();
  });

  it('refuses a purchase the caller can not see', async () => {
    deps.readPurchase.mockResolvedValue(null);
    expect((await runVtuWalletPayStep(base, deps)).status).toBe(409);
    expect(deps.issue).not.toHaveBeenCalled();
  });
});

describe('runVtuWalletPayStep: pay', () => {
  const paying = { ...base, operationId: OP, pinProof: PROOF };

  it('moves nothing for a payment of another purchase or amount', async () => {
    deps.check.mockResolvedValue({
      purpose: 'vtu',
      purchaseRef: TXN,
      amountKobo: 99900,
    });
    expect(await json(await runVtuWalletPayStep(paying, deps))).toMatchObject({
      status: 409,
      body: { code: 'PAYMENT_OPERATION_INVALID' },
    });
    expect(deps.pay).not.toHaveBeenCalled();
  });

  it('answers a short wallet without vending', async () => {
    deps.pay.mockResolvedValue({ status: 'insufficient' });
    expect(await json(await runVtuWalletPayStep(paying, deps))).toMatchObject({
      status: 409,
      body: { code: 'INSUFFICIENT_FUNDS' },
    });
    expect(fulfil).not.toHaveBeenCalled();
  });

  it('vends once after the payment is confirmed', async () => {
    deps.pay.mockResolvedValue({ status: 'confirmed' });
    delivery.claim.mockResolvedValue({
      status: 'claimed',
      purpose: 'vtu',
      purchaseRef: TXN,
      amountKobo: 100000,
      claimToken: TOKEN,
    });
    delivery.finish.mockResolvedValue('fulfilled');
    fulfil.mockResolvedValue({
      status: 'successful',
      amount: 1000,
      reference: 'VTU-1',
    });
    const answer = await json(await runVtuWalletPayStep(paying, deps));
    expect(answer).toMatchObject({
      status: 200,
      body: { status: 'successful' },
    });
    expect(fulfil).toHaveBeenCalledTimes(1);
    expect(fulfil).toHaveBeenCalledWith(true);
  });

  it('says the money goes back to the PiggyVest wallet when the vend fails', async () => {
    deps.pay.mockResolvedValue({ status: 'confirmed' });
    delivery.claim.mockResolvedValue({
      status: 'claimed',
      purpose: 'vtu',
      purchaseRef: TXN,
      amountKobo: 100000,
      claimToken: TOKEN,
    });
    delivery.finish.mockResolvedValue('refund_owed');
    fulfil.mockResolvedValue({
      status: 'failed',
      amount: 1000,
      reference: 'VTU-1',
      error: 'Vend failed',
    });
    expect(await json(await runVtuWalletPayStep(paying, deps))).toMatchObject({
      status: 400,
      body: { refund: 'piggyvest_wallet' },
    });
    expect(delivery.refund).toHaveBeenCalledTimes(1);
  });

  it('re-checks a sent payment with wallet pay switched off (never strands money)', async () => {
    deps.readRuntime.mockReturnValue(null);
    deps.pay.mockResolvedValue({ status: 'pending' });
    const answer = await json(
      await runVtuWalletPayStep({ ...paying, pinProof: '' }, deps)
    );
    expect(answer).toMatchObject({
      status: 202,
      body: { status: 'payment_pending' },
    });
    expect(deps.pay).toHaveBeenCalledWith(
      expect.objectContaining({ pinProof: '' })
    );
  });

  it('refuses a new PIN proof while switched off', async () => {
    deps.readRuntime.mockReturnValue(null);
    expect((await runVtuWalletPayStep(paying, deps)).status).toBe(503);
    expect(deps.pay).not.toHaveBeenCalled();
  });
});
