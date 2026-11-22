import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  drainPaystackAmendmentRefunds,
  routePaystackAmendmentRefund,
} from './paystack-amendment-refund';

const mocks = vi.hoisted(() => ({ request: vi.fn(), list: vi.fn() }));
vi.mock('@/lib/paystack-request', () => ({ paystackRequest: mocks.request }));
vi.mock('@/lib/orders/list-paystack-refunds', () => ({
  listPaystackRefunds: mocks.list,
}));

const attempt = '4d292e5f-95ce-401c-b3e1-06499a3fcea6';
const reference = `BAC-AMEND-${attempt}`;
const captureReference = 'FIXTURE-CAPTURE';
const evidence = {
  reference,
  id: '9807199254740997',
  transaction: '9807199254740993',
  integration: '987',
  amount: 5_000_000,
  currency: 'NGN',
  domain: 'test',
  status: 'processed',
};
const claim = {
  submit: true,
  reference,
  captureReference,
  captureId: evidence.transaction,
  amountMinor: evidence.amount,
  integrationId: evidence.integration,
  domain: 'test',
};

function fixture() {
  const rpc = vi.fn();
  return { rpc, database: { rpc } as unknown as Pick<SupabaseClient, 'rpc'> };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('PAYSTACK_SECRET_KEY', 'sk_test_synthetic');
  vi.stubEnv('PAID_ORDER_AMENDMENT_PAYSTACK_INTEGRATION_ID', '987');
});
afterEach(() => vi.unstubAllEnvs());

describe('signed amendment refund routing', () => {
  it('acknowledges an unknown explicit reference but retries a failed lookup', async () => {
    const { rpc, database } = fixture();
    rpc
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'Unavailable' } });

    await expect(
      routePaystackAmendmentRefund(database, { refund_reference: reference })
    ).resolves.toBe('ignored');
    await expect(
      routePaystackAmendmentRefund(database, { refund_reference: reference })
    ).resolves.toBe('retry');
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('uses the refund reference from an event before a provider ID is recorded', async () => {
    const { rpc, database } = fixture();
    rpc
      .mockResolvedValueOnce({ data: reference })
      .mockResolvedValueOnce({ data: 'processed' });
    mocks.request.mockResolvedValue({ success: true, data: [evidence] });
    expect(
      await routePaystackAmendmentRefund(database, {
        refund_reference: reference,
        transaction_reference: captureReference,
      })
    ).toBe('recorded');
    expect(rpc).toHaveBeenNthCalledWith(1, 'find_paid_order_amendment_refund', {
      p_reference: reference,
      p_provider_id: null,
      p_capture_reference: captureReference,
    });
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      'record_paid_order_amendment_refund',
      {
        p_reference: reference,
        p_evidence: expect.objectContaining({
          id: evidence.id,
          transactionId: evidence.transaction,
        }),
      }
    );
  });

  it('uses a capture-only event to look up the operation, preserving a provider mismatch for retry', async () => {
    const { rpc, database } = fixture();
    rpc.mockResolvedValueOnce({ data: reference });
    mocks.request.mockResolvedValue({
      success: true,
      data: [{ ...evidence, reference: 'another-refund' }],
    });
    expect(
      await routePaystackAmendmentRefund(database, {
        transaction_reference: captureReference,
      })
    ).toBe('retry');
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});

