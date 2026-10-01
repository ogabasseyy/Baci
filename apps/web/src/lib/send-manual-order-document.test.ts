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

describe('send manual order document', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendEmail.mockImplementation(async (message) => {
      await message.beforeTransportDispatch?.();
      return { success: true, messageId: 'message-1' };
    });
  });

  it('sends a real PDF receipt, a claim link and tenant-scoped email audit metadata', async () => {
    const db = database();
    const result = await sendManualOrderDocument({ supabase: db.client, row });
    expect(result.status).toBe('sent');
    expect(db.filters).toMatchObject({
      'orders.id': 'order-1',
      'orders.merchant_id': 'merchant-1',
      'merchants.id': 'merchant-1',
    });
    const message = sendEmail.mock.calls[0][0];
    expect(message.to).toBe('ada@example.com');
    expect(message.subject).toBe('Your receipt is ready - #ORD-42');
    expect(message.htmlContent).toMatch(
      /https:\/\/ogabassey.com\/receipts\/claim\/[a-f0-9]{64}/
    );
    expect(message.auditContext).toMatchObject({
      merchantId: 'merchant-1',
      orderId: 'order-1',
      customerId: 'customer-1',
    });
    const attachment = message.attachments[0];
    expect(attachment).toMatchObject({
      name: 'receipt-ORD-42.pdf',
      mime_type: 'application/pdf',
    });
    const pdf = Buffer.from(attachment.content, 'base64').toString('latin1');
    expect(pdf.startsWith('%PDF-')).toBe(true);
    expect(pdf).toContain('RECEIPT');
    expect(pdf).toContain('28 Sept 2026');
    expect(pdf).toContain('Pixel 10 Pro XL');
    const hash = db.rpc.mock.calls[0][1].p_token_hash;
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(message.htmlContent).not.toContain(hash);
  });

  it('attaches an invoice rather than a paid receipt for a partial manual order', async () => {
    const db = database({
      payment_status: 'partially_paid',
      amount_paid: 100000,
      invoice_issue_date: '2026-09-26',
    });
    await sendManualOrderDocument({
      supabase: db.client,
      row: { ...row, event_type: 'manual_order_invoice' },
    });
    const message = sendEmail.mock.calls[0][0];
    expect(message.subject).toBe('Your invoice is ready - #ORD-42');
    const pdf = Buffer.from(message.attachments[0].content, 'base64').toString(
      'latin1'
    );
    expect(pdf).toContain('INVOICE');
    expect(pdf).toContain('26 Sept 2026');
    expect(message.textContent).toMatch(/not.*proof of payment/i);
  });

  it('uses the order date for legacy invoices without a persisted issue date', async () => {
    const db = database({
      payment_status: 'unpaid',
      amount_paid: 0,
      invoice_issue_date: null,
    });
    await sendManualOrderDocument({
      supabase: db.client,
      row: { ...row, event_type: 'manual_order_invoice' },
    });
    const attachment = sendEmail.mock.calls[0][0].attachments[0];
    expect(
      Buffer.from(attachment.content, 'base64').toString('latin1')
    ).toContain('30 Sept 2026');
  });

  it.each([
    { customer_email: null },
    { recorded_by_user_id: null },
    { import_job_id: 'import-1' },
    { shipping_status: 'cancelled' },
    { merchant_id: 'another-merchant' },
  ])('does not send or create claims for ineligible data %j', async (override) => {
    const db = database(override);
    await sendManualOrderDocument({ supabase: db.client, row });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('retries an incomplete order without sending a document with no items', async () => {
    const db = database({ order_items: [] });
    await expect(
      sendManualOrderDocument({ supabase: db.client, row })
    ).rejects.toThrow('Manual order items unavailable');
    expect(sendEmail).not.toHaveBeenCalled();
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
    const db = database();
    db.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'unavailable' },
    });
    await expect(
      sendManualOrderDocument({ supabase: db.client, row })
    ).rejects.toThrow();
    expect(sendEmail).not.toHaveBeenCalled();
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
    const db = database({}, { dispatchMissing: true });
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
    expect(db.filters['order_notification_outbox.dispatch_started_at']).toBe(
      null
    );
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

  it('requires a claim ID before sending', async () => {
    const db = database();
    db.rpc.mockResolvedValueOnce({ data: { status: 'created' }, error: null });
    await expect(
      sendManualOrderDocument({ supabase: db.client, row })
    ).rejects.toThrow();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('does not send a stale PDF/recipient if the customer changed during claim preparation', async () => {
    const db = database();
    db.rpc.mockResolvedValueOnce({
      data: {
        status: 'created',
        claim_id: 'claim-1',
        customer_id: 'customer-2',
        customer_email: 'another@example.com',
      },
      error: null,
    });
    await expect(
      sendManualOrderDocument({ supabase: db.client, row })
    ).rejects.toThrow('recipient changed');
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('does not label an underpaid order as a fully paid receipt', async () => {
    const db = database({ amount_paid: 100000 });
    await expect(
      sendManualOrderDocument({ supabase: db.client, row })
    ).rejects.toThrow('outstanding balance');
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('never promotes Ogabassey app links for another merchant', async () => {
    const db = database(
      {},
      {
        merchantOverride: {
          slug: 'another-shop',
          business_name: 'Another Shop',
          custom_domain: 'shop.example.com',
        },
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
});
