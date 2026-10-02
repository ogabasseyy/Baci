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

function mockNotificationResult(result: unknown) {
  sendNotification.mockImplementation(
    async (params: { beforeProviderDispatch?: () => Promise<void> }) => {
      await params.beforeProviderDispatch?.();
      return result;
    }
  );
}

describe('order notification outbox worker', () => {
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

  it('marks successful sends as sent while preserving existing metadata', async () => {
    const { client, builder } = createSupabase([null], {
      source: 'shipping_status_trigger',
    });
    mockNotificationResult({
      status: 'sent',
      messageId: 'message-1',
    });
    const summary = createOrderNotificationCronSummary(1);

    await processClaimedOrderNotificationRows(client as never, [row], summary);

    expect(summary).toMatchObject({ sent: 1, retried: 0, skipped: 0 });
    expect(beginDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ claimId: row.id, orderId: row.order_id })
    );
    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {
          source: 'shipping_status_trigger',
          message_id: 'message-1',
        },
        status: 'sent',
      })
    );
  });

  it('does not complete the notification when the dispatch boundary cannot be persisted', async () => {
    const { client, builder } = createSupabase([null]);
    beginDispatch.mockRejectedValue(new Error('dispatch marker unavailable'));
    mockNotificationResult({ status: 'sent', messageId: 'message-1' });
    const summary = createOrderNotificationCronSummary(1);

    await processClaimedOrderNotificationRows(client as never, [row], summary);

    expect(summary).toMatchObject({ retried: 1, sent: 0 });
    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        last_error: 'dispatch marker unavailable',
        status: 'pending',
      })
    );
  });

  it('marks skipped notification results as skipped', async () => {
    const { client, builder } = createSupabase([null]);
    mockNotificationResult({
      status: 'skipped',
      reason: 'missing_customer_email',
    });
    const summary = createOrderNotificationCronSummary(1);

    await processClaimedOrderNotificationRows(client as never, [row], summary);

    expect(summary).toMatchObject({ skipped: 1, retried: 0, sent: 0 });
    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        skip_reason: 'missing_customer_email',
        status: 'skipped',
      })
    );
  });

  it('reschedules known failures while attempts remain', async () => {
    const { client, builder } = createSupabase([null]);
    mockNotificationResult({
      status: 'failed',
      error: 'provider unavailable',
    });
    const summary = createOrderNotificationCronSummary(1);

    await processClaimedOrderNotificationRows(client as never, [row], summary);

    expect(summary).toMatchObject({ failed: 0, retried: 1 });
    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        last_error: 'provider unavailable',
        status: 'pending',
      })
    );
  });

  it('marks known failures terminal after the final attempt', async () => {
    const { client, builder } = createSupabase([null]);
    mockNotificationResult({
      status: 'failed',
      error: 'provider unavailable',
    });
    const summary = createOrderNotificationCronSummary(1);

    await processClaimedOrderNotificationRows(
      client as never,
      [{ ...row, attempt_count: row.max_attempts }],
      summary
    );

    expect(summary).toMatchObject({ failed: 1, retried: 0 });
    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' })
    );
  });

  it('never retries an ambiguous provider delivery outcome', async () => {
    const { client, builder } = createSupabase([null]);
    mockNotificationResult({
      status: 'failed',
      deliveryOutcome: 'unknown',
      error: 'request timed out',
    });
    const summary = createOrderNotificationCronSummary(1);

    await processClaimedOrderNotificationRows(client as never, [row], summary);

    expect(summary).toMatchObject({ skipped: 1, retried: 0 });
    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        skip_reason: 'delivery_outcome_unknown',
        status: 'skipped',
      })
    );
  });

  it('terminalizes a sent email as outcome-unknown when the sent marker write fails', async () => {
    const { client, builder } = createSupabase([
      { message: 'first write failed' },
      null,
    ]);
    mockNotificationResult({
      status: 'sent',
      messageId: 'message-1',
    });
    const summary = createOrderNotificationCronSummary(1);

    await processClaimedOrderNotificationRows(client as never, [row], summary);

    expect(summary).toMatchObject({ sent: 1, retried: 0, skipped: 0 });
    expect(builder.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        skip_reason: 'delivery_outcome_unknown',
        status: 'skipped',
      })
    );
  });

  it('normalizes rejected sent-marker writes before applying the safe fallback', async () => {
    const { client, builder } = createSupabase([]);
    builder.maybeSingle
      .mockResolvedValueOnce({
        data: { id: row.id, metadata: {} },
        error: null,
      })
      .mockRejectedValueOnce(new Error('database connection reset'))
      .mockResolvedValueOnce({ data: { id: row.id }, error: null });
    mockNotificationResult({
      status: 'sent',
      messageId: 'message-1',
    });
    const summary = createOrderNotificationCronSummary(1);

    await processClaimedOrderNotificationRows(client as never, [row], summary);

    expect(summary).toMatchObject({ sent: 1, retried: 0 });
    expect(builder.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        skip_reason: 'delivery_outcome_unknown',
        status: 'skipped',
      })
    );
  });

  it('terminalizes a sent email as outcome-unknown when the live re-read fails', async () => {
    const { client, builder } = createSupabase([]);
    builder.maybeSingle
      .mockRejectedValueOnce(new Error('database connection reset'))
      .mockResolvedValueOnce({ data: { id: row.id }, error: null });
    mockNotificationResult({
      status: 'sent',
      messageId: 'message-1',
    });
    const summary = createOrderNotificationCronSummary(1);

    await processClaimedOrderNotificationRows(client as never, [row], summary);

    expect(summary).toMatchObject({ sent: 1, retried: 0, skipped: 0 });
    expect(builder.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        skip_reason: 'delivery_outcome_unknown',
        status: 'skipped',
      })
    );
  });
});