describe('amendment refund worker', () => {
  it('records provider acceptance after a lost response and polls without a second submission', async () => {
    const { rpc, database } = fixture();
    rpc.mockImplementation(async (name) => {
      if (name === 'list_due_paid_order_amendment_refunds')
        return { data: [attempt] };
      if (name === 'claim_paid_order_amendment_refund') return { data: claim };
      if (name === 'authorize_paid_order_amendment_refund_dispatch')
        return { data: true };
      return { data: 'processed' };
    });
    mocks.list.mockResolvedValue([]);
    mocks.request
      .mockResolvedValueOnce({ success: false, code: 'NETWORK_ERROR' })
      .mockResolvedValueOnce({ success: false, code: 'HTTP_404' })
      .mockResolvedValueOnce({ success: true, data: [evidence] });

    await drainPaystackAmendmentRefunds(database, Date.now() + 60_000);
    rpc.mockImplementation(async (name) => {
      if (name === 'list_due_paid_order_amendment_refunds')
        return { data: [attempt] };
      if (name === 'claim_paid_order_amendment_refund')
        return { data: { ...claim, submit: false } };
      return { data: 'processed' };
    });
    await drainPaystackAmendmentRefunds(database, Date.now() + 60_000);
    expect(mocks.request).toHaveBeenCalledTimes(3);
    expect(
      mocks.request.mock.calls.filter(([url]) => url === '/refund')
    ).toHaveLength(1);
    expect(mocks.request).toHaveBeenCalledWith(
      '/refund',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          transaction: captureReference,
          amount: 5_000_000,
          reference,
        }),
      })
    );
    expect(rpc).toHaveBeenCalledWith(
      'record_paid_order_amendment_refund',
      expect.anything()
    );
  });

  it('keeps preflight failure separate from dispatch and continues after a finance error', async () => {
    const { rpc, database } = fixture();
    rpc
      .mockResolvedValueOnce({ error: { code: 'XX000' } })
      .mockResolvedValueOnce({ data: [attempt] })
      .mockResolvedValueOnce({ data: claim });
    mocks.list.mockRejectedValue(new Error('Synthetic history timeout'));
    await drainPaystackAmendmentRefunds(database, Date.now() + 60_000);
    expect(mocks.list).toHaveBeenCalledOnce();
    expect(mocks.request).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalledWith(
      'authorize_paid_order_amendment_refund_dispatch',
      expect.anything()
    );
  });

  it('keeps a queued refund unsent under a different configured integration', async () => {
    vi.stubEnv('PAID_ORDER_AMENDMENT_PAYSTACK_INTEGRATION_ID', '999');
    const { rpc, database } = fixture();
    rpc
      .mockResolvedValueOnce({ data: 0 })
      .mockResolvedValueOnce({ data: [attempt] })
      .mockResolvedValueOnce({ data: claim });
    await drainPaystackAmendmentRefunds(database, Date.now() + 60_000);
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(3);
  });

  it('reviews competing capture history without polling or posting the unsent refund', async () => {
    const { rpc, database } = fixture();
    rpc.mockImplementation(async (name) => {
      if (name === 'list_due_paid_order_amendment_refunds')
        return { data: [attempt] };
      if (name === 'claim_paid_order_amendment_refund')
        return { data: { ...claim, submit: false, preflightReview: true } };
      return { data: true };
    });
    mocks.list
      .mockResolvedValueOnce([{ id: '786', status: 'processed' }])
      .mockResolvedValueOnce([{ id: '786', status: 'failed' }]);
    await drainPaystackAmendmentRefunds(database, Date.now() + 60_000);
    await drainPaystackAmendmentRefunds(database, Date.now() + 60_000);
    expect(mocks.list).toHaveBeenCalledTimes(2);
    expect(mocks.list).toHaveBeenCalledWith(
      captureReference,
      expect.objectContaining({
        expectedCapture: {
          id: claim.captureId,
          domain: 'test',
          integrationId: '987',
        },
      })
    );
    expect(rpc).toHaveBeenCalledWith(
      'resolve_paid_order_amendment_refund_preflight',
      { p_attempt: attempt, p_failed_ids: [], p_open_ids: ['786'] }
    );
    expect(rpc).toHaveBeenCalledWith(
      'resolve_paid_order_amendment_refund_preflight',
      { p_attempt: attempt, p_failed_ids: ['786'], p_open_ids: [] }
    );
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('holds the claim if provider history shows a competing refund', async () => {
    const { rpc, database } = fixture();
    rpc
      .mockResolvedValueOnce({ data: 0 })
      .mockResolvedValueOnce({ data: [attempt] })
      .mockResolvedValueOnce({ data: claim })
      .mockResolvedValueOnce({ data: false });
    mocks.list.mockResolvedValue([{ id: '786', status: 'processing' }]);
    await drainPaystackAmendmentRefunds(database, Date.now() + 60_000);
    expect(rpc).toHaveBeenCalledWith(
      'authorize_paid_order_amendment_refund_dispatch',
      { p_attempt: attempt, p_clear: false, p_open_ids: ['786'] }
    );
    expect(mocks.request).not.toHaveBeenCalled();
  });
});
