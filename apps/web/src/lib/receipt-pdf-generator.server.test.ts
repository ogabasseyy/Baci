// @vitest-environment node

import { spawnSync } from 'node:child_process';
import type { ReceiptMerchant, ReceiptOrder } from '@baci/shared';
import { describe, expect, it, vi } from 'vitest';
import { renderHtmlToPdf } from '@/lib/receipt-html-to-pdf';
import { generateReceiptBlob } from '@/lib/receipt-pdf-generator';

vi.mock('@/lib/receipt-html-to-pdf', () => ({
  renderHtmlToPdf: vi
    .fn()
    .mockResolvedValue(new TextEncoder().encode('%PDF-1.7')),
}));

function createReceiptMerchant(
  overrides: Partial<ReceiptMerchant> = {}
): ReceiptMerchant {
  return {
    business_name: 'Ogabassey',
    logo_url: null,
    email: 'hello@example.com',
    phone: '+2348012345678',
    support_email: 'support@example.com',
    support_phone: null,
    business_address: '12 Allen Avenue, Ikeja, Lagos',
    cac_rc_number: 'RC-123456',
    tax_identification_number: 'TIN-123456',
    legal_entity_name: 'Ogabassey Limited',
    brand_colors: {
      primary: '#1d4ed8',
      background: '#ffffff',
      accent: '#f59e0b',
    },
    vat_registration_status: 'registered',
    vat_rate: 7.5,
    bank_code: '044',
    bank_account_number: '0123456789',
    bank_name: 'Access Bank',
    bank_account_name: 'Ogabassey Limited',
    ...overrides,
  };
}

function createReceiptOrder(
  overrides: Partial<ReceiptOrder> = {}
): ReceiptOrder {
  return {
    order_number: 'ORD-2026-001',
    created_at: '2026-05-30T09:00:00.000Z',
    currency: 'NGN',
    total: 542500,
    subtotal: 500000,
    shipping_fee: 5000,
    tax_amount: 37500,
    discount_amount: 0,
    amount_paid: 542500,
    balance: 0,
    payment_status: 'paid',
    payment_method: 'card',
    customer_name: 'Akinola Ogunniran',
    customer_email: 'akin@example.com',
    customer_phone: '+2348098765432',
    shipping_address: {
      address_line1: '8 Marina Road',
      city: 'Lagos Island',
      state: 'Lagos',
      postal_code: '101001',
      country: 'NG',
    },
    items: [
      {
        product_name: 'Samsung Galaxy S24 Ultra',
        variant_name: 'Black / 256GB',
        quantity: 1,
        price: 500000,
      },
    ],
    transactions: [
      {
        amount: 542500,
        created_at: '2026-05-30T09:05:00.000Z',
        description: 'Card payment',
        metadata: { payment_method: 'Card' },
      },
    ],
    ...overrides,
  };
}

describe('shared invoice server import', () => {
  it('exports a PDF blob in Node without browser globals', async () => {
    const blob = await generateReceiptBlob(
      createReceiptOrder(),
      createReceiptMerchant()
    );
    expect(blob.type).toBe('application/pdf');
    expect(await blob.text()).toBe('%PDF-1.7');
    expect(vi.mocked(renderHtmlToPdf).mock.calls[0][0]).toContain(
      'Ogabassey Limited'
    );
  });
});

// Opt in on a host with Chrome/packaged Chromium and Poppler installed.
it.runIf(process.env.RECEIPT_PDF_SMOKE === '1')(
  'exports a parseable PDF from real Chromium',
  async () => {
    const browserRenderer = await vi.importActual<
      typeof import('./receipt-html-to-pdf')
    >('./receipt-html-to-pdf');
    vi.mocked(renderHtmlToPdf).mockImplementationOnce(
      browserRenderer.renderHtmlToPdf
    );
    const blob = await generateReceiptBlob(
      createReceiptOrder(),
      createReceiptMerchant()
    );
    const result = spawnSync('pdfinfo', ['-'], {
      input: Buffer.from(await blob.arrayBuffer()),
      encoding: 'utf8',
      timeout: 5000,
    });
    expect(result.status, result.stderr || result.error?.message).toBe(0);
    expect(result.stdout).toMatch(/^Pages:\s+[1-9]/m);
  },
  35_000
);
