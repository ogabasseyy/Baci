import { describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { useReceiptPreview } from './use-receipt-preview';

let mockReceiptDetail: Record<string, unknown> | null = null;

jest.mock('./use-receipts', () => ({
  useMerchantReceiptInfo: () => ({
    data: {
      business_name: 'Baci Store',
      logo_url: null,
      email: 'merchant@example.com',
      phone: null,
      support_email: null,
      support_phone: null,
      business_address: null,
      cac_rc_number: null,
      tax_identification_number: null,
      legal_entity_name: null,
      brand_colors: null,
      vat_registration_status: null,
      vat_rate: null,
      bank_code: '999',
      bank_account_number: '1234567890',
      bank_name: 'Baci Bank',
      bank_account_name: 'Baci Store Ltd',
      social_media: null,
      pages: null,
    },
  }),
  useReceiptDetail: () => ({ data: mockReceiptDetail }),
}));

import { coveredManualDetail } from './use-receipt-preview.test-fixture';

describe('useReceiptPreview manual promotion', () => {
  it('opens a covered manual balance as the emailed receipt', () => {
    // Staff-recorded orders keep non-paid labels despite full coverage;
    // the app link on the emailed receipt must open a receipt, not an
    // invoice (mirrors web isReceiptEligible).
    mockReceiptDetail = coveredManualDetail();
    const covered = renderHook(() => useReceiptPreview());
    act(() => {
      covered.result.current.openPreviewByOrderId('order-1');
    });
    expect(covered.result.current.documentKind).toBe('receipt');
    expect(covered.result.current.html).toContain(
      '<div class="doc-title">Receipt</div>'
    );
  });

  it.each([
    ['cancelled shipping', { shipping_status: 'cancelled' }],
    ['unknown payment status', { payment_status: 'on_hold' }],
    ['negative total', { total: -5, amount_paid: 0 }],
    ['no items', { items: [] }],
    ['null money the sender skips', { total: 0, amount_paid: null }],
    ['NaN money breakdown', { subtotal: Number.NaN }],
  ])('fails a covered manual balance closed on %s', (_label, override) => {
    // The balance alone never promotes: ineligible manual rows preview
    // as invoices like the sender, archive, and download routes treat them.
    mockReceiptDetail = coveredManualDetail(override);
    const preview = renderHook(() => useReceiptPreview());
    act(() => {
      preview.result.current.openPreviewByOrderId('order-1');
    });
    expect(preview.result.current.documentKind).not.toBe('receipt');
  });

  it('opens a null-currency covered manual balance as the emailed receipt', () => {
    // Web content validity allows nullish currency, so the sender emails
    // a receipt; the app link must open the same kind, not an invoice.
    mockReceiptDetail = coveredManualDetail({ currency: null });
    const preview = renderHook(() => useReceiptPreview());
    act(() => {
      preview.result.current.openPreviewByOrderId('order-1');
    });
    expect(preview.result.current.documentKind).toBe('receipt');
  });

  it('opens a covered manual balance with a null customer name as a receipt', () => {
    // The sender permits a null name (display fallback); content validity
    // covers money and items only, so promotion must not depend on it.
    mockReceiptDetail = coveredManualDetail({ customer_name: null });
    const preview = renderHook(() => useReceiptPreview());
    act(() => {
      preview.result.current.openPreviewByOrderId('order-1');
    });
    expect(preview.result.current.documentKind).toBe('receipt');
  });

  it('counts numeric-string money like web coercion', () => {
    // PostgREST can deliver numerics as strings; the sender coerces them,
    // so a fully-covered string-money balance is still a receipt.
    mockReceiptDetail = coveredManualDetail({
      total: '500',
      amount_paid: '500',
      subtotal: '500',
    });
    const preview = renderHook(() => useReceiptPreview());
    act(() => {
      preview.result.current.openPreviewByOrderId('order-1');
    });
    expect(preview.result.current.documentKind).toBe('receipt');
  });

  it.each([
    ['null item entry', { items: [null] }],
    ['numeric provenance marker', { external_source: 7 }],
    ['numeric import marker', { import_job_id: 42 }],
    ['numeric payment status', { payment_status: 7 }],
    ['numeric shipping status', { shipping_status: 3 }],
  ])('fails closed without crashing on %s', (_label, override) => {
    // The warn-only fetch can hand back unvalidated shapes; corrupt rows
    // must preview as invoices, never crash the render.
    mockReceiptDetail = coveredManualDetail(override);
    const preview = renderHook(() => useReceiptPreview());
    act(() => {
      preview.result.current.openPreviewByOrderId('order-1');
    });
    expect(preview.result.current.documentKind).not.toBe('receipt');
  });

  it('skips unparseable timestamps when dating a promoted receipt', () => {
    mockReceiptDetail = coveredManualDetail({
      transactions: [
        {
          amount: 500,
          created_at: 'not-a-timestamp',
          description: null,
          metadata: null,
          status: 'completed',
          transaction_type: 'payment',
        },
        {
          amount: 500,
          created_at: '2026-09-30T09:00:00.000Z',
          description: null,
          metadata: null,
          status: 'completed',
          transaction_type: 'payment',
        },
      ],
    });
    const preview = renderHook(() => useReceiptPreview());
    act(() => {
      preview.result.current.openPreviewByOrderId('order-1');
    });
    const expected = new Date('2026-09-30T09:00:00.000Z').toLocaleDateString(
      'en-GB',
      {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'Africa/Lagos',
      }
    );
    expect(preview.result.current.documentKind).toBe('receipt');
    expect(preview.result.current.html).toContain(expected);
  });

  it('itemizes the assurance premium on a promoted receipt', () => {
    // The premium rolls into the total: without its own line the visible
    // lines would not reconcile, unlike the emailed PDF and download.
    mockReceiptDetail = coveredManualDetail({
      total: 550,
      amount_paid: 550,
      subtotal: 550,
      items: [
        {
          id: 'item-1',
          name: 'Device',
          product_name: 'Device',
          quantity: 1,
          price: 500,
          assurance_fee: 50,
        },
      ],
    });
    const preview = renderHook(() => useReceiptPreview());
    act(() => {
      preview.result.current.openPreviewByOrderId('order-1');
    });
    expect(preview.result.current.documentKind).toBe('receipt');
    expect(preview.result.current.html).toContain('Ogabassey Assurance');
  });

  it('dates a promoted receipt from the completing payment', () => {
    // The emailed PDF and account download date receipts by the latest
    // settled payment; a stale invoice issue date must not win here, and
    // a newer unsettled attempt must not move the date either.
    mockReceiptDetail = coveredManualDetail({
      invoice_issue_date: '2026-01-15',
      transaction_date: '2026-01-10T08:00:00.000Z',
      transactions: [
        {
          amount: 200,
          created_at: '2026-09-29T09:00:00.000Z',
          description: null,
          metadata: null,
          status: 'completed',
          transaction_type: 'payment',
        },
        {
          amount: 300,
          created_at: '2026-09-30T09:00:00.000Z',
          description: null,
          metadata: null,
          status: 'success',
          transaction_type: 'payment',
        },
        {
          amount: 999,
          created_at: '2026-10-05T09:00:00.000Z',
          description: null,
          metadata: null,
          status: 'pending',
          transaction_type: 'payment',
        },
      ],
    });
    const preview = renderHook(() => useReceiptPreview());
    act(() => {
      preview.result.current.openPreviewByOrderId('order-1');
    });
    const expected = new Date('2026-09-30T09:00:00.000Z').toLocaleDateString(
      'en-GB',
      {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'Africa/Lagos',
      }
    );
    expect(preview.result.current.documentKind).toBe('receipt');
    expect(preview.result.current.html).toContain(expected);
    expect(preview.result.current.html).not.toContain('15 Jan 2026');
  });
});
