import { beforeEach, describe, expect, it } from 'vitest';
import {
  createCronRequest,
  mocks,
  resetCronMocks,
  runCron,
  stuckOrder,
} from './route.test-support';

describe('GET /api/cron/alert-stuck-bnpl', () => {
  beforeEach(resetCronMocks);

  it('durably files every stuck Credit Direct order before alerting its merchant', async () => {
    mocks.limit.mockResolvedValue({
      data: [
        stuckOrder({
          id: 'order-pending',
          payment_status: 'bnpl_pending',
          notes: JSON.stringify({
            creditDirectSessionId: 'session-1',
            creditDirectTransactionId: 'transaction-1',
            creditDirectSignedAt: '2026-06-30T23:50:00.000Z',
          }),
        }),
        stuckOrder({
          id: 'order-approved',
          payment_status: 'bnpl_approved',
          total: '250000.50',
          notes: JSON.stringify({
            creditDirectSessionId: 'session-2',
          }),
        }),
        stuckOrder({
          id: 'order-plain-pending',
          payment_status: 'pending',
          notes: JSON.stringify({
            credit_directTransactionId: 'transaction-3',
            paymentRefUpdatedAt: '2026-07-01T00:01:00.000Z',
          }),
        }),
        stuckOrder({
          id: 'order-unpaid',
          payment_status: 'unpaid',
          notes: JSON.stringify({
            creditDirectTransactionId: 'transaction-4',
          }),
        }),
        stuckOrder({
          id: 'order-klump',
          payment_method: 'klump',
          notes: '{"klumpTransactionId":"klump-1"}',
        }),
      ],
      error: null,
    });

    const response = await runCron(createCronRequest());

    expect(response.status).toBe(200);
    expect(mocks.reviewInsert).toHaveBeenCalledTimes(4);
    expect(mocks.reviewInsert).toHaveBeenCalledWith({
      candidates: null,
      issue_type: 'credit_direct_confirmation_missing',
      merchant_id: 'merchant-1',
      metadata: {
        notes_evidence: {
          creditDirectSessionId: 'session-1',
          creditDirectSignedAt: '2026-06-30T23:50:00.000Z',
          creditDirectTransactionId: 'transaction-1',
          has_transaction_id_marker: true,
          parseable: true,
        },
        payment_method: 'credit_direct',
        payment_status: 'bnpl_pending',
        source: 'credit_direct_stuck_cron',
        total: 100000,
        updated_at: '2026-07-01T00:00:00.000Z',
      },
      order_id: 'order-pending',
      paystack_ref: 'transaction-1',
      reason:
        'Credit Direct order is awaiting authoritative provider confirmation',
      txn_id: null,
    });
    expect(mocks.reviewInsert).not.toHaveBeenCalledWith(
      expect.objectContaining({ order_id: 'order-klump' })
    );
    expect(mocks.reviewInsert.mock.invocationCallOrder.at(-1)).toBeLessThan(
      mocks.notifyMerchant.mock.invocationCallOrder[0]
    );
  });

  it('scans every stuck BNPL status and ages on row movement, not creation', async () => {
    await runCron(createCronRequest());

    expect(mocks.statusIn).toHaveBeenCalledWith('payment_status', [
      'bnpl_pending',
      'bnpl_approved',
      'pending',
      'unpaid',
    ]);
    expect(mocks.statusIn).toHaveBeenCalledWith('payment_method', [
      'credit_direct',
      'klump',
      'credpal',
    ]);
    expect(mocks.lt).toHaveBeenCalledWith('updated_at', expect.any(String));
    expect(mocks.statusOr).toHaveBeenCalledWith(
      expect.stringMatching(
        /^payment_status\.eq\.bnpl_approved,updated_at\.gte\./
      )
    );
  });

  it('keeps old approved BNPL orders in scope while bounding unresolved pending states', async () => {
    await runCron(createCronRequest());

    expect(mocks.statusOr).toHaveBeenCalledWith(
      expect.stringMatching(
        /^payment_status\.eq\.bnpl_approved,updated_at\.gte\./
      )
    );
  });

  it('warns that the report may be partial when the scan hits its limit', async () => {
    mocks.limit.mockResolvedValue({
      data: Array.from({ length: 500 }, (_, index) =>
        stuckOrder({ id: `order-${index}`, order_number: `ORD-${index}` })
      ),
      error: null,
    });

    const response = await runCron(createCronRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.stuckOrders).toBe(500);
    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Stuck-BNPL scan hit scan limit; report may be partial',
        scanLimit: 500,
      })
    );
  });

  it('accepts a transactions row as provider evidence for pending orders without notes', async () => {
    mocks.limit.mockResolvedValue({
      data: [
        stuckOrder({
          id: 'order-1',
          payment_status: 'unpaid',
          payment_method: 'credpal',
          notes: null,
        }),
      ],
      error: null,
    });
    mocks.transactionsIn.mockResolvedValue({
      data: [{ order_id: 'order-1', gateway: 'credpal', status: 'processing' }],
      error: null,
    });

    const response = await runCron(createCronRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.stuckOrders).toBe(1);
    expect(mocks.transactionsIn).toHaveBeenCalledWith('order_id', ['order-1']);
    expect(mocks.notifyMerchant).toHaveBeenCalledTimes(1);
  });

  it('files the provider reference from Credit Direct transaction evidence when notes have none', async () => {
    mocks.limit.mockResolvedValue({
      data: [
        stuckOrder({
          id: 'order-1',
          payment_status: 'pending',
          notes: null,
        }),
      ],
      error: null,
    });
    mocks.transactionsIn.mockResolvedValue({
      data: [
        {
          gateway: 'credit_direct',
          gateway_reference: 'credit-direct-reference-1',
          order_id: 'order-1',
          status: 'processing',
        },
      ],
      error: null,
    });

    const response = await runCron(createCronRequest());

    expect(response.status).toBe(200);
    expect(mocks.reviewInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        order_id: 'order-1',
        paystack_ref: 'credit-direct-reference-1',
      })
    );
  });
});
