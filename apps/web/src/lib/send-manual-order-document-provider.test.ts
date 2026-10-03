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

describe('send manual order document provider and validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendEmail.mockImplementation(async (message) => {
      await message.beforeTransportDispatch?.();
      return { success: true, messageId: 'message-1' };
    });
  });

  it('preserves an indeterminate provider outcome so the worker cannot retry it', async () => {
    const db = database();
    sendEmail.mockResolvedValueOnce({
      success: false,
      deliveryOutcome: 'unknown',
      error: 'timeout',
    });
    expect(
      await sendManualOrderDocument({ supabase: db.client, row })
    ).toMatchObject({ status: 'failed', deliveryOutcome: 'unknown' });
  });

  it.each([
    { claimMarkerError: true },
    { claimMarkerThrows: true },
  ])('does not retry an accepted email if the claim marker fails %j', async (options) => {
    const db = database({}, options);
    expect(
      await sendManualOrderDocument({ supabase: db.client, row })
    ).toMatchObject({ status: 'failed', deliveryOutcome: 'unknown' });
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it('does not retry a thrown transport error after dispatch starts', async () => {
    const db = database();
    sendEmail.mockImplementationOnce(async (message) => {
      await message.beforeTransportDispatch();
      throw new Error('response lost');
    });
    expect(
      await sendManualOrderDocument({ supabase: db.client, row })
    ).toMatchObject({ status: 'failed', deliveryOutcome: 'unknown' });
  });

  it('does not cross the provider boundary with a lost lease', async () => {
    const db = database({}, { dispatchStatus: 'lease_lost' });
    const provider = vi.fn();
    sendEmail.mockImplementationOnce(async (message) => {
      await message.beforeTransportDispatch();
      provider();
      return { success: true };
    });
    await expect(
      sendManualOrderDocument({ supabase: db.client, row })
    ).rejects.toThrow('lease lost');
    expect(provider).not.toHaveBeenCalled();
  });

  it('leaves definite rejected sends retryable', async () => {
    const db = database();
    sendEmail.mockImplementationOnce(async (message) => {
      await message.beforeTransportDispatch();
      await message.resetTransportDispatch();
      return { success: false, error: 'provider rejected' };
    });
    expect(await sendManualOrderDocument({ supabase: db.client, row })).toEqual(
      { status: 'failed', error: 'provider rejected' }
    );
  });

  it('clears the dispatch marker after a definite provider rejection', async () => {
    const db = database();
    sendEmail.mockImplementationOnce(async (message) => {
      await message.beforeTransportDispatch();
      return { success: false, error: 'provider rejected' };
    });
    expect(await sendManualOrderDocument({ supabase: db.client, row })).toEqual(
      { status: 'failed', error: 'provider rejected' }
    );
    expect(db.updates).toContainEqual({
      table: 'order_notification_outbox',
      values: expect.objectContaining({ dispatch_started_at: null }),
    });
  });

  it('stays retryable when the marker clear fails after a definite rejection', async () => {
    const db = database({}, { dispatchLeaseError: true });
    sendEmail.mockImplementationOnce(async (message) => {
      await message.beforeTransportDispatch();
      return { success: false, error: 'provider rejected' };
    });
    // No deliveryOutcome: the rejection is definite, so the bounded retry
    // path (which re-clears before sending) stays open.
    expect(await sendManualOrderDocument({ supabase: db.client, row })).toEqual(
      { status: 'failed', error: 'dispatch_marker_clear_failed' }
    );
    expect(db.updates).toContainEqual({
      table: 'order_notification_outbox',
      values: expect.objectContaining({ dispatch_started_at: null }),
    });
  });

  it('keeps the dispatch marker after an indeterminate provider outcome', async () => {
    const db = database();
    sendEmail.mockImplementationOnce(async (message) => {
      await message.beforeTransportDispatch();
      return { success: false, deliveryOutcome: 'unknown', error: 'timeout' };
    });
    expect(await sendManualOrderDocument({ supabase: db.client, row })).toEqual(
      { status: 'failed', error: 'timeout', deliveryOutcome: 'unknown' }
    );
    expect(db.updates).not.toContainEqual(
      expect.objectContaining({
        table: 'order_notification_outbox',
        values: expect.objectContaining({ dispatch_started_at: null }),
      })
    );
  });

  it('never promotes Ogabassey app links for another merchant', async () => {
    const db = database(
      {},
      {
        merchantOverride: {
          slug: 'another-shop',
          business_name: 'Another Shop',
        },
        primaryDomain: 'shop.example.com',
      }
    );
    await sendManualOrderDocument({ supabase: db.client, row });
    expect(sendEmail.mock.calls[0][0].htmlContent).toContain(
      'shop.example.com/receipts/claim/'
    );
    expect(sendEmail.mock.calls[0][0].htmlContent).not.toContain(
      'apps.apple.com'
    );
    expect(sendEmail.mock.calls[0][0].htmlContent).not.toContain(
      'play.google.com'
    );
  });

  it('skips without throwing when the order row fails validation', async () => {
    const db = database({ total: -5 });
    const result = await sendManualOrderDocument({
      supabase: db.client,
      row,
    });
    expect(result).toEqual({
      status: 'skipped',
      reason: 'order_validation_failed',
    });
    expect(db.rpc).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('skips without throwing when the merchant row fails validation', async () => {
    const db = database({}, { merchantOverride: { slug: 123 } });
    const result = await sendManualOrderDocument({
      supabase: db.client,
      row,
    });
    expect(result).toEqual({
      status: 'skipped',
      reason: 'merchant_validation_failed',
    });
    expect(db.rpc).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('sends with default branding when merchant brand colors are malformed', async () => {
    const db = database({}, { merchantOverride: { brand_colors: '{}' } });
    const result = await sendManualOrderDocument({
      supabase: db.client,
      row,
    });
    expect(result.status).toBe('sent');
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it('throws for retry when the receipt-date lookup fails', async () => {
    const db = database({}, { transactionsError: { message: 'db down' } });
    await expect(
      sendManualOrderDocument({ supabase: db.client, row })
    ).rejects.toThrow('Manual document receipt date unavailable');
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('skips without throwing when the claim payload fails validation', async () => {
    const db = database();
    db.rpc.mockResolvedValueOnce({ data: { status: 'bogus' }, error: null });
    const result = await sendManualOrderDocument({
      supabase: db.client,
      row,
    });
    expect(result).toEqual({
      status: 'skipped',
      reason: 'claim_validation_failed',
    });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('skips legacy shipping-status spellings without sending', async () => {
    const db = database({ shipping_status: '  CANCELED  ' });
    const result = await sendManualOrderDocument({ supabase: db.client, row });
    expect(result).toEqual({
      status: 'skipped',
      reason: 'ineligible_manual_order',
    });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('sends a receipt for legacy payment-status spellings', async () => {
    const db = database({ payment_status: ' Paid ' });
    const result = await sendManualOrderDocument({ supabase: db.client, row });
    expect(result.status).toBe('sent');
    expect(sendEmail.mock.calls[0][0].subject).toBe(
      'Your receipt is ready - #ORD-42'
    );
  });

  it('folds internal whitespace in legacy payment statuses like the trigger', async () => {
    const db = database({ payment_status: 'Partially Paid' });
    const result = await sendManualOrderDocument({ supabase: db.client, row });
    expect(result.status).toBe('sent');
    expect(sendEmail.mock.calls[0][0].subject).toBe(
      'Your receipt is ready - #ORD-42'
    );
  });

  it.each([
    '',
    '   ',
  ])('treats a blank external source as a manual order', async (external_source) => {
    const db = database({ external_source });
    const result = await sendManualOrderDocument({ supabase: db.client, row });
    expect(result.status).toBe('sent');
  });

  it('omits a malformed legacy support address instead of failing the send', async () => {
    const db = database(
      {},
      { merchantOverride: { support_email: 'not-an-email' } }
    );
    const result = await sendManualOrderDocument({ supabase: db.client, row });
    expect(result.status).toBe('sent');
    expect(sendEmail.mock.calls[0][0].replyTo).toBeUndefined();
  });

  it('passes a valid support address as the reply target', async () => {
    const db = database();
    await sendManualOrderDocument({ supabase: db.client, row });
    expect(sendEmail.mock.calls[0][0].replyTo).toBe('support@ogabassey.com');
  });
});
