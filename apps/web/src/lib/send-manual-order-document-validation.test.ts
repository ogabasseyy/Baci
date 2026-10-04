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

describe('send manual order document child-row validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips an invoice whose VAT breakdown holds negative money', async () => {
    const db = database(
      {
        payment_status: 'partially_paid',
        amount_paid: 100000,
        invoice_issue_date: '2026-09-26',
      },
      {
        taxSubtotals: [
          {
            id: 'tax-1',
            vat_category_code: 'S',
            vat_rate: -7.5,
            taxable_amount: 883721,
            tax_amount: 66279,
            exemption_reason: null,
          },
        ],
      }
    );

    const result = await sendManualOrderDocument({
      supabase: db.client,
      row: { ...row, event_type: 'manual_order_invoice' },
    });

    // Deterministic shape failure: skip (later triggers re-arm), never email.
    expect(result).toEqual({
      status: 'skipped',
      reason: 'tax_breakdown_invalid',
    });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('skips a receipt whose settled payment holds a negative amount', async () => {
    const db = database(
      {},
      {
        paymentHistory: [
          {
            id: 'txn-1',
            amount: -50000,
            created_at: '2026-09-29T09:00:00Z',
            description: null,
            metadata: null,
          },
        ],
      }
    );

    const result = await sendManualOrderDocument({
      supabase: db.client,
      row,
    });

    expect(result).toEqual({
      status: 'skipped',
      reason: 'payment_history_invalid',
    });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('sends when an unsafe legacy slug is rescued by a custom domain', async () => {
    sendEmail.mockImplementation(async (message) => {
      await message.beforeTransportDispatch?.();
      return { success: true, messageId: 'message-1' };
    });
    const db = database(
      {},
      {
        merchantOverride: { slug: 'Legacy Slug With Spaces!' },
        primaryDomain: 'shop.example.com',
      }
    );

    const result = await sendManualOrderDocument({
      supabase: db.client,
      row,
    });

    expect(result.status).toBe('sent');
    expect(sendEmail.mock.calls[0][0].textContent).toContain(
      'https://shop.example.com/receipts/claim/'
    );
  });

  it('sends when a null slug is rescued by a custom domain', async () => {
    sendEmail.mockImplementation(async (message) => {
      await message.beforeTransportDispatch?.();
      return { success: true, messageId: 'message-1' };
    });
    const db = database(
      {},
      { merchantOverride: { slug: null }, primaryDomain: 'shop.example.com' }
    );

    const result = await sendManualOrderDocument({
      supabase: db.client,
      row,
    });

    expect(result.status).toBe('sent');
    expect(sendEmail.mock.calls[0][0].textContent).toContain(
      'https://shop.example.com/receipts/claim/'
    );
  });

  it('skips a null slug only when the fallback must supply the host', async () => {
    const db = database({}, { merchantOverride: { slug: null } });

    const result = await sendManualOrderDocument({
      supabase: db.client,
      row,
    });

    expect(result).toEqual({
      status: 'skipped',
      reason: 'merchant_validation_failed',
    });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('skips an unsafe slug only when the fallback must supply the host', async () => {
    const db = database(
      {},
      { merchantOverride: { slug: 'Legacy Slug With Spaces!' } }
    );

    const result = await sendManualOrderDocument({
      supabase: db.client,
      row,
    });

    expect(result).toEqual({
      status: 'skipped',
      reason: 'merchant_validation_failed',
    });
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
