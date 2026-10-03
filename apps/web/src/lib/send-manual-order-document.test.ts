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
      /https:\/\/ogabassey.usebaci.com\/receipts\/claim\/[a-f0-9]{64}/
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

  it('renders invoice-method orders as proforma like the account invoice view', async () => {
    const db = database({
      payment_status: 'unpaid',
      amount_paid: 0,
      payment_method: 'invoice',
    });
    await sendManualOrderDocument({
      supabase: db.client,
      row: { ...row, event_type: 'manual_order_invoice' },
    });
    const message = sendEmail.mock.calls[0][0];
    expect(message.subject).toBe('Your proforma invoice is ready - #ORD-42');
    expect(message.attachments[0].name).toBe('proforma_invoice-ORD-42.pdf');
    const pdf = Buffer.from(message.attachments[0].content, 'base64').toString(
      'latin1'
    );
    expect(pdf).toContain('PROFORMA INVOICE');
  });

  it('attaches the assigned virtual account to invoice payment instructions', async () => {
    const db = database(
      { payment_status: 'unpaid', amount_paid: 0 },
      {
        paymentAccounts: [
          {
            account_number: '9988776655',
            bank_name: 'Test Bank',
            account_name: 'Ogabassey Collections',
            assigned_at: '2026-09-30T09:00:00Z',
            expires_at: null,
            revoked_at: null,
            archived_at: null,
          },
        ],
      }
    );
    await sendManualOrderDocument({
      supabase: db.client,
      row: { ...row, event_type: 'manual_order_invoice' },
    });
    const message = sendEmail.mock.calls[0][0];
    const pdf = Buffer.from(message.attachments[0].content, 'base64').toString(
      'latin1'
    );
    expect(pdf).toContain('9988776655');
    expect(pdf).toContain('Test Bank');
  });

  it('retries invoices when the payment account lookup fails', async () => {
    const db = database(
      { payment_status: 'unpaid', amount_paid: 0 },
      {
        paymentAccountError: { message: 'timeout' },
      }
    );
    await expect(
      sendManualOrderDocument({
        supabase: db.client,
        row: { ...row, event_type: 'manual_order_invoice' },
      })
    ).rejects.toThrow('Manual document payment account unavailable');
    expect(sendEmail).not.toHaveBeenCalled();
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

  it('brands the claim link with the active primary domain', async () => {
    const db = database({}, { primaryDomain: 'shop.example.com' });
    await sendManualOrderDocument({ supabase: db.client, row });
    expect(sendEmail.mock.calls[0][0].textContent).toContain(
      'https://shop.example.com/receipts/claim/'
    );
  });

  it('falls back to the slug subdomain without a primary domain', async () => {
    const db = database();
    await sendManualOrderDocument({ supabase: db.client, row });
    expect(sendEmail.mock.calls[0][0].textContent).toContain(
      'https://ogabassey.usebaci.com/receipts/claim/'
    );
  });

  it('sends with a fallback greeting when the order has no customer name', async () => {
    const db = database({ customer_name: null });
    const result = await sendManualOrderDocument({ supabase: db.client, row });
    expect(result.status).toBe('sent');
    const message = sendEmail.mock.calls[0][0];
    expect(message.textContent).toContain('Hello there,');
    expect(message.toName).toBe('there');
  });

  it('strips line breaks from header-adjacent display names', async () => {
    const db = database(
      { customer_name: 'Oga\r\nBcc: smuggled@example.com' },
      { merchantOverride: { email_sender_name: 'Shop\r\nBcc: x@y.z' } }
    );
    const result = await sendManualOrderDocument({ supabase: db.client, row });
    expect(result.status).toBe('sent');
    const message = sendEmail.mock.calls[0][0];
    expect(message.toName).toBe('OgaBcc: smuggled@example.com');
    expect(message.fromName).toBe('ShopBcc: x@y.z');
  });

  it('keeps the private merchant email out of customer-visible copy', async () => {
    const db = database({}, { merchantOverride: { support_email: null } });
    await sendManualOrderDocument({ supabase: db.client, row });
    const message = sendEmail.mock.calls[0][0];
    expect(message.textContent).toContain('the store team');
    expect(message.htmlContent).toContain('the store team');
    expect(message.textContent).not.toContain('hello@ogabassey.com');
    expect(message.htmlContent).not.toContain('hello@ogabassey.com');
    expect(message.replyTo).toBeUndefined();
  });

  it('suppresses naira bank details on foreign-currency invoices', async () => {
    const bankedMerchant = {
      bank_code: '044',
      bank_account_number: '1234567890',
      bank_name: 'Test Bank',
      bank_account_name: 'Ogabassey',
    };
    const ngn = database(
      { payment_status: 'unpaid', amount_paid: 0, currency: 'NGN' },
      { merchantOverride: bankedMerchant }
    );
    await sendManualOrderDocument({
      supabase: ngn.client,
      row: { ...row, event_type: 'manual_order_invoice' },
    });
    const ngnPdf = Buffer.from(
      sendEmail.mock.calls[0][0].attachments[0].content,
      'base64'
    ).toString('latin1');
    expect(ngnPdf).toContain('1234567890');

    sendEmail.mockClear();
    const usd = database(
      { payment_status: 'unpaid', amount_paid: 0, currency: 'USD' },
      { merchantOverride: bankedMerchant }
    );
    await sendManualOrderDocument({
      supabase: usd.client,
      row: { ...row, event_type: 'manual_order_invoice' },
    });
    const usdPdf = Buffer.from(
      sendEmail.mock.calls[0][0].attachments[0].content,
      'base64'
    ).toString('latin1');
    expect(usdPdf).not.toContain('1234567890');
    expect(usdPdf).not.toContain('Test Bank');
  });

  it('dates later-payment receipts from the completing transaction', async () => {
    const db = database({}, { latestPaymentAt: '2026-09-29T12:00:00Z' });
    await sendManualOrderDocument({ supabase: db.client, row });
    const pdf = Buffer.from(
      sendEmail.mock.calls[0][0].attachments[0].content,
      'base64'
    ).toString('latin1');
    expect(pdf).toContain('29 Sept 2026');
  });
});
