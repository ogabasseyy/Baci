import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { recoverUnknownPaystackRefund } from './recover-unknown-paystack-refund';

const mocks = vi.hoisted(() => ({
  fetchPaystackPaymentById: vi.fn(),
  fetchRefund: vi.fn(),
  loggerInfo: vi.fn(),
}));

vi.mock('./fetch-paystack-payment-by-id', () => ({
  fetchPaystackPaymentById: mocks.fetchPaystackPaymentById,
}));
vi.mock('./fetch-paystack-refund', () => ({
  fetchRefund: mocks.fetchRefund,
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: mocks.loggerInfo, warn: vi.fn() },
}));

function payment(id: string, orderId: string, merchantId: string) {
  return {
    amount: 100,
    gateway: 'paystack',
    gateway_reference: 'PSK-1',
    id,
    merchant_id: merchantId,
    order_id: orderId,
  };
}

function cancelledOrder(id: string) {
  return {
    cancelled_at: '2026-09-27T00:00:00Z',
    id,
    shipping_status: 'cancelled',
  };
}

// The candidate queries paginate every match in stable id order: the
// range terminal resolves one page per staged query.
function selectQuery(data: unknown, error: unknown = null) {
  return {
    eq: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
    order: vi.fn().mockReturnThis(),
    range: vi.fn().mockResolvedValue({ data, error }),
    gt: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data, error }),
    select: vi.fn().mockReturnThis(),
    // biome-ignore lint/suspicious/noThenProperty: Supabase query builders are thenable.
    then: (resolve: (value: unknown) => void) => resolve({ data, error }),
  };
}

