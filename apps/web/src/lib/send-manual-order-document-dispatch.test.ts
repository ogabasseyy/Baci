// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendEmail = vi.hoisted(() => vi.fn());
vi.mock('@/env', () => ({ getRootDomain: () => 'usebaci.com' }));
vi.mock('@/lib/zeptomail', () => ({ sendEmail }));
vi.mock('@/lib/receipt-pdf-generator', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/receipt-pdf-generator')>()),
  resolveReceiptLogoDataUri: vi.fn().mockResolvedValue(null),
}));

import { database, row } from './manual-order-document.test-utils';
import { sendManualOrderDocument } from './send-manual-order-document';

describe('send manual order document dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendEmail.mockImplementation(async (message) => {
      await message.beforeTransportDispatch?.();
      return { success: true, messageId: 'message-1' };
    });
  });

  it('skips an order whose items were removed after enqueue', async () => {
    const db = database({ order_items: [] });
    expect(await sendManualOrderDocument({ supabase: db.client, row })).toEqual(
      { status: 'skipped', reason: 'missing_order_items' }
    );
    expect(sendEmail).not.toHaveBeenCalled();
    expect(db.rpc.mock.calls.map(([fn]) => fn)).toEqual([
      'get_manual_order_document_snapshot',
    ]);
  });

  it('skips an obsolete invoice if the order is now paid', async () => {
    const db = database();
    expect(
      await sendManualOrderDocument({
        supabase: db.client,
        row: { ...row, event_type: 'manual_order_invoice' },
      })
    ).toMatchObject({ status: 'skipped' });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('fails closed when claim creation fails, before provider dispatch', async () => {
    const db = database(
      {},
      { claimResult: { data: null, error: { message: 'unavailable' } } }
    );
    await expect(
      sendManualOrderDocument({ supabase: db.client, row })
    ).rejects.toThrow();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('requires a claim ID before sending', async () => {
    const db = database(
      {},
      { claimResult: { data: { status: 'created' }, error: null } }
    );
    await expect(
      sendManualOrderDocument({ supabase: db.client, row })
    ).resolves.toEqual({
      status: 'skipped',
      reason: 'claim_validation_failed',
    });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('does not send a stale PDF/recipient if the customer changed during claim preparation', async () => {
    const db = database(
      {},
      {
        claimResult: {
          data: {
            status: 'created',
            claim_id: 'claim-1',
            customer_id: 'customer-2',
            customer_email: 'another@example.com',
            order_total: 950000,
            order_amount_paid: 950000,
            order_item_count: 1,
            order_payment_status: 'paid',
          },
          error: null,
        },
      }
    );
    await expect(
      sendManualOrderDocument({ supabase: db.client, row })
    ).rejects.toThrow('recipient changed');
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('retries instead of dispatching when the order changed during preparation', async () => {
    const db = database(
      {},
      {
        claimResult: {
          data: {
            status: 'created',
            claim_id: 'claim-1',
            customer_id: 'customer-1',
            customer_email: 'ada@example.com',
            order_total: 960000,
            order_amount_paid: 950000,
            order_item_count: 1,
            order_payment_status: 'paid',
          },
          error: null,
        },
      }
    );
    await expect(
      sendManualOrderDocument({ supabase: db.client, row })
    ).rejects.toThrow('changed during preparation');
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('never rewrites the dispatch marker the atomic RPC already set', async () => {
    const db = database();
    const result = await sendManualOrderDocument({ supabase: db.client, row });
    expect(result.status).toBe('sent');
    // The RPC commits dispatch_started_at, so a second conditional write
    // filtered by IS NULL would match zero rows and fail every real send.
    expect(
      db.filters['order_notification_outbox.dispatch_started_at']
    ).toBeUndefined();
  });

  it('retries instead of dispatching when the dispatch marker reports a stale order', async () => {
    const db = database({}, { dispatchStatus: 'stale' });
    // The marker runs as beforeTransportDispatch, so the provider mock is
    // entered but never reaches its accept path: the stale throw rejects for
    // retry instead of terminalizing an unknown outcome.
    await expect(
      sendManualOrderDocument({ supabase: db.client, row })
    ).rejects.toThrow('order changed before dispatch');
    expect(
      db.rpc.mock.calls.some(
        ([fn]) => fn === 'mark_manual_document_dispatch_started'
      )
    ).toBe(true);
  });

  it('does not label an underpaid order as a fully paid receipt', async () => {
    const db = database({ amount_paid: 100000 });
    expect(await sendManualOrderDocument({ supabase: db.client, row })).toEqual(
      { status: 'skipped', reason: 'paid_balance_outstanding' }
    );
    expect(sendEmail).not.toHaveBeenCalled();
    expect(db.rpc.mock.calls.map(([fn]) => fn)).toEqual([
      'get_manual_order_document_snapshot',
    ]);
  });

  it('treats a fully-covered partial balance as a paid receipt', async () => {
    const db = database({
      payment_status: 'partially_paid',
      amount_paid: 950000,
      payment_method: 'invoice',
    });
    await sendManualOrderDocument({ supabase: db.client, row });
    const message = sendEmail.mock.calls[0][0];
    expect(message.subject).toBe('Your receipt is ready - #ORD-42');
    const pdf = Buffer.from(message.attachments[0].content, 'base64').toString(
      'latin1'
    );
    expect(pdf).toContain('RECEIPT');
    expect(pdf).not.toContain('PROFORMA');
  });

  it('skips an obsolete invoice if the partial balance is now covered', async () => {
    const db = database({
      payment_status: 'partially_paid',
      amount_paid: 950000,
    });
    expect(
      await sendManualOrderDocument({
        supabase: db.client,
        row: { ...row, event_type: 'manual_order_invoice' },
      })
    ).toMatchObject({ status: 'skipped' });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('records the accepted token before failing on a mid-send reset', async () => {
    const db = database({}, { dispatchLeaseReset: true });
    const result = await sendManualOrderDocument({ supabase: db.client, row });
    // The provider accepted the mail, so the token must be recorded as
    // delivered even though the send fails for corrective retry — later
    // rotations must not orphan the link the customer already holds.
    expect(result).toEqual({
      status: 'failed',
      error: 'document_changed_during_send',
    });
    const claimCall = db.rpc.mock.calls.find(
      ([fn]) => fn === 'create_manual_order_document_claim'
    );
    const markCall = db.rpc.mock.calls.find(
      ([fn]) => fn === 'mark_manual_document_claim_sent'
    );
    expect(markCall?.[1]).toMatchObject({
      p_claim_id: 'claim-1',
      p_mailed_token_hash: claimCall?.[1].p_token_hash,
    });
  });

  it('records the accepted token before failing on a lease read error', async () => {
    const db = database({}, { dispatchLeaseError: true });
    const result = await sendManualOrderDocument({ supabase: db.client, row });
    expect(result).toEqual({
      status: 'failed',
      error: 'dispatch_lease_check_failed',
      deliveryOutcome: 'unknown',
    });
    expect(
      db.rpc.mock.calls.some(([fn]) => fn === 'mark_manual_document_claim_sent')
    ).toBe(true);
  });

  it('fails unknown when the accepted-token record fails after a reset', async () => {
    const db = database(
      {},
      { dispatchLeaseReset: true, claimMarkerError: true }
    );
    const result = await sendManualOrderDocument({ supabase: db.client, row });
    expect(result).toEqual({
      status: 'failed',
      error: 'sent_claim_marker_failed',
      deliveryOutcome: 'unknown',
    });
  });
});
