import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  generateReceiptBlob,
  generateReceiptPDF,
  resolveReceiptLogoDataUri,
} from '@/lib/receipt-pdf-generator';

const baseMerchant = {
  business_name: 'Ogabassey',
  logo_url: null,
  email: 'hello@ogabassey.com',
  phone: '+2348011111111',
  support_email: 'support@ogabassey.com',
  support_phone: '+2348022222222',
  business_address: '12 Allen Avenue, Ikeja',
  cac_rc_number: null,
  tax_identification_number: null,
  legal_entity_name: null,
  brand_colors: {
    primary: '#111827',
    background: '#ffffff',
    accent: '#ef4444',
  },
  vat_registration_status: null,
  vat_rate: null,
  bank_code: null,
  bank_account_number: null,
};

const baseOrder = {
  order_number: 'ORD-1001',
  created_at: '2026-03-22T10:00:00.000Z',
  currency: 'NGN',
  total: 150000,
  subtotal: 145000,
  shipping_fee: 5000,
  tax_amount: 0,
  discount_amount: 0,
  amount_paid: 150000,
  balance: 0,
  payment_status: 'paid' as const,
  payment_method: 'card',
  customer_name: 'Oga Bassey',
  customer_email: 'oga@example.com',
  customer_phone: '+2348012345678',
};

function getPdfText(
  order: Parameters<typeof generateReceiptBlob>[0],
  merchant: Parameters<typeof generateReceiptBlob>[1],
  options?: Parameters<typeof generateReceiptPDF>[2]
) {
  return generateReceiptPDF(order, merchant, options)
    .output()
    .replaceAll(String.fromCharCode(0), '');
}

