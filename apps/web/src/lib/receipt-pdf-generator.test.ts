import { generateReceiptHtml } from '@baci/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHtmlToPdf } from '@/lib/receipt-html-to-pdf';
import { generateReceiptBlob } from '@/lib/receipt-pdf-generator';
import { receiptTestFactory } from '../../../../packages/shared/src/receipt/receipt-test-factory';

vi.mock('@/lib/receipt-html-to-pdf', () => ({ renderHtmlToPdf: vi.fn() }));
const order = receiptTestFactory.createReceiptOrder({
  payment_status: 'unpaid',
  amount_paid: 0,
  balance: 500000,
  virtual_account: {
    account_number: '1111111111',
    bank_name: 'Wema',
    account_name: 'Customer DVA',
  },
});
const merchant = receiptTestFactory.createReceiptMerchant({
  bank_name: 'GTBank',
  bank_account_name: 'Merchant Bank',
  bank_account_number: '2222222222',
  brand_colors: {
    primary: '#dc2626',
    background: '#ffffff',
    accent: '#eab308',
  },
});

describe('shared invoice PDF export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(renderHtmlToPdf).mockResolvedValue(
      new Uint8Array([37, 80, 68, 70])
    );
  });
  it('exports the exact admin HTML including both confirmation accounts and merchant colors', async () => {
    const blob = await generateReceiptBlob(order, merchant);
    expect(renderHtmlToPdf).toHaveBeenCalledWith(
      generateReceiptHtml(order, merchant)
    );
    const html = vi.mocked(renderHtmlToPdf).mock.calls[0][0];
    for (const value of [
      'Automatic Confirmation',
      'Manual Confirmation',
      '1111111111',
      '2222222222',
      '#dc2626',
    ])
      expect(html).toContain(value);
    expect(blob.type).toBe('application/pdf');
    expect(await blob.text()).toBe('%PDF');
  });
  it('exports paid invoices as invoices without collecting another payment', async () => {
    await generateReceiptBlob(
      { ...order, payment_status: 'paid', amount_paid: 500000, balance: 0 },
      merchant,
      { documentKind: 'invoice' }
    );
    const html = vi.mocked(renderHtmlToPdf).mock.calls[0][0];
    expect(html).toContain('class="doc-title">Invoice');
    expect(html).not.toContain('Automatic Confirmation');
    expect(html).not.toContain('Manual Confirmation');
  });
  it('retains proforma dates, registered address, taxes and escaped invoice metadata', async () => {
    await generateReceiptBlob(
      order,
      {
        ...merchant,
        registered_address: { street: '12 Marina Street', country: 'NG' },
      },
      {
        documentKind: 'proforma_invoice',
        documentDate: '2026-11-08',
        dueDate: '2026-11-10',
        invoiceNotes: '<script>note</script>',
        buyerReference: 'PO-42',
        paymentTerms: 'Due on receipt',
        firsIrn: 'IRN-42',
        firsCsid: 'CSID-42',
        complianceNote: 'UBL artifact attached',
        taxSubtotals: [
          {
            vat_category_code: 'S',
            vat_rate: 7.5,
            taxable_amount: 10000,
            tax_amount: 750,
          },
        ],
      }
    );
    const html = vi.mocked(renderHtmlToPdf).mock.calls[0][0];
    for (const value of [
      'Proforma Invoice',
      '8 Nov 2026',
      '10 Nov 2026',
      '12 Marina Street',
      'PO-42',
      'IRN-42',
      'CSID-42',
      'UBL artifact attached',
      '7.50%',
      '&lt;script&gt;note&lt;/script&gt;',
    ])
      expect(html).toContain(value);
    expect(html).not.toContain('<script>');
  });
  it('removes remote logo URLs and propagates rendering errors', async () => {
    vi.mocked(renderHtmlToPdf).mockRejectedValueOnce(
      new Error('PDF unavailable')
    );
    await expect(
      generateReceiptBlob(order, {
        ...merchant,
        logo_url: 'http://169.254.169.254/logo',
      })
    ).rejects.toThrow('PDF unavailable');
    expect(vi.mocked(renderHtmlToPdf).mock.calls[0][0]).not.toContain(
      '169.254.169.254'
    );
  });
  it('uses prevalidated logo bytes supplied by the caller', async () => {
    await generateReceiptBlob(order, merchant, {
      logoDataUri: 'data:image/png;base64,AQID',
    });
    expect(vi.mocked(renderHtmlToPdf).mock.calls[0][0]).toContain(
      'data:image/png;base64,AQID'
    );
  });
});
