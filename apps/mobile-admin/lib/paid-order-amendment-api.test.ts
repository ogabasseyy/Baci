import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import type { AmendmentConfirmation } from './paid-order-amendment-api';
import { paidOrderAmendment } from './paid-order-amendment-api';

const transport = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/orders/authenticated-fetch', () => ({
  createAuthenticatedFetchText: transport,
}));
vi.mock('@/lib/api-base-url', () => ({ BASE_URL: 'https://test.invalid' }));

const amendmentId = '42778a83-0ed7-4fa5-9e1d-4ea7a085b217';
const payload: AmendmentConfirmation = {
  customerAgreed: true,
  reason: 'Customer upgrade',
  previewId: amendmentId,
  idempotencyKey: 'f58ed34e-0761-4ffe-83f4-a4cb4bdcce14',
  staffTopUp: { method: 'pos', receiptReference: 'POS-123456' },
};
const base = 'https://test.invalid/api/orders/order%2F42/amendments';

function respond(body: unknown, status = 200) {
  transport.mockResolvedValueOnce({
    response: new Response(null, { status }),
    text: JSON.stringify(body),
  });
}

describe('paid order amendment API', () => {
  beforeEach(() => vi.resetAllMocks());

  it('sends the exact confirmation through authenticated POST', async () => {
    respond({ amendmentId });
    await expect(
      paidOrderAmendment.confirm('order/42', payload)
    ).resolves.toEqual({ amendmentId });
    expect(transport).toHaveBeenCalledExactlyOnceWith(
      base,
      {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
        signal: undefined,
      },
      15_000
    );
  });

  it('preserves the HTTP status and authoritative error code', async () => {
    respond(
      { error: 'Preview the replacement again', code: 'preview_stale' },
      409
    );
    await expect(
      paidOrderAmendment.confirm('order/42', payload)
    ).rejects.toMatchObject({
      message: 'Preview the replacement again',
      status: 409,
      code: 'preview_stale',
    });
  });

  it('rejects a malformed success body', async () => {
    respond({ amendmentId: 'invalid' });
    await expect(
      paidOrderAmendment.confirm('order/42', payload)
    ).rejects.toBeInstanceOf(ZodError);
  });

  it('passes a cancellation signal to the authenticated workspace request', async () => {
    const { signal } = new AbortController();
    const data = {
      canStart: true,
      canRefund: false,
      summary: null,
      events: [],
      bankEvidence: [],
      customer: null,
    };
    respond(data);
    await expect(
      paidOrderAmendment.workspace('order/42', signal)
    ).resolves.toEqual(data);
    expect(transport).toHaveBeenCalledExactlyOnceWith(
      base,
      { method: 'GET', signal },
      15_000
    );
  });

  it('validates the action-specific bank repayment result', async () => {
    const action = {
      action: 'claim_offline_disbursement' as const,
      sourceKind: 'unapplied' as const,
      sourceId: amendmentId,
      idempotencyKey: amendmentId,
    };
    const result = { claimId: amendmentId, amountMinor: 1200, currency: 'NGN' };
    respond(result);
    await expect(
      paidOrderAmendment.finance('order/42', amendmentId, action)
    ).resolves.toEqual(result);
  });

  it('validates the bank repayment verification result', async () => {
    const action = {
      action: 'record_offline_refund' as const,
      claimId: amendmentId,
      evidenceId: amendmentId,
      idempotencyKey: amendmentId,
    };
    const result = {
      claimId: amendmentId,
      outcome: 'verified' as const,
      transactionId: null,
    };
    respond(result);
    await expect(
      paidOrderAmendment.finance('order/42', amendmentId, action)
    ).resolves.toEqual(result);
  });

  it('propagates the original transport failure for confirmation recovery', async () => {
    const error = new Error('Response lost after dispatch');
    transport.mockRejectedValueOnce(error);
    await expect(paidOrderAmendment.confirm('order/42', payload)).rejects.toBe(
      error
    );
  });
});
