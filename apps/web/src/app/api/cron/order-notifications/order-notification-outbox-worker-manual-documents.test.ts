import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendNotification = vi.hoisted(() => vi.fn());
const beginDispatch = vi.hoisted(() => vi.fn());
const sendDocument = vi.hoisted(() => vi.fn());
vi.mock('@/lib/send-manual-order-document', () => ({
  sendManualOrderDocument: sendDocument,
}));
vi.mock('@/lib/order-fulfillment-notification', () => ({
  sendOrderFulfillmentNotification: sendNotification,
}));
vi.mock('@/lib/order-notification-outbox-dispatch', () => ({
  beginOrderNotificationOutboxDispatch: beginDispatch,
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));

import {
  createOrderNotificationCronSummary,
  processClaimedOrderNotificationRows,
} from './order-notification-outbox-worker';

import {
  createSupabase,
  finalAttempt,
  row,
} from './order-notification-outbox-worker-manual-documents.test-support';

describe('order notification outbox worker manual documents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    beginDispatch.mockResolvedValue(undefined);
  });

  it('drains a manual receipt through the document sender rather than the shipping sender', async () => {
    const { client, builder } = createSupabase([null]);
    sendDocument.mockResolvedValue({
      status: 'sent',
      messageId: 'document-message',
    });
    const summary = createOrderNotificationCronSummary(1);
    await processClaimedOrderNotificationRows(
      client as never,
      [{ ...row, event_type: 'manual_order_receipt' }],
      summary
    );
    expect(sendDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        row: expect.objectContaining({ order_id: row.order_id }),
      })
    );
    expect(sendNotification).not.toHaveBeenCalled();
    expect(summary.sent).toBe(1);
    expect(builder.not).toHaveBeenCalledWith('dispatch_started_at', 'is', null);
    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'sent' })
    );
  });

  it('returns a late final-attempt row to pending without charging the claim', async () => {
    const { client, builder } = createSupabase([null]);
    const claimed = finalAttempt('manual_order_invoice');
    sendDocument.mockResolvedValue({ status: 'deferred' });
    const summary = createOrderNotificationCronSummary(1);

    await processClaimedOrderNotificationRows(
      client as never,
      [claimed],
      summary
    );

    expect(summary).toMatchObject({ failed: 0, retried: 1, sent: 0 });
    expect(builder.eq).toHaveBeenCalledWith(
      'attempt_count',
      claimed.attempt_count
    );
    expect(builder.is).toHaveBeenCalledWith('dispatch_started_at', null);
    expect(builder.match).toHaveBeenCalledWith({
      id: claimed.id,
      locked_by: claimed.claim_owner,
      status: 'processing',
    });
    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt_count: claimed.attempt_count - 1,
        status: 'pending',
        locked_by: null,
        locked_at: null,
        next_attempt_at: expect.any(String),
      })
    );
  });

  it('retries a manual document reset between send and status persistence', async () => {
    const { client, builder } = createSupabase(
      ['zero-rows', null],
      {},
      {
        dispatch_started_at: null,
        locked_by: row.claim_owner,
        status: 'processing',
      }
    );
    sendDocument.mockResolvedValue({
      status: 'sent',
      messageId: 'document-message',
    });
    const summary = createOrderNotificationCronSummary(1);
    await processClaimedOrderNotificationRows(
      client as never,
      [{ ...row, event_type: 'manual_order_invoice' }],
      summary
    );
    expect(summary).toMatchObject({ failed: 0, sent: 0, retried: 1 });
    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        last_error: 'document_changed_during_send',
        status: 'pending',
      })
    );
  });

  it('reserves a fresh corrective attempt past the provider-failure ceiling', async () => {
    const { client, builder } = createSupabase(
      ['zero-rows', null],
      {},
      {
        dispatch_started_at: null,
        locked_by: row.claim_owner,
        status: 'processing',
      }
    );
    sendDocument.mockResolvedValue({
      status: 'sent',
      messageId: 'document-message',
    });
    const summary = createOrderNotificationCronSummary(1);
    await processClaimedOrderNotificationRows(
      client as never,
      [finalAttempt('manual_order_invoice')],
      summary
    );
    // The customer holds a stale attachment and no further event
    // requeues the correction: the row must retry, never fail.
    expect(summary).toMatchObject({ failed: 0, sent: 0, retried: 1 });
    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt_count: 0,
        last_error: 'document_changed_during_send',
        status: 'pending',
      })
    );
  });

  it('routes a post-acceptance lease reset through the corrective path', async () => {
    const { client, builder } = createSupabase([null]);
    sendDocument.mockResolvedValue({
      status: 'failed',
      error: 'document_changed_during_send',
    });
    const summary = createOrderNotificationCronSummary(1);
    await processClaimedOrderNotificationRows(
      client as never,
      [finalAttempt('manual_order_receipt')],
      summary
    );
    // Detected at the lease check rather than the sent transition, on the
    // final attempt: still a fresh corrective retry, never a terminal fail.
    expect(summary).toMatchObject({ failed: 0, sent: 0, retried: 1 });
    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt_count: 0,
        last_error: 'document_changed_during_send',
        status: 'pending',
      })
    );
  });

  it('terminalizes an unclassifiable manual send instead of retrying blind', async () => {
    const { client, builder } = createSupabase(
      ['zero-rows', null],
      {},
      null,
      new Error('read failed')
    );
    sendDocument.mockResolvedValue({
      status: 'sent',
      messageId: 'document-message',
    });
    const summary = createOrderNotificationCronSummary(1);
    await processClaimedOrderNotificationRows(
      client as never,
      [{ ...row, event_type: 'manual_order_receipt' }],
      summary
    );
    expect(summary).toMatchObject({ failed: 0, sent: 0, retried: 0 });
    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        last_error: 'sent_outcome_classify_failed',
        skip_reason: 'delivery_outcome_unknown',
        status: 'skipped',
      })
    );
  });

  it('does not retry an ambiguous manual receipt delivery', async () => {
    const { client, builder } = createSupabase([null]);
    sendDocument.mockResolvedValue({
      status: 'failed',
      error: 'timeout',
      deliveryOutcome: 'unknown',
    });
    const summary = createOrderNotificationCronSummary(1);
    await processClaimedOrderNotificationRows(
      client as never,
      [{ ...row, event_type: 'manual_order_invoice' }],
      summary
    );
    expect(summary).toMatchObject({ skipped: 1, retried: 0 });
    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        skip_reason: 'delivery_outcome_unknown',
        status: 'skipped',
      })
    );
  });

  it('reclaims a clear-failed marker before redispatching the manual retry', async () => {
    const { client, builder } = createSupabase([null, null], {}, null, null, {
      dispatch_started_at: '2026-09-30T10:00:00Z',
      last_error: 'dispatch_marker_clear_failed',
    });
    sendDocument.mockResolvedValue({ status: 'failed', error: 'rejected' });
    const summary = createOrderNotificationCronSummary(1);
    await processClaimedOrderNotificationRows(
      client as never,
      [{ ...row, event_type: 'manual_order_invoice' }],
      summary
    );
    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({ dispatch_started_at: null })
    );
    expect(sendDocument).toHaveBeenCalledTimes(1);
    expect(summary).toMatchObject({ retried: 1 });
  });

  it('preserves stranded-marker evidence across a transient reclaim-read failure', async () => {
    const { client, builder } = createSupabase(
      [null],
      {},
      null,
      null,
      {
        dispatch_started_at: '2026-09-30T10:00:00Z',
        last_error: 'dispatch_marker_clear_failed',
      },
      new Error('connection reset')
    );
    const summary = createOrderNotificationCronSummary(1);
    await processClaimedOrderNotificationRows(
      client as never,
      [{ ...row, event_type: 'manual_order_invoice' }],
      summary
    );
    // Ordinary retry budget, not the corrective path — and the update must
    // not overwrite the stranded-marker sentinel, or the next attempt
    // would stop recognizing the row as reclaimable and skip an unsent
    // document.
    expect(sendDocument).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ failed: 0, retried: 1 });
    const updateArg = builder.update.mock.calls[0]?.[0] as
      | Record<string, unknown>
      | undefined;
    expect(updateArg).toMatchObject({ status: 'pending' });
    expect(updateArg).not.toHaveProperty('last_error');
  });

  it('reserves a cleanup retry past the budget on marker-clear failure', async () => {
    const { client, builder } = createSupabase([null]);
    sendDocument.mockResolvedValue({
      status: 'failed',
      error: 'dispatch_marker_clear_failed',
    });
    const summary = createOrderNotificationCronSummary(1);
    await processClaimedOrderNotificationRows(
      client as never,
      [finalAttempt('manual_order_invoice')],
      summary
    );
    expect(summary).toMatchObject({ failed: 0, retried: 1 });
    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt_count: 0,
        last_error: 'dispatch_marker_clear_failed',
        status: 'pending',
      })
    );
  });
});
