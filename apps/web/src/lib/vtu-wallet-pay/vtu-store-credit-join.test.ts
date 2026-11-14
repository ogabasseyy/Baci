import { beforeEach, describe, expect, it, vi } from 'vitest';
import { answerStoreCreditJoin } from './vtu-store-credit-join';

vi.mock('server-only', () => ({}));

const OP = '11111111-1111-4111-8111-111111111111';
const TXN = '33333333-3333-4333-8333-333333333333';
const runtime = {
  merchantId: 'm',
  businessId: 'b',
  configuration: { integrationId: 'i', environment: 'staging' },
};
const deps = (state: string | null, status = 'pending', closes = true) => ({
  readPurchase: vi.fn(async () => ({
    piggyvestPaid: true,
    amount: 1000,
    status,
    merchantId: 'm',
    customerId: 'c',
  })),
  readRecoveryRuntime: vi.fn(() => runtime as never),
  resolveIdentity: vi.fn(async () => ({
    merchantId: 'm',
    customerId: 'c',
    userId: 'u',
  })),
  findForPurchase: vi.fn(async () =>
    state ? { state, operationId: OP } : null
  ),
  closeUnpaid: vi.fn(async () => closes),
  issue: vi.fn(),
  pay: vi.fn(),
});
const settled = vi.fn(async () => new Response('{}', { status: 200 }));
const input = { transactionId: TXN, merchantId: 'm', customerId: 'c', settled };

beforeEach(() => vi.clearAllMocks());

describe('answerStoreCreditJoin (Codex P1 reverse join)', () => {
  it('reports a PiggyVest payment that already moved money, sending nothing', async () => {
    const d = deps('dispatched');
    const response = await answerStoreCreditJoin(input, d as never);
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      status: 'payment_pending',
      operationId: OP,
    });
    expect(d.closeUnpaid).not.toHaveBeenCalled();
    expect(d.issue).not.toHaveBeenCalled();
    expect(d.pay).not.toHaveBeenCalled();
  });

  it('releases an issued attempt and closes the purchase, so store credit starts again', async () => {
    const d = deps('issued');
    const response = await answerStoreCreditJoin(input, d as never);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'PAYMENT_NOT_COMPLETED',
    });
    expect(d.closeUnpaid).toHaveBeenCalledWith(
      expect.objectContaining({ transactionId: TXN, cancelOperationId: OP })
    );
  });

  it('closes a purchase with no live attempt (e.g. it expired)', async () => {
    const d = deps(null);
    const response = await answerStoreCreditJoin(input, d as never);
    expect(response.status).toBe(409);
    expect(d.closeUnpaid).toHaveBeenCalledWith(
      expect.not.objectContaining({ cancelOperationId: expect.anything() })
    );
  });

  it('asks for a retry when the close did not happen (the purchase is kept)', async () => {
    const d = deps('issued', 'pending', false);
    const response = await answerStoreCreditJoin(input, d as never);
    expect(response.status).toBe(503);
  });

  it('replays a purchase that is no longer pending through the plain fulfil', async () => {
    const d = deps(null, 'completed');
    const response = await answerStoreCreditJoin(input, d as never);
    expect(response.status).toBe(200);
    expect(settled).toHaveBeenCalled();
    expect(d.findForPurchase).not.toHaveBeenCalled();
  });

  it('never acts for another customer', async () => {
    const d = {
      ...deps('issued'),
      resolveIdentity: vi.fn(async () => ({
        merchantId: 'm',
        customerId: 'other',
        userId: 'u',
      })),
    };
    const response = await answerStoreCreditJoin(input, d as never);
    expect(response.status).toBe(503);
    expect(d.closeUnpaid).not.toHaveBeenCalled();
  });
});
