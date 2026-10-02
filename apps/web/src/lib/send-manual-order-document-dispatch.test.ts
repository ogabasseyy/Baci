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
    expect(db.rpc).not.toHaveBeenCalled();
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

  it('requires a claim ID before sending', async () => {
    const db = database();
    db.rpc.mockResolvedValueOnce({ data: { status: 'created' }, error: null });
    await expect(
      sendManualOrderDocument({ supabase: db.client, row })
    ).resolves.toEqual({
      status: 'skipped',
      reason: 'claim_validation_failed',
    });
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
        order_total: 950000,
        order_amount_paid: 950000,
        order_item_count: 1,
        order_payment_status: 'paid',
      },
      error: null,
    });
    await expect(
      sendManualOrderDocument({ supabase: db.client, row })
    ).rejects.toThrow('recipient changed');
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('retries instead of dispatching when the order changed during preparation', async () => {
    const db = database();
    db.rpc.mockResolvedValueOnce({
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
    });
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

  it('snapshots the rendered kind in the dispatch marker', async () => {
    const db = database();
    await sendManualOrderDocument({ supabase: db.client, row });
    const markCall = db.rpc.mock.calls.find(
      ([fn]) => fn === 'mark_manual_document_dispatch_started'
    );
    expect(markCall?.[1]).toMatchObject({ p_document_kind: 'receipt' });
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
    expect(db.rpc).not.toHaveBeenCalled();
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
});
