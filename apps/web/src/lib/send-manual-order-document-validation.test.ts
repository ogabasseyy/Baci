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
});
