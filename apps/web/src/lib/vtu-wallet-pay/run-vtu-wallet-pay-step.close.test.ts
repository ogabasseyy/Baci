import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runVtuWalletPayStep } from './run-vtu-wallet-pay-step';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/piggyvest/wallet-pay-scope', () => ({
  walletPayScope: () => ({ scope: true }),
}));

const TXN = '33333333-3333-4333-8333-333333333333';
const OP = '11111111-1111-4111-8111-111111111111';
const runtime = {
  merchantId: 'merchant-1',
  integrationId: 'integration-1',
  environment: 'staging',
};
const deps = {
  readPurchase: vi.fn(),
  readRuntime: vi.fn(() => runtime as never),
  readRecoveryRuntime: vi.fn(() => runtime as never),
  resolveIdentity: vi.fn(async () => ({
    merchantId: 'merchant-1',
    customerId: 'customer-1',
    userId: 'user-1',
  })),
  findForPurchase: vi.fn(async () => null),
  issue: vi.fn(),
  check: vi.fn(async () => ({
    state: 'issued',
    purpose: 'vtu',
    purchaseRef: TXN,
    amountKobo: 100000,
  })),
  pay: vi.fn(),
  closeUnpaid: vi.fn(async () => true),
  closeUnissued: vi.fn(async () => true),
  delivery: vi.fn(),
};
const base = {
  transactionId: TXN,
  merchantId: 'merchant-1',
  customerId: 'customer-1',
  fulfil: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  deps.readPurchase.mockResolvedValue({
    piggyvestPaid: true,
    amount: 1000,
    status: 'pending',
  });
});

describe('bugfix: an unpaid PiggyVest purchase blocked a store credit retry (Codex P2)', () => {
  it.each([
    'insufficient',
    'released',
    'expired',
  ])('closes the purchase when the payment ends %s', async (status) => {
    deps.pay.mockResolvedValue({ status });
    const response = await runVtuWalletPayStep(
      { ...base, operationId: OP, pinProof: 'a'.repeat(64) },
      deps as never
    );
    expect(response.status).toBe(409);
    expect(deps.closeUnpaid).toHaveBeenCalledWith(
      expect.objectContaining({ transactionId: TXN })
    );
  });

  it('keeps the purchase while the payment may still complete', async () => {
    deps.pay.mockResolvedValue({ status: 'pending' });
    await runVtuWalletPayStep(
      { ...base, operationId: OP, pinProof: 'a'.repeat(64) },
      deps as never
    );
    expect(deps.closeUnpaid).not.toHaveBeenCalled();
  });

  it('bugfix: answers pending (the key stays) when the close fails, never the definitive unpaid answer (Codex P1)', async () => {
    deps.pay.mockResolvedValue({ status: 'insufficient' });
    deps.closeUnpaid.mockRejectedValueOnce(new Error('db down'));
    const response = await runVtuWalletPayStep(
      { ...base, operationId: OP, pinProof: 'a'.repeat(64) },
      deps as never
    );
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      status: 'payment_pending',
    });
    // Once the close goes through, the re-check answers the unpaid outcome.
    deps.closeUnpaid.mockResolvedValueOnce(true);
    const again = await runVtuWalletPayStep(
      { ...base, operationId: OP, pinProof: 'a'.repeat(64) },
      deps as never
    );
    expect(again.status).toBe(409);
  });

  it('never issues a payment for a purchase that is no longer pending', async () => {
    deps.readPurchase.mockResolvedValue({
      piggyvestPaid: true,
      amount: 1000,
      status: 'failed',
    });
    const response = await runVtuWalletPayStep(base, deps as never);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'PAYMENT_NOT_COMPLETED',
    });
    expect(deps.issue).not.toHaveBeenCalled();
  });
});

describe('bugfix: an expired, never-sent payment was re-checked forever (Codex P2)', () => {
  const recheck = { ...base, operationId: OP, pinProof: '' };

  it('ends the re-check and closes the purchase once the issued payment expired', async () => {
    deps.findForPurchase.mockResolvedValueOnce(null);
    const response = await runVtuWalletPayStep(recheck, deps as never);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'PAYMENT_NOT_COMPLETED',
    });
    expect(deps.closeUnpaid).toHaveBeenCalled();
    expect(deps.pay).not.toHaveBeenCalled();
  });

  it('keeps confirming while the issued payment is still the live attempt', async () => {
    deps.findForPurchase.mockResolvedValueOnce({
      operationId: OP,
      state: 'issued',
    } as never);
    const response = await runVtuWalletPayStep(recheck, deps as never);
    expect(response.status).toBe(202);
    expect(deps.closeUnpaid).not.toHaveBeenCalled();
  });
});

