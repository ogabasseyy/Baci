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

// Split from send-manual-order-document.test.ts (300-line gate): the
// receipt/invoice dating scenarios live here.
describe('send manual order document dating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendEmail.mockImplementation(async (message) => {
      await message.beforeTransportDispatch?.();
      return { success: true, messageId: 'message-1' };
    });
  });

  it('uses the order date for legacy invoices without a persisted issue date', async () => {
    const db = database({
      payment_status: 'unpaid',
      amount_paid: 0,
      invoice_issue_date: null,
      payment_due_date: null,
      payment_terms: null,
      buyer_reference: null,
      firs_irn: null,
      firs_csid: null,
    });
    await sendManualOrderDocument({
      supabase: db.client,
      row: { ...row, event_type: 'manual_order_invoice' },
    });
    const attachment = sendEmail.mock.calls[0][0].attachments[0];
    // Fixture: issue date null, transaction 28 Sept, created 30 Sept — the
    // emailed invoice must match the download's issue ?? transaction chain.
    expect(
      Buffer.from(attachment.content, 'base64').toString('latin1')
    ).toContain('28 Sept 2026');
  });

  it('dates later-payment receipts from the completing transaction', async () => {
    const db = database(
      {},
      {
        paymentHistory: [
          {
            id: 'txn-9',
            amount: 950000,
            created_at: '2026-09-29T12:00:00Z',
            description: null,
            metadata: null,
            status: 'completed',
            transaction_type: 'payment',
          },
        ],
      }
    );
    await sendManualOrderDocument({ supabase: db.client, row });
    const pdf = Buffer.from(
      sendEmail.mock.calls[0][0].attachments[0].content,
      'base64'
    ).toString('latin1');
    expect(pdf).toContain('29 Sept 2026');
  });
});
