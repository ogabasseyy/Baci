import { describe, expect, it } from 'vitest';
import { generateReceiptHtml } from './generate-receipt-html';
import { receiptTestFactory } from './receipt-test-factory';
import type { ReceiptOrder } from './types';

const { createReceiptMerchant, createReceiptOrder } = receiptTestFactory;

describe('generateReceiptHtml', () => {
  it('uses the selected transaction date instead of the creation date', () => {
    const html = generateReceiptHtml(
      createReceiptOrder({
        created_at: '2026-09-12T10:40:00.000Z',
        transaction_date: '2026-03-05T00:00:00.000Z',
      }),
      createReceiptMerchant()
    );

    expect(html).toContain('5 Mar 2026');
    expect(html).not.toContain('12 Sep 2026');
  });

  it('uses the persisted calendar date for a midnight-offset manual order', () => {
    const html = generateReceiptHtml(
      createReceiptOrder({
        created_at: '2026-09-12T10:00:00.000Z',
        transaction_date: '2026-03-04T23:30:00.000Z',
        invoice_issue_date: null,
      }),
      createReceiptMerchant()
    );

    expect(html).toContain('5 Mar 2026');
    expect(html).not.toContain('12 Sep 2026');
  });

  it('includes the variant label in receipt item rows', () => {
    const html = generateReceiptHtml(
      createReceiptOrder(),
      createReceiptMerchant()
    );

    expect(html).toContain('Samsung Galaxy S22 Ultra (Black / 256GB)');
  });

  it('includes the selected condition alongside variant labels in receipt item rows', () => {
    const receiptItem = {
      product_name: '13" MacBook Air M2 (2022)',
      condition: 'open_box',
      variant_name: '512GB',
      quantity: 1,
      price: 690000,
    } as ReceiptOrder['items'][number];

    const html = generateReceiptHtml(
      createReceiptOrder({ items: [receiptItem] }),
      createReceiptMerchant()
    );

    expect(html).toContain('13&quot; MacBook Air M2 (2022) (Open Box / 512GB)');
  });

  it('does not duplicate the condition when the variant label already contains it', () => {
    const receiptItem = {
      product_name: '13" MacBook Air M2 (2022)',
      condition: 'open_box',
      variant_name: 'Open Box / 512GB',
      quantity: 1,
      price: 690000,
    } as ReceiptOrder['items'][number];

    const html = generateReceiptHtml(
      createReceiptOrder({ items: [receiptItem] }),
      createReceiptMerchant()
    );

    expect(html).toContain('13&quot; MacBook Air M2 (2022) (Open Box / 512GB)');
    expect(html).not.toContain('Open Box / Open Box / 512GB');
  });

  it('does not double-escape merchant names in the logo fallback', () => {
    const html = generateReceiptHtml(
      createReceiptOrder(),
      createReceiptMerchant({
        business_name: "A&B's Phones",
      })
    );

    expect(html).toContain('A&amp;B&#039;s Phones');
    expect(html).not.toContain('A&amp;amp;B');
    expect(html).not.toContain('&amp;#039;');
  });

  it('includes saved IMEI and serial number details on the receipt', () => {
    const html = generateReceiptHtml(
      createReceiptOrder({
        fulfillment_details: {
          imei: '353456789012345',
          serialNumber: 'SN-123',
        },
      }),
      createReceiptMerchant()
    );

    expect(html).not.toContain('Fulfillment Details');
    expect(html).toContain('IMEI');
    expect(html).toContain('353456789012345');
    expect(html).toContain('S/N');
    expect(html).toContain('SN-123');
    expect(html).toContain('cell-fulfillment-grid');
  });

  it('falls back to legacy serial_number when serialNumber is blank', () => {
    const html = generateReceiptHtml(
      createReceiptOrder({
        fulfillment_details: {
          serialNumber: ' ',
          serial_number: 'SN-LEGACY-123',
        },
      }),
      createReceiptMerchant()
    );

    expect(html).toContain('S/N');
    expect(html).toContain('SN-LEGACY-123');
    expect(html).toMatch(/cell-item[\s\S]*S\/N: SN-LEGACY-123/);
    expect(html).not.toContain('Fulfillment Details');
  });

  it('renders fulfillment identifiers as item chips under the matching line item', () => {
    const html = generateReceiptHtml(
      createReceiptOrder({
        items: [
          {
            product_name: 'Samsung Galaxy Buds4 Pro',
            quantity: 1,
            price: 150000,
            fulfillment_details: {
              serialNumber: '5CG3274K21',
            },
          },
          {
            product_name: 'Hp pen',
            quantity: 1,
            price: 40000,
          },
        ],
      }),
      createReceiptMerchant()
    );

    const budsRow =
      (html.match(/<tr[\s\S]*?<\/tr>/g) ?? []).find((row) =>
        row.includes('Samsung Galaxy Buds4 Pro')
      ) ?? '';
    const penRow =
      (html.match(/<tr[\s\S]*?<\/tr>/g) ?? []).find((row) =>
        row.includes('Hp pen')
      ) ?? '';

    expect(budsRow).toContain('cell-fulfillment-grid');
    expect(budsRow).toContain('fulfillment-key">S/N');
    expect(budsRow).toContain('fulfillment-val">5CG3274K21');
    expect(penRow).not.toContain('5CG3274K21');
    expect(html).not.toContain('Fulfillment Details');
  });

  it('attaches order-level fulfillment details to the first device item', () => {
    const html = generateReceiptHtml(
      createReceiptOrder({
        fulfillment_details: {
          imei: '353456789012345',
          serialNumber: 'SN-123',
        },
        items: [
          {
            product_name: 'Leather Case',
            quantity: 1,
            price: 25000,
          },
          {
            product_name: 'iPhone 15 Pro',
            quantity: 1,
            price: 500000,
          },
        ],
      }),
      createReceiptMerchant()
    );

    expect(html).not.toMatch(
      /Leather Case[\s\S]*IMEI: 353456789012345[\s\S]*iPhone 15 Pro/
    );
    expect(html).toMatch(/iPhone 15 Pro[\s\S]*IMEI: 353456789012345/);
  });

  it('prefers item-level fulfillment details over order-level fallback details', () => {
    const html = generateReceiptHtml(
      createReceiptOrder({
        fulfillment_details: {
          imei: '111111111111111',
          serialNumber: 'ORDER-SERIAL',
        },
        items: [
          {
            product_name: 'Samsung Galaxy S22 Ultra',
            quantity: 1,
            price: 500000,
            fulfillment_details: {
              imei: '222222222222222',
              serialNumber: 'ITEM-SERIAL',
            },
          },
        ],
      }),
      createReceiptMerchant()
    );

    const itemRow =
      (html.match(/<tr[\s\S]*?<\/tr>/g) ?? []).find((row) =>
        row.includes('Samsung Galaxy S22 Ultra')
      ) ?? '';
    expect(itemRow).toContain('IMEI: 222222222222222');
    expect(itemRow).toContain('S/N: ITEM-SERIAL');
    expect(itemRow).not.toContain('IMEI: 111111111111111');
    expect(itemRow).not.toContain('S/N: ORDER-SERIAL');
  });

  it('uses order-level fulfillment fallback on only one device item', () => {
    const html = generateReceiptHtml(
      createReceiptOrder({
        fulfillment_details: {
          imei: '353456789012345',
          serialNumber: 'SN-123',
        },
        items: [
          {
            product_name: 'iPhone 15 Pro',
            quantity: 1,
            price: 500000,
          },
          {
            product_name: 'Samsung Galaxy S22 Ultra',
            quantity: 1,
            price: 450000,
          },
        ],
      }),
      createReceiptMerchant()
    );

    const itemRows = (html.match(/<tr[\s\S]*?<\/tr>/g) ?? [])
      .filter((row) => /iPhone 15 Pro|Samsung Galaxy S22 Ultra/.test(row))
      .join('\n');
    expect(itemRows.match(/IMEI: 353456789012345/g) ?? []).toHaveLength(1);
  });

  it('renders order-level fulfillment items under their matching receipt rows', () => {
    const html = generateReceiptHtml(
      createReceiptOrder({
        fulfillment_details: {
          items: [
            {
              imei: '111111111111111',
              orderItemId: 'item-phone',
              productName: 'iPhone 15 Pro',
            },
            {
              orderItemId: 'item-ipad',
              productName: '13" iPad Air',
              serialNumber: 'IPAD-SERIAL-2',
            },
          ],
        },
        items: [
          {
            id: 'item-phone',
            product_name: 'iPhone 15 Pro',
            quantity: 1,
            price: 500000,
          },
          {
            id: 'item-ipad',
            product_name: '13" iPad Air',
            quantity: 1,
            price: 800000,
          },
        ],
      }),
      createReceiptMerchant()
    );

    const phoneRow =
      (html.match(/<tr[\s\S]*?<\/tr>/g) ?? []).find((row) =>
        row.includes('iPhone 15 Pro')
      ) ?? '';
    const ipadRow =
      (html.match(/<tr[\s\S]*?<\/tr>/g) ?? []).find((row) =>
        row.includes('13&quot; iPad Air')
      ) ?? '';

    expect(phoneRow).toContain('IMEI: 111111111111111');
    expect(phoneRow).not.toContain('IPAD-SERIAL-2');
    expect(ipadRow).toContain('S/N: IPAD-SERIAL-2');
    expect(ipadRow).not.toContain('111111111111111');
  });

  it('does not emit unsafe brand colors into receipt styles', () => {
    const html = generateReceiptHtml(
      createReceiptOrder(),
      createReceiptMerchant({
        brand_colors: {
          accent: 'rgb(12, 34, 56);}</style><script>alert(2)</script><style>',
          background: '#ffffff',
          primary: '#111827;}</style><script>alert(1)</script><style>',
        },
      })
    );

    expect(html).not.toContain('</style><script>');
    expect(html).not.toContain('alert(1)');
    expect(html).not.toContain('alert(2)');
  });

  it('escapes QR image data URIs before rendering', () => {
    const html = generateReceiptHtml(
      createReceiptOrder(),
      createReceiptMerchant(),
      {
        qrCodeDataUri: 'data:image/png;base64,abc" onerror="alert(1)',
      }
    );

    expect(html).not.toContain(
      'src="data:image/png;base64,abc" onerror="alert(1)"'
    );
    expect(html).toContain(
      'src="data:image/png;base64,abc&quot; onerror=&quot;alert(1)"'
    );
  });

  it('renders the support email as the receipt contact email', () => {
    const html = generateReceiptHtml(
      createReceiptOrder(),
      createReceiptMerchant({ support_email: 'support@shop.example' })
    );

    expect(html).toContain('mailto:support@shop.example');
  });

  it.each([
    'imported',
    'bank_transfer',
    'transfer',
  ])('labels %s paid receipt payment methods as bank transfer', (paymentMethod) => {
    const html = generateReceiptHtml(
      createReceiptOrder({ payment_method: paymentMethod }),
      createReceiptMerchant()
    );

    expect(html).toContain('Bank Transfer');
    expect(html).not.toContain(`<div class="info-name">${paymentMethod}</div>`);
    expect(html).not.toContain('Verified imported payment');
  });

  it('renders tax identification only once in the footer', () => {
    const html = generateReceiptHtml(
      createReceiptOrder(),
      createReceiptMerchant({
        tax_identification_number: '2522599781276',
      })
    );

    expect(html.match(/TIN: 2522599781276/g) ?? []).toHaveLength(1);
  });

  it('labels unpaid receipt payment methods as pending', () => {
    const html = generateReceiptHtml(
      createReceiptOrder({
        payment_method: 'card',
        payment_status: 'pending',
      }),
      createReceiptMerchant()
    );

    expect(html).toContain('Pending');
    expect(html).not.toContain('<div class="info-name">card</div>');
  });

  it('includes postal code and country in the customer address block', () => {
    const html = generateReceiptHtml(
      createReceiptOrder({
        shipping_address: {
          address_line1: '12 Admiralty Way',
          city: 'Lekki',
          state: 'Lagos',
          postal_code: '100001',
          country: 'Nigeria',
        },
      }),
      createReceiptMerchant()
    );

    expect(html).toContain('12 Admiralty Way');
    expect(html).toContain('Lekki, Lagos');
    expect(html).toContain('100001');
    expect(html).toContain('Nigeria');
  });

  it('does not duplicate country when the imported full address already contains it', () => {
    const html = generateReceiptHtml(
      createReceiptOrder({
        shipping_address: {
          address_line1: '10 Marina, Lagos, Nigeria',
          city: 'Lagos',
          state: 'Lagos',
          country: 'NG',
        },
      }),
      createReceiptMerchant()
    );

    expect(html.match(/Nigeria/g) ?? []).toHaveLength(1);
    expect(html).not.toContain('<div>NG</div>');
  });

  it('renders standalone Nigerian country codes as Nigeria', () => {
    const html = generateReceiptHtml(
      createReceiptOrder({
        shipping_address: {
          address_line1: '12 Admiralty Way',
          country: 'NG',
        },
      }),
      createReceiptMerchant()
    );

    expect(html).toContain('Nigeria');
    expect(html).not.toContain('<div>NG</div>');
  });

  it('does not suppress short country codes found inside address words', () => {
    const html = generateReceiptHtml(
      createReceiptOrder({
        shipping_address: {
          address_line1: '10 Georgia Street',
          country: 'GE',
        },
      }),
      createReceiptMerchant()
    );

    expect(html).toContain('10 Georgia Street');
    expect(html).toContain('<div>GE</div>');
  });

  it.each([
    null,
    '   ',
  ])('labels paid receipt payment method %s as verified', (paymentMethod) => {
    const html = generateReceiptHtml(
      createReceiptOrder({ payment_method: paymentMethod }),
      createReceiptMerchant()
    );

    expect(html).toContain('<div class="info-name">Verified</div>');
  });

  it('never leaks the private account email onto the receipt', () => {
    // With no support email and no business name, the receipt must not fall
    // back to `merchant.email` (the private login address) for either the
    // contact line or the store-name header.
    const html = generateReceiptHtml(
      createReceiptOrder(),
      createReceiptMerchant({
        business_name: '',
        legal_entity_name: null,
        email: 'owner-private@gmail.com',
        support_email: null,
      })
    );

    expect(html).not.toContain('owner-private@gmail.com');
  });
});