describe('bugfix: the purchase read did not bind merchant and customer (Muse)', () => {
  it('refuses a purchase of another merchant or customer before any payment', async () => {
    for (const other of [
      { merchantId: 'merchant-2', customerId: 'customer-1' },
      { merchantId: 'merchant-1', customerId: 'customer-2' },
    ]) {
      deps.readPurchase.mockResolvedValueOnce({
        piggyvestPaid: true,
        amount: 1000,
        status: 'pending',
        ...other,
      });
      const response = await runVtuWalletPayStep(base, deps as never);
      await expect(response.json()).resolves.toMatchObject({
        code: 'PAYMENT_METHOD_MISMATCH',
      });
    }
    expect(deps.issue).not.toHaveBeenCalled();
  });
});

describe('bugfix: an unavailable issue left the prepared purchase live (Codex P2)', () => {
  it('closes the purchase when no payment could be issued', async () => {
    deps.issue.mockResolvedValueOnce({ status: 'unavailable' });
    const response = await runVtuWalletPayStep(base, deps as never);
    expect(response.status).toBe(503);
    expect(deps.closeUnpaid).toHaveBeenCalledWith(
      expect.objectContaining({ transactionId: TXN })
    );
  });

  it('cancels an issued payment when the sheet closed before any PIN', async () => {
    const response = await runVtuWalletPayStep(
      { ...base, operationId: OP, cancel: true },
      deps as never
    );
    await expect(response.json()).resolves.toMatchObject({
      status: 'cancelled',
    });
    expect(deps.closeUnpaid).toHaveBeenCalledWith(
      expect.objectContaining({ cancelOperationId: OP })
    );
    expect(deps.pay).not.toHaveBeenCalled();
  });
});

describe('bugfix: a start refused before any payment left its purchase live (Codex P2)', () => {
  it('closes the purchase when the PiggyVest wallet is not ready', async () => {
    deps.resolveIdentity.mockResolvedValueOnce(null as never);
    const response = await runVtuWalletPayStep(base, deps as never);
    await expect(response.json()).resolves.toMatchObject({
      code: 'PIGGYVEST_WALLET_NOT_READY',
    });
    expect(deps.closeUnissued).toHaveBeenCalledWith(TXN, 'merchant-1');
  });

  it('closes the purchase when wallet pay is off', async () => {
    deps.readRuntime.mockReturnValueOnce(null as never);
    const response = await runVtuWalletPayStep(base, deps as never);
    expect(response.status).toBe(503);
    expect(deps.closeUnissued).toHaveBeenCalledWith(TXN, 'merchant-1');
  });

  it('never closes on a re-check or payment refusal', async () => {
    deps.resolveIdentity.mockResolvedValueOnce(null as never);
    await runVtuWalletPayStep(
      { ...base, operationId: OP, pinProof: 'a'.repeat(64) },
      deps as never
    );
    expect(deps.closeUnissued).not.toHaveBeenCalled();
  });
});

describe('a cancel while wallet pay is switched off (Codex P2 4567616052)', () => {
  it('answers the cancellation itself, so the app forgets the key', async () => {
    // A cancel carries no PIN proof: it runs on the recovery runtime like a
    // re-check, never the switched-off refusal.
    deps.readRuntime.mockReturnValue(null as never);
    const response = await runVtuWalletPayStep(
      { ...base, operationId: OP, cancel: true },
      deps as never
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: 'cancelled',
    });
    expect(deps.closeUnpaid).toHaveBeenCalledWith(
      expect.objectContaining({ cancelOperationId: OP })
    );
    deps.readRuntime.mockReturnValue(runtime as never);
  });
});

describe('bugfix: a misconfigured recovery runtime failed a re-check with a 500 (Muse)', () => {
  it('answers unavailable (the key stays) instead of throwing', async () => {
    deps.readRuntime.mockReturnValue(null as never);
    deps.readRecoveryRuntime.mockImplementationOnce(() => {
      throw new Error('misconfigured');
    });
    const response = await runVtuWalletPayStep(
      { ...base, operationId: OP },
      deps as never
    );
    expect(response.status).toBe(503);
    expect(deps.closeUnissued).not.toHaveBeenCalled();
    expect(deps.pay).not.toHaveBeenCalled();
    deps.readRuntime.mockReturnValue(runtime as never);
  });
});
