import { beforeEach, describe, expect, it, vi } from 'vitest';
import { answerWhileSwitchedOff } from './vtu-wallet-pay-switched-off';

vi.mock('server-only', () => ({}));

const OP = '11111111-1111-4111-8111-111111111111';
const TXN = '33333333-3333-4333-8333-333333333333';
const runtime = {
  merchantId: 'm',
  businessId: 'b',
  configuration: { integrationId: 'i', environment: 'staging' },
};
const deps = (state: string | null) => ({
  readRecoveryRuntime: vi.fn(() => runtime as never),
  resolveIdentity: vi.fn(async () => ({
    merchantId: 'm',
    customerId: 'c',
    userId: 'u',
  })),
  findForPurchase: vi.fn(async () =>
    state ? { state, operationId: OP } : null
  ),
  closeUnpaid: vi.fn(async () => true),
});
const input = {
  transactionId: TXN,
  merchantId: 'm',
  customerId: 'c',
  amountKobo: 100000,
};
const refusal = vi.fn(async () => new Response('{}', { status: 503 }));

beforeEach(() => vi.clearAllMocks());

describe('bugfix: a kept VTU purchase could not resume while switched off (Codex P1)', () => {
  it('hands back a payment that moved money, issuing nothing', async () => {
    const d = deps('dispatched');
    const response = await answerWhileSwitchedOff(d as never, input, refusal);
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      status: 'payment_pending',
      operationId: OP,
    });
    expect(refusal).not.toHaveBeenCalled();
  });

  it('bugfix: refuses a start that moved nothing, releasing and closing it (Codex P2)', async () => {
    const issued = deps('issued');
    const response = await answerWhileSwitchedOff(
      issued as never,
      input,
      refusal
    );
    expect(response.status).toBe(503);
    expect(issued.closeUnpaid).toHaveBeenCalledWith(
      expect.objectContaining({ transactionId: TXN, cancelOperationId: OP })
    );
    // No live attempt (e.g. it expired): the purchase is still closed.
    const none = deps(null);
    await answerWhileSwitchedOff(none as never, input, refusal);
    expect(none.closeUnpaid).toHaveBeenCalledWith(
      expect.not.objectContaining({ cancelOperationId: expect.anything() })
    );
  });

  it('never answers for another store or customer', async () => {
    const d = {
      ...deps('confirmed'),
      resolveIdentity: vi.fn(async () => ({
        merchantId: 'm',
        customerId: 'other',
        userId: 'u',
      })),
    };
    const response = await answerWhileSwitchedOff(d as never, input, refusal);
    expect(response.status).toBe(503);
    expect(d.findForPurchase).not.toHaveBeenCalled();
  });
});

describe('bugfix: a refused PIN proof left its issued payment open (Codex P2)', () => {
  it('releases this operation and closes the purchase, then refuses', async () => {
    const d = deps(null);
    const response = await answerWhileSwitchedOff(
      d as never,
      { ...input, operationId: OP },
      refusal
    );
    expect(d.closeUnpaid).toHaveBeenCalledWith(
      expect.objectContaining({ transactionId: TXN, cancelOperationId: OP })
    );
    expect(response.status).toBe(503);
  });
});
