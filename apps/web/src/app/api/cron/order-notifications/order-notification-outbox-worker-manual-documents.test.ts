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
  liveMetadata: Record<string, unknown> = {}
) {
  const updateErrors = [...errors];
  const select = vi.fn();
  // The sent path re-reads the live row (select metadata) before the status
  // update (select id); resolve each from its own source.
  const maybeSingle = vi.fn(async () => {
    const calls = select.mock.calls;
    if (calls[calls.length - 1]?.[0] === 'metadata') {
      return { data: { id: row.id, metadata: liveMetadata }, error: null };
    }
    const error = updateErrors.shift();
    return { data: error ? null : { id: row.id }, error: error ?? null };
  });
  const builder = {
    match: vi.fn(() => builder),
    maybeSingle,
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
    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'sent' })
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
});