describe('recoverUnknownPaystackRefund ambiguous candidates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchRefund.mockResolvedValue({
      data: {
        amount: 10000,
        currency: 'NGN',
        id: 202,
        status: 'processed',
        transaction: 555,
      },
      success: true,
    });
    mocks.fetchPaystackPaymentById.mockResolvedValue({
      data: { id: 555, reference: 'PSK-1' },
      success: true,
    });
  });

  function reviewRpc(error: unknown = null, watchRows: unknown = []) {
    // The stalled path opens the recovery watch and rescans: default
    // to an empty rescan so stalled tests return after filing.
    return vi.fn((fn: string) => {
      if (fn === 'open_paystack_refund_recovery_watch_v1') {
        return Promise.resolve({ data: watchRows, error: null });
      }
      return Promise.resolve({ data: 'review-1', error });
    });
  }

  it('files ambiguous reviews only for cancelled orders', async () => {
    const candidates = [
      payment('pay-1', 'order-1', 'merchant-1'),
      payment('pay-2', 'order-2', 'merchant-2'),
      payment('pay-9', 'order-9', 'merchant-9'),
    ];
    // The pass-0 snapshot is unlocked: the branch opens the watch and
    // re-scans under the reference lock first, then files the stable
    // locked set exactly once.
    const rpc = reviewRpc(null, candidates);
    const orders = [
      cancelledOrder('order-1'),
      cancelledOrder('order-2'),
      {
        cancelled_at: null,
        id: 'order-9',
        shipping_status: 'processing',
      },
    ];
    const reviewInsert = vi.fn().mockResolvedValue({ error: null });
    const from = vi
      .fn()
      .mockReturnValueOnce(selectQuery(candidates))
      .mockReturnValueOnce(selectQuery(candidates))
      .mockReturnValueOnce(selectQuery(orders))
      .mockReturnValueOnce(selectQuery(orders))
      .mockReturnValueOnce({ insert: reviewInsert });
    const supabase = { from, rpc } as unknown as SupabaseClient;

    await recoverUnknownPaystackRefund(supabase, 202, 'PSK-1');

    expect(rpc).toHaveBeenCalledTimes(4);
    expect(rpc).toHaveBeenCalledWith(
      'open_paystack_refund_recovery_watch_v1',
      expect.objectContaining({ p_paystack_ref: 'PSK-1' })
    );
    expect(rpc).toHaveBeenCalledWith(
      'resolve_paystack_refund_recovery_watch_v1',
      { p_paystack_ref: 'PSK-1', p_provider_refund_id: 202 }
    );
    expect(rpc).toHaveBeenCalledWith(
      'file_paystack_refund_recovery_review_v1',
      expect.objectContaining({ p_order_id: 'order-1' })
    );
    expect(rpc).toHaveBeenCalledWith(
      'file_paystack_refund_recovery_review_v1',
      expect.objectContaining({ p_order_id: 'order-2' })
    );
    expect(rpc).not.toHaveBeenCalledWith(
      'file_paystack_refund_recovery_review_v1',
      expect.objectContaining({ p_order_id: 'order-9' })
    );
    // The active match stays out of the cancellation queue but files
    // into the non-cancellation queue instead of being discarded.
    expect(reviewInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'provider_refund_outside_cancellation',
        order_id: 'order-9',
        metadata: expect.objectContaining({ provider_refund_id: 202 }),
      })
    );
  });

  it('files every order when matches span more than one page', async () => {
    const payments = Array.from({ length: 11 }, (_, index) =>
      payment(`pay-${index + 1}`, `order-${index + 1}`, `merchant-${index + 1}`)
    );
    // The locked rescan confirms the same eleven matches before the
    // branch terminalizes.
    const rpc = reviewRpc(null, payments);
    const orders = Array.from({ length: 11 }, (_, index) =>
      cancelledOrder(`order-${index + 1}`)
    );
    const firstPage = selectQuery([]);
    const firstLimit = vi
      .fn()
      .mockResolvedValue({ data: payments.slice(0, 10), error: null });
    firstPage.limit = firstLimit;
    const secondPage = selectQuery([]);
    const secondLimit = vi
      .fn()
      .mockResolvedValue({ data: payments.slice(10), error: null });
    secondPage.limit = secondLimit;
    // The stabilizing pass re-reads both pages and adds nothing.
    const thirdPage = selectQuery([]);
    thirdPage.limit = vi
      .fn()
      .mockResolvedValue({ data: payments.slice(0, 10), error: null });
    const fourthPage = selectQuery([]);
    fourthPage.limit = vi
      .fn()
      .mockResolvedValue({ data: payments.slice(10), error: null });
    const from = vi
      .fn()
      .mockReturnValueOnce({ select: vi.fn(() => firstPage) })
      .mockReturnValueOnce({ select: vi.fn(() => secondPage) })
      .mockReturnValueOnce({ select: vi.fn(() => thirdPage) })
      .mockReturnValueOnce({ select: vi.fn(() => fourthPage) })
      .mockReturnValueOnce(selectQuery(orders))
      .mockReturnValueOnce(selectQuery(orders));
    const supabase = { from, rpc } as unknown as SupabaseClient;

    await recoverUnknownPaystackRefund(supabase, 202, 'PSK-1');

    // A corrupt reference shared past the response cap must still file
    // every order: truncating after the first page would drop the
    // eleventh order's verified evidence after acknowledgement. The
    // id cursor keeps pages stable when a lower-id payment completes
    // between reads (offsets would shift and omit a match), and the
    // stabilizing pass repeats the scan so a completion landing
    // behind the cursor is still observed before acknowledgement.
    expect(firstLimit).toHaveBeenCalledWith(10);
    expect(secondPage.gt).toHaveBeenCalledWith('id', 'pay-10');
    expect(rpc).toHaveBeenCalledTimes(13);
    expect(rpc).toHaveBeenCalledWith(
      'open_paystack_refund_recovery_watch_v1',
      expect.objectContaining({ p_paystack_ref: 'PSK-1' })
    );
    expect(rpc).toHaveBeenCalledWith(
      'resolve_paystack_refund_recovery_watch_v1',
      { p_paystack_ref: 'PSK-1', p_provider_refund_id: 202 }
    );
    for (let index = 1; index <= 11; index++) {
      expect(rpc).toHaveBeenCalledWith(
        'file_paystack_refund_recovery_review_v1',
        expect.objectContaining({ p_order_id: `order-${index}` })
      );
    }
  });

  it('files one review per order when three payments share the reference', async () => {
    const candidates = [
      payment('pay-1', 'order-1', 'merchant-1'),
      payment('pay-2', 'order-2', 'merchant-2'),
      payment('pay-3', 'order-3', 'merchant-3'),
    ];
    const rpc = reviewRpc(null, candidates);
    const from = vi
      .fn()
      .mockReturnValueOnce(selectQuery(candidates))
      .mockReturnValueOnce(selectQuery(candidates))
      .mockReturnValueOnce(
        selectQuery([
          cancelledOrder('order-1'),
          cancelledOrder('order-2'),
          cancelledOrder('order-3'),
        ])
      )
      // Active-candidate partition finds no active orders to file.
      .mockReturnValueOnce(
        selectQuery([
          cancelledOrder('order-1'),
          cancelledOrder('order-2'),
          cancelledOrder('order-3'),
        ])
      );
    const supabase = { from, rpc } as unknown as SupabaseClient;

    await recoverUnknownPaystackRefund(supabase, 202, 'PSK-1');

    // The watch open leads, then one filing per order, then the
    // resolve: the third order's filing shifts from third to fourth.
    expect(rpc).toHaveBeenCalledTimes(5);
    expect(rpc).toHaveBeenNthCalledWith(
      1,
      'open_paystack_refund_recovery_watch_v1',
      expect.objectContaining({ p_paystack_ref: 'PSK-1' })
    );
    expect(rpc).toHaveBeenCalledWith(
      'resolve_paystack_refund_recovery_watch_v1',
      { p_paystack_ref: 'PSK-1', p_provider_refund_id: 202 }
    );
    expect(rpc).toHaveBeenNthCalledWith(
      4,
      'file_paystack_refund_recovery_review_v1',
      expect.objectContaining({
        p_order_id: 'order-3',
        p_merchant_id: 'merchant-3',
      })
    );
  });

  it('files every stalled match when the reference repeats on cancelled orders', async () => {
    const rpc = reviewRpc();
    const cancelled = [
      cancelledOrder('order-1'),
      cancelledOrder('order-2'),
      cancelledOrder('order-3'),
    ];
    const from = vi
      .fn()
      .mockReturnValueOnce(selectQuery([]))
      .mockReturnValueOnce(
        selectQuery([
          payment('pay-stalled-1', 'order-1', 'merchant-1'),
          payment('pay-stalled-2', 'order-2', 'merchant-2'),
          payment('pay-stalled-3', 'order-3', 'merchant-3'),
        ])
      )
      .mockReturnValueOnce(selectQuery(cancelled))
      .mockReturnValueOnce(selectQuery(cancelled));
    const supabase = { from, rpc } as unknown as SupabaseClient;

    await recoverUnknownPaystackRefund(supabase, 202, 'PSK-1');

    // Three recovery reviews plus the watch open: a payment completing
    // after the first scan but before the stalled scan appears in
    // neither, so the stalled path rescans under the reference lock
    // before returning.
    expect(rpc).toHaveBeenCalledTimes(4);
    expect(rpc).toHaveBeenCalledWith(
      'open_paystack_refund_recovery_watch_v1',
      expect.objectContaining({ p_paystack_ref: 'PSK-1' })
    );
  });

  it('files every order when stalled matches span more than one page', async () => {
    const rpc = reviewRpc();
    const stalled = Array.from({ length: 11 }, (_, index) =>
      payment(
        `pay-stalled-${index + 1}`,
        `order-${index + 1}`,
        `merchant-${index + 1}`
      )
    );
    const orders = Array.from({ length: 11 }, (_, index) =>
      cancelledOrder(`order-${index + 1}`)
    );
    const firstStalled = selectQuery([]);
    const firstStalledLimit = vi
      .fn()
      .mockResolvedValue({ data: stalled.slice(0, 10), error: null });
    firstStalled.limit = firstStalledLimit;
    const secondStalled = selectQuery([]);
    const secondStalledLimit = vi
      .fn()
      .mockResolvedValue({ data: stalled.slice(10), error: null });
    secondStalled.limit = secondStalledLimit;
    const from = vi
      .fn()
      .mockReturnValueOnce(selectQuery([]))
      .mockReturnValueOnce({ select: vi.fn(() => firstStalled) })
      .mockReturnValueOnce({ select: vi.fn(() => secondStalled) })
      .mockReturnValueOnce(selectQuery(orders))
      .mockReturnValueOnce(selectQuery(orders));
    const supabase = { from, rpc } as unknown as SupabaseClient;

    await recoverUnknownPaystackRefund(supabase, 202, 'PSK-1');

    // A legacy reference shared past the response cap must still file
    // every stalled order: the webhook is acknowledged, so a truncated
    // subset would permanently drop the omitted verified evidence. The
    // id cursor keeps pages stable when a lower-id row transitions
    // out of the stalled statuses between reads; offsets would shift
    // and skip a match with no watch to catch it.
    expect(firstStalledLimit).toHaveBeenCalledWith(10);
    expect(secondStalled.gt).toHaveBeenCalledWith('id', 'pay-stalled-10');
    expect(rpc).toHaveBeenCalledTimes(12);
    expect(rpc).toHaveBeenCalledWith(
      'open_paystack_refund_recovery_watch_v1',
      expect.objectContaining({ p_paystack_ref: 'PSK-1' })
    );
    for (let index = 1; index <= 11; index++) {
      expect(rpc).toHaveBeenCalledWith(
        'file_paystack_refund_recovery_review_v1',
        expect.objectContaining({ p_order_id: `order-${index}` })
      );
    }
  });

  it('files mismatched refund evidence for review and throws for redelivery', async () => {
    mocks.fetchRefund.mockResolvedValue({
      data: {
        amount: 10000,
        currency: 'NGN',
        id: 203,
        status: 'processed',
        transaction: 555,
      },
      success: true,
    });
    const rpc = reviewRpc();
    const candidates = [payment('pay-1', 'order-1', 'merchant-1')];
    const from = vi
      .fn()
      .mockReturnValueOnce(selectQuery(candidates))
      .mockReturnValueOnce(selectQuery(candidates))
      .mockReturnValueOnce(selectQuery([cancelledOrder('order-1')]))
      // Active-queue lookup: the order is cancelled, so the
      // non-cancellation queue files nothing.
      .mockReturnValueOnce(selectQuery([cancelledOrder('order-1')]));
    const supabase = { from, rpc } as unknown as SupabaseClient;

    await expect(
      recoverUnknownPaystackRefund(supabase, 202, 'PSK-1')
    ).rejects.toThrow('paystack_refund_evidence_invalid');

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenCalledWith(
      'file_paystack_refund_recovery_review_v1',
      expect.objectContaining({ p_order_id: 'order-1' })
    );
    expect(rpc).toHaveBeenCalledWith(
      'resolve_paystack_refund_recovery_watch_v1',
      { p_paystack_ref: 'PSK-1', p_provider_refund_id: 202 }
    );
  });

  it('files malformed evidence for active orders before throwing for redelivery', async () => {
    mocks.fetchRefund.mockResolvedValue({
      data: {
        amount: 12.5,
        currency: 'NGN',
        id: 202,
        status: 'processed',
        transaction: 555,
      },
      success: true,
    });
    const active = [
      {
        cancelled_at: null,
        id: 'order-9',
        order_number: 'ORD-9',
        shipping_status: 'processing',
      },
    ];
    const rpc = reviewRpc();
    const reviewInsert = vi.fn().mockResolvedValue({ error: null });
    const candidates = [payment('pay-9', 'order-9', 'merchant-9')];
    const from = vi
      .fn()
      .mockReturnValueOnce(selectQuery(candidates))
      .mockReturnValueOnce(selectQuery(candidates))
      .mockReturnValueOnce(selectQuery(active))
      .mockReturnValueOnce(selectQuery(active))
      .mockReturnValueOnce({ insert: reviewInsert });
    const supabase = { from, rpc } as unknown as SupabaseClient;

    await expect(
      recoverUnknownPaystackRefund(supabase, 202, 'PSK-1')
    ).rejects.toThrow('paystack_refund_evidence_invalid');

    // The cancellation queue drops the active order, so without the
    // non-cancellation filing the evidence would vanish with the last
    // provider retry while the order stays paid and fulfillable.
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      'resolve_paystack_refund_recovery_watch_v1',
      { p_paystack_ref: 'PSK-1', p_provider_refund_id: 202 }
    );
    expect(reviewInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'provider_refund_outside_cancellation',
        merchant_id: 'merchant-9',
        order_id: 'order-9',
        metadata: expect.objectContaining({ provider_refund_id: 202 }),
        reason: expect.stringContaining('unusable provider evidence'),
      })
    );
  });

  it('files a generic review when malformed evidence matches no local payment', async () => {
    mocks.fetchRefund.mockResolvedValue({
      data: {
        amount: 12.5,
        currency: 'NGN',
        id: 202,
        status: 'processed',
        transaction: 555,
      },
      success: true,
    });
    const rpc = reviewRpc();
    const reviewInsert = vi.fn().mockResolvedValue({ error: null });
    const from = vi
      .fn()
      .mockReturnValueOnce(selectQuery([]))
      .mockReturnValueOnce({ insert: reviewInsert });
    const supabase = { from, rpc } as unknown as SupabaseClient;

    await expect(
      recoverUnknownPaystackRefund(supabase, 202, 'PSK-1')
    ).rejects.toThrow('paystack_refund_evidence_unmatched');

    // Throwing with no durable trace would let the malformed evidence
    // vanish with the last provider retry: the generic review keeps
    // the wedge visible while redelivery still recovers glitches.
    expect(reviewInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'paystack_refund_evidence_invalid',
        order_id: null,
        paystack_ref: 'PSK-1',
        reason: expect.stringContaining('unusable provider evidence'),
      })
    );
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      'resolve_paystack_refund_recovery_watch_v1',
      { p_paystack_ref: 'PSK-1', p_provider_refund_id: 202 }
    );
  });

  it('files stalled matches on active orders into the non-cancellation queue', async () => {
    const rpc = reviewRpc();
    const active = [
      {
        cancelled_at: null,
        id: 'order-9',
        order_number: 'ORD-9',
        shipping_status: 'processing',
      },
    ];
    const reviewInsert = vi.fn().mockResolvedValue({ error: null });
    const from = vi
      .fn()
      .mockReturnValueOnce(selectQuery([]))
      .mockReturnValueOnce(
        selectQuery([payment('pay-stalled', 'order-9', 'merchant-9')])
      )
      .mockReturnValueOnce(selectQuery(active))
      .mockReturnValueOnce(selectQuery(active))
      .mockReturnValueOnce({ insert: reviewInsert });
    const supabase = { from, rpc } as unknown as SupabaseClient;

    await recoverUnknownPaystackRefund(supabase, 202, 'PSK-1');

    // Withheld from the cancellation queue so it cannot absorb a future
    // genuine cancellation's evidence — but retained for operations, or
    // a later charge recovery could mark the refunded order paid. The
    // only rpc call opens the recovery watch for the stalled-path
    // rescan.
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      'open_paystack_refund_recovery_watch_v1',
      expect.objectContaining({ p_paystack_ref: 'PSK-1' })
    );
    expect(reviewInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'provider_refund_outside_cancellation',
        merchant_id: 'merchant-9',
        order_id: 'order-9',
        metadata: expect.objectContaining({ provider_refund_id: 202 }),
      })
    );
    expect(mocks.loggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({ refundId: 202 })
    );
  });

  it('keeps every payment leg when one active order has several candidates', async () => {
    const candidates = [
      payment('pay-1', 'order-9', 'merchant-9'),
      payment('pay-2', 'order-9', 'merchant-9'),
    ];
    const rpc = reviewRpc(null, candidates);
    const active = [
      {
        cancelled_at: null,
        id: 'order-9',
        order_number: 'ORD-9',
        shipping_status: 'processing',
      },
    ];
    const reviewInsert = vi.fn().mockResolvedValue({ error: null });
    const from = vi
      .fn()
      .mockReturnValueOnce(selectQuery(candidates))
      .mockReturnValueOnce(selectQuery(candidates))
      .mockReturnValueOnce(selectQuery(active))
      .mockReturnValueOnce(selectQuery(active))
      .mockReturnValueOnce({ insert: reviewInsert });
    const supabase = { from, rpc } as unknown as SupabaseClient;

    await recoverUnknownPaystackRefund(supabase, 202, 'PSK-1');

    // One review for the order, but both candidate legs retained: the
    // webhook is acknowledged, so a dropped leg would vanish from the
    // evidence ops uses to route the verified refund.
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenCalledWith(
      'open_paystack_refund_recovery_watch_v1',
      expect.objectContaining({ p_paystack_ref: 'PSK-1' })
    );
    expect(rpc).toHaveBeenCalledWith(
      'resolve_paystack_refund_recovery_watch_v1',
      { p_paystack_ref: 'PSK-1', p_provider_refund_id: 202 }
    );
    expect(reviewInsert).toHaveBeenCalledTimes(1);
    expect(reviewInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'provider_refund_outside_cancellation',
        order_id: 'order-9',
        candidates: [
          expect.objectContaining({ payment_transaction_id: 'pay-1' }),
          expect.objectContaining({ payment_transaction_id: 'pay-2' }),
        ],
        metadata: expect.objectContaining({
          provider_refund_id: 202,
          refund_evidence: expect.objectContaining({
            'provider:202': expect.objectContaining({
              candidate_payment_transaction_ids: ['pay-1', 'pay-2'],
            }),
          }),
        }),
      })
    );
  });

  it('files a generic review when the sole completed payment is already detached', async () => {
    const detached = [
      { ...payment('pay-1', 'order-1', 'merchant-1'), order_id: null },
    ];
    // The locked rescan confirms the same detached row: the branch
    // files once on stable state instead of the unlocked snapshot.
    const rpc = reviewRpc(null, detached);
    const reviewInsert = vi.fn().mockResolvedValue({ error: null });
    const from = vi
      .fn()
      .mockReturnValueOnce(selectQuery(detached))
      .mockReturnValueOnce(selectQuery(detached))
      .mockReturnValueOnce({ insert: reviewInsert });
    const supabase = { from, rpc } as unknown as SupabaseClient;

    await recoverUnknownPaystackRefund(supabase, 202, 'PSK-1');

    // The order FK already nulled the link before the scan, so the
    // verified merchant debit files into the order-independent queue
    // — but the watch stays open: a later completion sharing the
    // reference must claim it instead of acknowledging silently.
    expect(reviewInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'paystack_refund_evidence_invalid',
        order_id: null,
        paystack_ref: 'PSK-1',
        reason: expect.stringContaining('detached from any order'),
      })
    );
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      'open_paystack_refund_recovery_watch_v1',
      expect.objectContaining({ p_paystack_ref: 'PSK-1' })
    );
    expect(rpc).not.toHaveBeenCalledWith(
      'resolve_paystack_refund_recovery_watch_v1',
      expect.anything()
    );
    expect(mocks.loggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({ refundId: 202 })
    );
  });

  it('files a late arrival the unlocked multi-match snapshot missed', async () => {
    const initial = [
      payment('pay-1', 'order-1', 'merchant-1'),
      payment('pay-2', 'order-2', 'merchant-2'),
    ];
    // A third payment completes after the unlocked scan: the locked
    // rescan observes it and the stable branch files all three
    // instead of acknowledging with order-3 missing from the
    // evidence.
    const rescan = [...initial, payment('pay-3', 'order-3', 'merchant-3')];
    const rpc = reviewRpc(null, rescan);
    const orders = [
      cancelledOrder('order-1'),
      cancelledOrder('order-2'),
      cancelledOrder('order-3'),
    ];
    const from = vi
      .fn()
      .mockReturnValueOnce(selectQuery(initial))
      .mockReturnValueOnce(selectQuery(initial))
      .mockReturnValueOnce(selectQuery(orders))
      .mockReturnValueOnce(selectQuery(orders));
    const supabase = { from, rpc } as unknown as SupabaseClient;

    await recoverUnknownPaystackRefund(supabase, 202, 'PSK-1');

    expect(rpc).toHaveBeenCalledWith(
      'open_paystack_refund_recovery_watch_v1',
      expect.objectContaining({ p_paystack_ref: 'PSK-1' })
    );
    for (const orderId of ['order-1', 'order-2', 'order-3']) {
      expect(rpc).toHaveBeenCalledWith(
        'file_paystack_refund_recovery_review_v1',
        expect.objectContaining({ p_order_id: orderId })
      );
    }
    expect(rpc).toHaveBeenCalledWith(
      'resolve_paystack_refund_recovery_watch_v1',
      { p_paystack_ref: 'PSK-1', p_provider_refund_id: 202 }
    );
  });

  it('leaves the watch open when the multi-match rescan comes back empty', async () => {
    // Both unlocked matches vanish before the locked rescan (e.g.
    // detached by concurrent order deletes): nothing is filed on the
    // stale snapshot, and the stable-empty return keeps the watch
    // open for a later completion instead of resolving it.
    const rpc = reviewRpc();
    const initial = [
      payment('pay-1', 'order-1', 'merchant-1'),
      payment('pay-2', 'order-2', 'merchant-2'),
    ];
    const reviewInsert = vi.fn().mockResolvedValue({ error: null });
    const from = vi
      .fn()
      .mockReturnValueOnce(selectQuery(initial))
      .mockReturnValueOnce(selectQuery(initial))
      .mockReturnValueOnce({ insert: reviewInsert });
    const supabase = { from, rpc } as unknown as SupabaseClient;

    await recoverUnknownPaystackRefund(supabase, 202, 'PSK-1');

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      'open_paystack_refund_recovery_watch_v1',
      expect.objectContaining({ p_paystack_ref: 'PSK-1' })
    );
    expect(rpc).not.toHaveBeenCalledWith(
      'resolve_paystack_refund_recovery_watch_v1',
      expect.anything()
    );
    expect(reviewInsert).not.toHaveBeenCalled();
  });

  it('leaves the watch open when the detached rescan comes back empty', async () => {
    // The detached row vanishes before the locked rescan: no review
    // files on the stale snapshot, and the stable-empty return keeps
    // the watch open for a later completion instead of resolving it.
    const rpc = reviewRpc();
    const detached = [
      { ...payment('pay-1', 'order-1', 'merchant-1'), order_id: null },
    ];
    const reviewInsert = vi.fn().mockResolvedValue({ error: null });
    const from = vi
      .fn()
      .mockReturnValueOnce(selectQuery(detached))
      .mockReturnValueOnce(selectQuery(detached))
      .mockReturnValueOnce({ insert: reviewInsert });
    const supabase = { from, rpc } as unknown as SupabaseClient;

    await recoverUnknownPaystackRefund(supabase, 202, 'PSK-1');

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      'open_paystack_refund_recovery_watch_v1',
      expect.objectContaining({ p_paystack_ref: 'PSK-1' })
    );
    expect(reviewInsert).not.toHaveBeenCalled();
  });
});
