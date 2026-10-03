import { describe, expect, it } from 'vitest';
import {
  renderItemRows,
  renderLogoHtml,
  renderTermsHtml,
} from './receipt-sections';
import type { ReceiptMerchant, ReceiptOrder } from './types';

const formatMoney = (value: number) => `NGN ${value.toLocaleString('en-NG')}`;

function createReceiptMerchant(
  overrides: Partial<ReceiptMerchant> = {}
): ReceiptMerchant {
  return {
    business_name: 'Ogabassey',
    logo_url: null,
    email: 'merchant@example.com',
    phone: '+2348012345678',
    support_email: null,
    support_phone: null,
    business_address: null,
    cac_rc_number: null,
    tax_identification_number: null,
    legal_entity_name: null,
    vat_registration_status: null,
    vat_rate: null,
    bank_code: null,
    bank_account_number: null,
    ...overrides,
  };
}

function createReceiptOrder(
  overrides: Partial<ReceiptOrder> = {}
): ReceiptOrder {
  return {
    amount_paid: 500000,
    balance: 0,
    created_at: '2026-04-08T18:02:55.974Z',
    currency: 'NGN',
    customer_email: 'customer@example.com',
    customer_name: 'Customer Example',
    customer_phone: null,
    discount_amount: 0,
    items: [
      {
        price: 500000,
        product_name: 'Samsung Galaxy Fold 5',
        quantity: 1,
      },
    ],
    order_number: 'ORD-123',
    payment_method: 'card',
    payment_status: 'paid',
    shipping_fee: 0,
    subtotal: 500000,
    tax_amount: 0,
    total: 500000,
    ...overrides,
  };
}

describe('renderLogoHtml', () => {
  it('escapes store names exactly once in fallback logo text', () => {
    const html = renderLogoHtml(
      createReceiptMerchant(),
      "A&B's Phones",
      undefined
    );

    expect(html).toContain('A&amp;B&#039;s Phones');
    expect(html).not.toContain('A&amp;amp;B');
  });

  it('escapes store names in fallback logo text', () => {
    const html = renderLogoHtml(
      createReceiptMerchant(),
      'Bad "><script>alert(1)</script>',
      undefined
    );

    expect(html).toContain(
      'Bad &quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;'
    );
    expect(html).not.toContain('<script>');
  });

  it('escapes store names in logo alt text', () => {
    const html = renderLogoHtml(
      createReceiptMerchant({
        logo_url: 'https://cdn.example.com/logo.png',
      }),
      'Bad "><script>alert(1)</script>',
      undefined
    );

    expect(html).toContain(
      'alt="Bad &quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"'
    );
    expect(html).not.toContain('alt="Bad "><script>');
  });

  it('uses an encoded and escaped placeholder URL for broken logo images', () => {
    const html = renderLogoHtml(
      createReceiptMerchant({
        logo_url: 'https://cdn.example.com/logo.png',
      }),
      'Bad "><script>alert(1)</script>',
      undefined
    );

    expect(html).toContain(
      'onerror="this.src=\'https://placehold.co/200x80?text=Bad%20%22%3E%3Cscript%3Ealert(1)%3C%2Fscript%3E\'"'
    );
    expect(html).not.toContain('Bad "><script>');
  });
});

describe('renderItemRows', () => {
  it('renders item descriptions under the receipt item name', () => {
    const html = renderItemRows(
      createReceiptOrder({
        items: [
          {
            description: 'Unlocked 512GB device',
            price: 930000,
            product_name: 'Samsung Galaxy Fold 5',
            quantity: 1,
            variant_name: 'Used',
          },
        ],
      }),
      formatMoney
    );

    expect(html).toContain('Samsung Galaxy Fold 5 (Used)');
    expect(html).toContain('Unlocked 512GB device');
    expect(html).toContain('cell-item-description');
  });

  it('honors explicit line extensions and renders SKU/Unit/VAT detail lines', () => {
    const html = renderItemRows(
      createReceiptOrder({
        items: [
          {
            price: 1000,
            product_name: 'Samsung Galaxy Fold 5',
            quantity: 2,
            line_extension_amount: 1500,
            sellers_item_id: 'SKU-1',
            unit_code: 'EA',
            vat_category_code: 'S',
            vat_rate: 7.5,
            vat_amount: 112.5,
          },
        ],
      }),
      formatMoney
    );

    // The explicit extension wins over quantity x price like the emailed PDF.
    expect(html).toContain('NGN 1,500');
    expect(html).not.toContain('NGN 2,000');
    expect(html).toContain('cell-line-meta');
    expect(html).toContain('SKU: SKU-1');
    expect(html).toContain('Unit: EA');
    expect(html).toContain('VAT: 7.50%');
    expect(html).toContain('NGN 112.5');
  });

  it('falls back to quantity x price without an extension or meta lines', () => {
    const html = renderItemRows(
      createReceiptOrder({
        items: [{ price: 1000, product_name: 'Cable', quantity: 2 }],
      }),
      formatMoney
    );

    expect(html).toContain('NGN 2,000');
    expect(html).not.toContain('cell-line-meta');
  });

  it('omits duplicate item descriptions already visible as labels or fulfillment', () => {
    const html = renderItemRows(
      createReceiptOrder({
        items: [
          {
            description: 'Used\nIMEI: 353456789012345 | S/N: SN-123',
            fulfillment_details: {
              imei: '353456789012345',
              serialNumber: 'SN-123',
            },
            price: 930000,
            product_name: 'Samsung Galaxy Fold 5',
            quantity: 1,
            variant_name: 'Used',
          },
        ],
      }),
      formatMoney
    );

    expect(html.match(/Samsung Galaxy Fold 5 \(Used\)/g) ?? []).toHaveLength(1);
    expect(html.match(/IMEI: 353456789012345/g) ?? []).toHaveLength(1);
    expect(html).not.toContain('cell-item-description');
  });
});

describe('renderTermsHtml', () => {
  it('normalizes store URLs before rendering the default terms link', () => {
    const html = renderTermsHtml(createReceiptMerchant(), {
      storeUrl: 'https://shop.example.com/storefront?ref=receipt',
    });

    expect(html).toContain('Terms and Conditions');
    expect(html).toContain(
      'By shopping with us, you agree to our terms and conditions and return policies stated below.'
    );
    expect(html).toContain('href="https://shop.example.com/terms"');
    expect(html).not.toContain('/storefront?ref=receipt/terms');
  });

  it('uses concise receipt terms copy instead of embedding full page terms', () => {
    const html = renderTermsHtml(
      createReceiptMerchant({ pages: { terms: '<p>Returns in 7 days</p>' } }),
      {
        storeUrl: 'shop.example.com/storefront/',
      }
    );

    expect(html).toContain(
      'By shopping with us, you agree to our terms and conditions and return policies stated below.'
    );
    expect(html).not.toContain('Returns in 7 days');
    expect(html).toContain('href="https://shop.example.com/terms"');
    expect(html).not.toContain('/storefront//terms');
  });

  it('omits terms links for invalid store URLs', () => {
    const html = renderTermsHtml(createReceiptMerchant(), {
      storeUrl: 'javascript:alert(1)',
    });

    expect(html).toBe('');
  });
});
