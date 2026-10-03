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

describe('send manual order document dispatch snapshots', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendEmail.mockImplementation(async (message) => {
      await message.beforeTransportDispatch?.();
      return { success: true, messageId: 'message-1' };
    });
  });

  it('snapshots the rendered kind in the dispatch marker', async () => {
    const db = database();
    await sendManualOrderDocument({ supabase: db.client, row });
    const markCall = db.rpc.mock.calls.find(
      ([fn]) => fn === 'mark_manual_document_dispatch_started'
    );
    expect(markCall?.[1]).toMatchObject({ p_document_kind: 'receipt' });
  });

  it('snapshots the resolved claim-link host in the dispatch marker', async () => {
    const db = database({}, { primaryDomain: 'shop.example.com' });
    await sendManualOrderDocument({ supabase: db.client, row });
    const markCall = db.rpc.mock.calls.find(
      ([fn]) => fn === 'mark_manual_document_dispatch_started'
    );
    expect(markCall?.[1]).toMatchObject({
      p_claim_domain: 'shop.example.com',
    });
  });

  it('snapshots the rendered payment instructions in the dispatch marker', async () => {
    const db = database(
      { payment_status: 'partially_paid', amount_paid: 100000 },
      {
        merchantOverride: {
          bank_code: '058',
          bank_account_number: '1234567890',
          bank_name: 'GTBank',
          bank_account_name: 'Shop Ltd',
        },
      }
    );
    await sendManualOrderDocument({
      supabase: db.client,
      row: { ...row, event_type: 'manual_order_invoice' },
    });
    const markCall = db.rpc.mock.calls.find(
      ([fn]) => fn === 'mark_manual_document_dispatch_started'
    );
    expect(markCall?.[1]).toMatchObject({
      p_merchant_bank_code: '058',
      p_merchant_bank_account_number: '1234567890',
      p_merchant_bank_name: 'GTBank',
      p_merchant_bank_account_name: 'Shop Ltd',
      p_va_account_number: null,
      p_va_bank_name: null,
      p_va_account_name: null,
    });
  });

  it('snapshots the rendered tax breakdown in the dispatch marker', async () => {
    const db = database(
      {},
      {
        taxSubtotals: [
          {
            id: 'tax-2',
            vat_category_code: 'E',
            vat_rate: 0,
            taxable_amount: 50000,
            tax_amount: 0,
            exemption_reason: 'exports',
          },
          {
            id: 'tax-1',
            vat_category_code: 'S',
            vat_rate: 7.5,
            taxable_amount: 100000,
            tax_amount: 7500,
            exemption_reason: null,
          },
        ],
      }
    );
    await sendManualOrderDocument({ supabase: db.client, row });
    const markCall = db.rpc.mock.calls.find(
      ([fn]) => fn === 'mark_manual_document_dispatch_started'
    );
    expect(markCall?.[1]).toMatchObject({
      p_tax_count: 2,
      p_tax_subtotals: [
        {
          vat_category_code: 'S',
          vat_rate: 7.5,
          taxable_amount: 100000,
          tax_amount: 7500,
          exemption_reason: null,
        },
        {
          vat_category_code: 'E',
          vat_rate: 0,
          taxable_amount: 50000,
          tax_amount: 0,
          exemption_reason: 'exports',
        },
      ],
    });
  });

  it('snapshots the rendered payment history in the dispatch marker', async () => {
    const db = database(
      {},
      {
        paymentHistory: [
          {
            id: 'txn-2',
            amount: 450000,
            created_at: '2026-09-30T09:00:00Z',
            description: 'balance',
            metadata: null,
          },
          {
            id: 'txn-1',
            amount: 500000,
            created_at: '2026-09-29T09:00:00Z',
            description: null,
            metadata: { payment_method: 'bank_transfer' },
          },
        ],
      }
    );
    await sendManualOrderDocument({ supabase: db.client, row });
    const markCall = db.rpc.mock.calls.find(
      ([fn]) => fn === 'mark_manual_document_dispatch_started'
    );
    expect(markCall?.[1]).toMatchObject({
      p_txn_count: 2,
      p_transactions: [
        {
          amount: 500000,
          created_at: '2026-09-29T09:00:00Z',
          description: null,
          metadata: { payment_method: 'bank_transfer' },
        },
        {
          amount: 450000,
          created_at: '2026-09-30T09:00:00Z',
          description: 'balance',
          metadata: null,
        },
      ],
    });
  });
});