describe('generateReceiptBlob', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns a non-empty PDF blob', () => {
    const blob = generateReceiptBlob(
      {
        ...baseOrder,
        items: [
          {
            product_name: 'MacBook Pro',
            quantity: 1,
            price: 150000,
          },
        ],
        transactions: [],
      },
      baseMerchant
    );

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe('application/pdf');
  });

  it('supports unpaid invoices with empty items and missing optional merchant fields', () => {
    const order = {
      ...baseOrder,
      order_number: 'ORD-1002',
      total: 50000,
      subtotal: 50000,
      shipping_fee: 0,
      tax_amount: 0,
      discount_amount: 0,
      amount_paid: 0,
      balance: 50000,
      payment_status: 'unpaid' as const,
      payment_method: null,
      customer_name: 'Unpaid Customer',
      customer_email: 'unpaid@example.com',
      customer_phone: null,
      items: [],
      transactions: [],
    };
    const merchant = {
      ...baseMerchant,
      phone: null,
      support_email: null,
      support_phone: null,
      business_address: null,
      vat_registration_status: null,
      vat_rate: null,
      bank_account_number: null,
    };
    const blob = generateReceiptBlob(order, merchant);
    const pdfText = getPdfText(order, merchant);

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe('application/pdf');
    expect(pdfText).toContain('INVOICE');
    expect(pdfText).toContain('ORD-1002');
    expect(pdfText).toContain('Unpaid Customer');
    expect(pdfText).toContain('Item');
    expect(pdfText).toContain('Line Total');
  });

  it('can render a paid order as an invoice document when requested', () => {
    const order = {
      ...baseOrder,
      items: [
        {
          product_name: 'MacBook Pro',
          quantity: 1,
          price: 150000,
        },
      ],
      transactions: [],
    };
    const pdfText = generateReceiptPDF(order, baseMerchant, {
      documentKind: 'invoice',
    })
      .output()
      .replaceAll(String.fromCharCode(0), '');

    expect(pdfText).toContain('INVOICE');
    expect(pdfText).not.toContain('RECEIPT');
  });

  it('renders stored credit notes with the credit note label', () => {
    const order = {
      ...baseOrder,
      items: [
        {
          product_name: 'Refunded item',
          quantity: 1,
          price: 150000,
        },
      ],
      transactions: [],
    };
    const pdfText = generateReceiptPDF(order, baseMerchant, {
      documentKind: 'invoice',
      invoiceTypeCode: '381',
    })
      .output()
      .replaceAll(String.fromCharCode(0), '');

    expect(pdfText).toContain('CREDIT NOTE');
  });

  it('renders invoice issue date, due date, buyer reference, seller address, and line descriptions', () => {
    const order = {
      ...baseOrder,
      items: [
        {
          product_name: 'iPhone 15 Pro',
          description: 'IMEI: 123456789012345 | S/N: SN-001',
          line_extension_amount: 120000,
          quantity: 1,
          price: 150000,
          sellers_item_id: 'SKU-IPHONE-15',
          unit_code: 'EA',
          vat_amount: 9000,
          vat_category_code: 'S',
          vat_rate: 7.5,
        },
      ],
      transactions: [],
    };
    const pdfText = getPdfText(
      order,
      {
        ...baseMerchant,
        registered_address: {
          street: '99 Registered Road',
          city: 'Ikeja',
          state: 'Lagos',
          postal_code: '100001',
          country: 'NG',
        },
      },
      {
        buyerReference: 'BUYER-REF-001',
        documentDate: new Date('2026-06-01T00:00:00.000Z'),
        documentKind: 'invoice',
        dueDate: new Date('2026-06-15T00:00:00.000Z'),
        firsCsid: 'CSID-001',
        firsIrn: 'IRN-2026-001',
        invoiceNotes: 'Legal invoice note for the customer.',
        paymentTerms: 'Net 14',
        taxSubtotals: [
          {
            taxable_amount: 120000,
            tax_amount: 9000,
            vat_category_code: 'S',
            vat_rate: 7.5,
          },
        ],
      }
    );

    expect(pdfText).toContain('1 Jun 2026');
    expect(pdfText).toContain('Invoice Terms');
    expect(pdfText).toContain('Buyer Reference: BUYER-REF-001');
    expect(pdfText).toContain('Due Date: 15 Jun 2026');
    expect(pdfText).toContain('99 Registered Road');
    expect(pdfText).toContain('Payment Terms: Net 14');
    expect(pdfText).toContain('FIRS References');
    expect(pdfText).toContain('FIRS IRN: IRN-2026-001');
    expect(pdfText).toContain('FIRS CSID: CSID-001');
    expect(pdfText).toContain('Invoice Notes');
    expect(pdfText).toContain('Legal invoice note for the customer.');
    expect(pdfText).toContain('VAT Breakdown');
    expect(pdfText).toContain('VAT: 7.50%');
    expect(pdfText).toContain('SKU: SKU-IPHONE-15');
    expect(pdfText).toContain('Unit: EA');
    expect(pdfText).toContain('120,000');
    expect(pdfText).toContain('IMEI: 123456789012345');
    expect(pdfText).toContain('S/N: SN-001');
  });

  it('prints a compliance note when the invoice XML artifact has been generated', () => {
    const order = {
      ...baseOrder,
      payment_status: 'unpaid' as const,
      amount_paid: 0,
      balance: 150000,
      items: [
        {
          product_name: 'MacBook Pro',
          quantity: 1,
          price: 150000,
        },
      ],
      transactions: [],
    };
    const pdfText = generateReceiptPDF(order, baseMerchant, {
      complianceNote:
        'This invoice complies with Peppol BIS Billing 3.0 through a generated UBL XML invoice artifact created from this order.',
      documentKind: 'invoice',
    })
      .output()
      .replaceAll(String.fromCharCode(0), '');

    expect(pdfText).toContain('Peppol BIS Billing 3.0');
    expect(pdfText).toContain('generated UBL XML invoice artifact');
  });

  it('does not show a VAT percentage when only SKU and unit metadata exist', () => {
    const order = {
      ...baseOrder,
      items: [
        {
          product_name: 'MacBook Pro',
          quantity: 1,
          price: 150000,
          sellers_item_id: 'SKU-MBP',
          unit_code: 'EA',
        },
      ],
      transactions: [],
    };
    const pdfText = getPdfText(order, baseMerchant, {
      documentKind: 'invoice',
    });

    expect(pdfText).toContain('SKU: SKU-MBP');
    expect(pdfText).toContain('Unit: EA');
    expect(pdfText).not.toContain('VAT: 0.00%');
  });

  it('handles long names and multiple items without failing', () => {
    const order = {
      ...baseOrder,
      order_number: 'ORD-1003',
      total: 310000,
      subtotal: 300000,
      shipping_fee: 10000,
      tax_amount: 0,
      discount_amount: 0,
      amount_paid: 310000,
      balance: 0,
      payment_status: 'paid' as const,
      payment_method: 'transfer',
      customer_name:
        'A very long customer name that should still be renderable inside the PDF generator without throwing',
      customer_email: 'long@example.com',
      customer_phone: '+2348099999999',
      items: [
        {
          product_name:
            'An exceptionally long product name designed to wrap across the PDF table correctly',
          quantity: 1,
          price: 200000,
        },
        {
          product_name:
            'A second long product title to validate multiple row rendering',
          quantity: 2,
          price: 55000,
        },
      ],
      transactions: [],
    };
    const merchant = {
      ...baseMerchant,
      business_name:
        'Ogabassey Electronics and Premium Devices Superstore Limited',
    };
    const blob = generateReceiptBlob(order, merchant);
    const pdfText = getPdfText(order, merchant);

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe('application/pdf');
    expect(pdfText).toContain('A very long customer name');
    expect(pdfText).toContain('An exceptionally long product name');
    expect(pdfText).toContain('A second long product title');
  });

  it('includes variant labels in receipt line items when present', () => {
    const order = {
      ...baseOrder,
      items: [
        {
          product_name: 'iPhone 16',
          variant_name: 'Blue / 128GB',
          quantity: 1,
          price: 150000,
        },
      ],
      transactions: [],
    };

    const pdfText = getPdfText(order, baseMerchant);

    expect(pdfText).toContain('Blue / 128GB');
  });

  it('formats condition and variant metadata in receipt line items', () => {
    const order = {
      ...baseOrder,
      items: [
        {
          condition: 'open_box',
          product_name: '13" MacBook Air M2',
          quantity: 1,
          price: 150000,
          variant_name: 'Open Box / 512GB',
        },
        {
          condition: 'used',
          product_name: '',
          quantity: 1,
          price: 0,
          variant_name: null,
        },
      ],
      transactions: [],
    };

    const pdfText = getPdfText(order, baseMerchant);

    expect(pdfText).toContain('13" MacBook Air M2');
    expect(pdfText).toContain('Open Box / 512GB');
    expect(pdfText).toContain('Item \\(Used\\)');
  });

  it('ignores whitespace-only variant labels', () => {
    const order = {
      ...baseOrder,
      items: [
        {
          product_name: 'iPhone 16',
          variant_name: '   ',
          quantity: 1,
          price: 150000,
        },
      ],
      transactions: [],
    };

    const pdfText = getPdfText(order, baseMerchant);

    expect(pdfText).toContain('iPhone 16');
    expect(pdfText).not.toContain('(   )');
    expect(pdfText).not.toContain('()');
  });

  it('renders payment history when transactions are present', () => {
    const order = {
      ...baseOrder,
      items: [
        {
          product_name: 'MacBook Pro',
          quantity: 1,
          price: 150000,
        },
      ],
      transactions: [
        {
          amount: 75000,
          created_at: '2026-03-20T14:00:00.000Z',
          description: 'Card payment',
          metadata: { payment_method: 'card' },
        },
        {
          amount: 75000,
          created_at: '2026-03-21T09:00:00.000Z',
          description: 'Transfer payment',
          metadata: { payment_method: 'transfer' },
        },
      ],
    };
    const blob = generateReceiptBlob(order, baseMerchant);
    const pdfText = getPdfText(order, baseMerchant);

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe('application/pdf');
    expect(pdfText).toContain('Payment Date');
    expect(pdfText).toContain('20 Mar 2026');
    expect(pdfText).toContain('21 Mar 2026');
    expect(pdfText).toContain('card');
    expect(pdfText).toContain('transfer');
    expect(pdfText).toContain('75,000.00');
  });

  it('uses the manual transaction date when no document date override is supplied', () => {
    const pdfText = getPdfText(
      {
        ...baseOrder,
        created_at: '2026-09-12T10:00:00.000Z',
        transaction_date: '2026-03-04T23:30:00.000Z',
        items: [
          {
            product_name: 'MacBook Pro',
            quantity: 1,
            price: 150000,
          },
        ],
        transactions: [],
      },
      baseMerchant
    );

    expect(pdfText).toContain('5 Mar 2026');
    expect(pdfText).not.toContain('12 Sep 2026');
  });

  it('handles invalid receipt dates without failing', () => {
    const blob = generateReceiptBlob(
      {
        ...baseOrder,
        created_at: 'not-a-date',
        items: [
          {
            product_name: 'MacBook Pro',
            quantity: 1,
            price: 150000,
          },
        ],
        transactions: [],
      },
      baseMerchant
    );

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe('application/pdf');
  });

  it('omits the amount paid row for fully paid free orders', () => {
    const output = generateReceiptPDF(
      {
        ...baseOrder,
        order_number: 'ORD-1004',
        total: 0,
        subtotal: 0,
        shipping_fee: 0,
        tax_amount: 0,
        discount_amount: 0,
        amount_paid: 0,
        balance: 0,
        payment_status: 'paid',
        items: [
          {
            product_name: 'Free Gift',
            quantity: 1,
            price: 0,
          },
        ],
        transactions: [],
      },
      baseMerchant
    ).output();

    expect(output).toContain('Subtotal');
    expect(output).toContain('Shipping');
    expect(output).toContain('Total');
    expect(output).not.toContain('Amount Paid');
    expect(output).not.toContain('Balance Due');
  });

  it('does not fetch untrusted merchant logo URLs', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await expect(
      resolveReceiptLogoDataUri({
        ...baseMerchant,
        logo_url: 'https://169.254.169.254/latest/meta-data',
      })
    ).resolves.toBeNull();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fetches only capped trusted media logo URLs', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        headers: {
          'content-length': '3',
          'content-type': 'image/png',
        },
        status: 200,
      })
    );
    vi.stubGlobal('fetch', fetchSpy);

    await expect(
      resolveReceiptLogoDataUri({
        ...baseMerchant,
        logo_url: 'https://cdn.ogabassey.com/media/merchant/logo.png',
      })
    ).resolves.toBe('data:image/png;base64,AQID');

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        redirect: 'error',
        signal: expect.any(AbortSignal),
      })
    );
  });

  it('allows existing Supabase images bucket logo URLs', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([4, 5, 6]), {
        headers: {
          'content-length': '3',
          'content-type': 'image/png',
        },
        status: 200,
      })
    );
    vi.stubGlobal('fetch', fetchSpy);

    await expect(
      resolveReceiptLogoDataUri({
        ...baseMerchant,
        logo_url:
          'https://project-ref.supabase.co/storage/v1/object/public/images/logo.png',
      })
    ).resolves.toBe('data:image/png;base64,BAUG');

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        redirect: 'error',
        signal: expect.any(AbortSignal),
      })
    );
  });

  it('rejects Supabase logo URLs outside the public logo allowlist', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await expect(
      resolveReceiptLogoDataUri({
        ...baseMerchant,
        logo_url:
          'https://project-ref.supabase.co/storage/v1/object/private/images/logo.png',
      })
    ).resolves.toBeNull();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects oversized trusted media logos before reading the body', async () => {
    const arrayBuffer = vi.fn();
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({
        'content-length': String(512 * 1024),
        'content-type': 'image/png',
      }),
      arrayBuffer,
    });
    vi.stubGlobal('fetch', fetchSpy);

    await expect(
      resolveReceiptLogoDataUri({
        ...baseMerchant,
        logo_url: 'https://cdn.ogabassey.com/media/merchant/large-logo.png',
      })
    ).resolves.toBeNull();

    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('stops streaming trusted media logos after the byte cap', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(new Uint8Array(300 * 1024), {
        headers: {
          'content-type': 'image/png',
        },
        status: 200,
      })
    );
    vi.stubGlobal('fetch', fetchSpy);

    await expect(
      resolveReceiptLogoDataUri({
        ...baseMerchant,
        logo_url: 'https://cdn.ogabassey.com/media/merchant/large-logo.png',
      })
    ).resolves.toBeNull();
  });

  it('prints the support email when one is set', () => {
    const order = {
      ...baseOrder,
      items: [{ product_name: 'MacBook Pro', quantity: 1, price: 150000 }],
      transactions: [],
    };
    const pdfText = getPdfText(order, baseMerchant);

    expect(pdfText).toContain('support@ogabassey.com');
  });

  it('does not leak the private account email when no support email is set', () => {
    const order = {
      ...baseOrder,
      items: [{ product_name: 'MacBook Pro', quantity: 1, price: 150000 }],
      transactions: [],
    };
    const merchant = {
      ...baseMerchant,
      email: 'owner-private@gmail.com',
      support_email: null,
    };
    const pdfText = getPdfText(order, merchant);

    expect(pdfText).not.toContain('owner-private@gmail.com');
  });
});
