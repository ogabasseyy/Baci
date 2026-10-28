import { describe, expect, it } from 'vitest';
import { generateReceiptHtml } from './generate-receipt-html';
import { DEFAULT_NG_VAT_RATE } from './receipt-money';
import { receiptTestFactory } from './receipt-test-factory';

const { createReceiptMerchant, createReceiptOrder } = receiptTestFactory;

describe('generateReceiptHtml VAT summary', () => {
  it('does not show stale VAT when the order total excludes the tax amount', () => {
    const html = generateReceiptHtml(
      createReceiptOrder({
        subtotal: 935000,
        tax_amount: 70125,
        total: 935000,
      }),
      createReceiptMerchant({
        vat_registration_status: 'registered',
        vat_rate: 7.5,
      })
    );

    expect(html).not.toContain('VAT (7.5%)');
    expect(html).not.toContain('70125');
  });

  it('shows VAT when the order total includes the tax amount', () => {
    const html = generateReceiptHtml(
      createReceiptOrder({
        subtotal: 935000,
        tax_amount: 70125,
        total: 1005125,
      }),
      createReceiptMerchant({
        vat_registration_status: 'registered',
        vat_rate: 7.5,
      })
    );

    expect(html).toContain('VAT (7.5%)');
    expect(html).toContain('₦935,000.00');
    expect(html).toContain('₦70,125.00');
    expect(html).toContain('₦1,005,125.00');
  });

  it('shows VAT when subtotal was backfilled from a tax-inclusive total', () => {
    const html = generateReceiptHtml(
      createReceiptOrder({
        subtotal: 1005125,
        tax_amount: 70125,
        total: 1005125,
      }),
      createReceiptMerchant({
        vat_registration_status: 'registered',
        vat_rate: 7.5,
      })
    );

    expect(html).toContain(`VAT (${DEFAULT_NG_VAT_RATE}%)`);
    expect(html).toContain('₦935,000.00');
    expect(html).toContain('₦70,125.00');
    expect(html).toContain('₦1,005,125.00');
  });

  it('shows VAT when inclusive tax is rounded before persistence', () => {
    const html = generateReceiptHtml(
      createReceiptOrder({
        subtotal: 1000,
        tax_amount: 70,
        total: 1000,
      }),
      createReceiptMerchant({
        vat_registration_status: 'registered',
        vat_rate: 7.5,
      })
    );

    expect(html).toContain('VAT (7.5%)');
    expect(html).toContain('₦930.00');
    expect(html).toContain('₦70.00');
    expect(html).toContain('₦1,000.00');
  });

  it('does not use the Nigerian VAT fallback for non-NGN backfilled totals', () => {
    const html = generateReceiptHtml(
      createReceiptOrder({
        currency: 'USD',
        subtotal: 1005125,
        tax_amount: 70125,
        total: 1005125,
      }),
      createReceiptMerchant({
        vat_registration_status: 'registered',
        vat_rate: null,
      })
    );

    expect(html).not.toContain(`VAT (${DEFAULT_NG_VAT_RATE}%)`);
    expect(html).not.toContain('$70,125.00');
    expect(html).toContain('$1,005,125.00');
  });

  it('shows VAT for tax-inclusive totals when the merchant VAT rate is missing', () => {
    const html = generateReceiptHtml(
      createReceiptOrder({
        subtotal: 1005125,
        tax_amount: 70125,
        total: 1005125,
      }),
      createReceiptMerchant({
        vat_registration_status: 'registered',
        vat_rate: null,
      })
    );

    expect(html).toContain('VAT (7.5%)');
    expect(html).toContain('₦935,000.00');
    expect(html).toContain('₦70,125.00');
    expect(html).toContain('₦1,005,125.00');
  });

  it('renders the stored VAT breakdown on invoices like the emailed PDF', () => {
    const subtotals = [
      {
        vat_category_code: 'SR',
        vat_rate: 7.5,
        taxable_amount: 935000,
        tax_amount: 70125,
        exemption_reason: null,
      },
      {
        vat_category_code: 'ZR',
        vat_rate: 0,
        taxable_amount: 100000,
        tax_amount: 0,
        exemption_reason: 'Exported goods',
      },
    ];
    const html = generateReceiptHtml(
      createReceiptOrder({
        payment_status: 'unpaid',
        amount_paid: 0,
        balance: 1035000,
        tax_subtotals: subtotals,
      }),
      createReceiptMerchant()
    );

    expect(html).toContain('VAT Breakdown');
    expect(html).toContain('7.50%');
    expect(html).toContain('ZR (Exported goods)');
  });

  it('reconciles the VAT-free assurance premium into the breakdown', () => {
    const html = generateReceiptHtml(
      createReceiptOrder({
        payment_status: 'unpaid',
        amount_paid: 0,
        balance: 104000,
        subtotal: 100000,
        shipping_fee: 0,
        discount_amount: 0,
        items: [
          {
            product_name: 'Pixel 10 Pro XL',
            quantity: 1,
            price: 100000,
            assurance_fee: 4000,
          },
        ],
        tax_subtotals: [
          {
            vat_category_code: 'S',
            vat_rate: 7.5,
            taxable_amount: 100000,
            tax_amount: 7500,
            exemption_reason: null,
          },
        ],
      }),
      createReceiptMerchant()
    );

    expect(html).toContain('VAT Breakdown');
    expect(html).toContain('Insurance premium');
  });

  it('omits the VAT breakdown on paid receipts', () => {
    const html = generateReceiptHtml(
      createReceiptOrder({
        tax_subtotals: [
          {
            vat_category_code: 'SR',
            vat_rate: 7.5,
            taxable_amount: 935000,
            tax_amount: 70125,
            exemption_reason: null,
          },
        ],
      }),
      createReceiptMerchant()
    );

    expect(html).not.toContain('VAT Breakdown');
  });
});
