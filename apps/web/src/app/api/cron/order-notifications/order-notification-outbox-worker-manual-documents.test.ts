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

function createSupabase(
  errors: unknown[],
  liveMetadata: Record<string, unknown> = {},
  classifyRow: Record<string, unknown> | null = null,
  classifyError: unknown = null,
  reclaimRow: Record<string, unknown> | null = {
    dispatch_started_at: null,
    last_error: null,
  }
) {
  const updateErrors = [...errors];
  const select = vi.fn();
  // The sent path re-reads the live row (select metadata) before the status
  // update (select id); resolve each from its own source. The manual path
  // classifies a 0-row sent update with a second read, and reclaims a
  // clear-failed marker before dispatching.
  const maybeSingle = vi.fn(async () => {
    const lastSelect = select.mock.calls[select.mock.calls.length - 1]?.[0];
    if (lastSelect === 'metadata' || lastSelect === 'metadata, updated_at') {
      return {
        data: {
          id: row.id,
          metadata: liveMetadata,
          updated_at: '2026-10-03T00:00:00Z',
        },
        error: null,
      };
    }
    if (lastSelect === 'dispatch_started_at, last_error') {
      return { data: reclaimRow, error: null };
    }
    if (typeof lastSelect === 'string' && lastSelect.includes('locked_by')) {
      return { data: classifyError ? null : classifyRow, error: classifyError };
    }
    const error = updateErrors.shift();
    if (error === 'zero-rows') {
      return { data: null, error: null };
    }
    return { data: error ? null : { id: row.id }, error: error ?? null };
  });
  const builder = {
    eq: vi.fn(() => builder),
    is: vi.fn(() => builder),
    match: vi.fn(() => builder),
    maybeSingle,
    not: vi.fn(() => builder),
    select,
    update: vi.fn(() => builder),
  };
  select.mockImplementation(() => builder);
  return { client: { from: vi.fn(() => builder) }, builder };
}

const row = {
  attempt_count: 1,
  claim_owner: 'worker-1',
  event_type: 'order_shipped' as const,
  id: '10000000-0000-4000-8000-000000000001',
  max_attempts: 5,
  merchant_id: '10000000-0000-4000-8000-000000000002',
  order_id: '10000000-0000-4000-8000-000000000003',
};

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
});
