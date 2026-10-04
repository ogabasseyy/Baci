import { describe, expect, it } from 'vitest';
import {
  renderInvoiceTermsHtml,
  renderLogoHtml,
  renderPaymentHistoryHtml,
  renderTermsHtml,
} from './receipt-sections';
import type { ReceiptMerchant, ReceiptOrder } from './types';

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

describe('renderPaymentHistoryHtml', () => {
  it('pins transaction dates to the Lagos document timezone', () => {
    // 23:30 UTC is already the next calendar day in Lagos (UTC+1):
    // the pinned timezone shows 7 Feb regardless of runner locale.
    const html = renderPaymentHistoryHtml(
      {
        transactions: [
          {
            amount: 5000,
            created_at: '2024-02-06T23:30:00.000Z',
            description: null,
            metadata: { payment_method: 'card' },
          },
        ],
      } as ReceiptOrder,
      (amount: number) => `NGN ${amount}`
    );

    expect(html).toContain('7 Feb 2024');
    expect(html).not.toContain('6 Feb 2024');
  });

  it('renders a dash for null transaction timestamps', () => {
    // transactions.created_at is nullable: new Date(null) is the epoch,
    // so the row must degrade instead of printing Jan 1970.
    const html = renderPaymentHistoryHtml(
      {
        transactions: [
          {
            amount: 5000,
            created_at: null,
            description: null,
            metadata: null,
          },
        ],
      } as ReceiptOrder,
      (amount: number) => `NGN ${amount}`
    );

    expect(html).toContain('<td>-</td>');
    expect(html).not.toContain('1970');
  });

  it('falls back to the description for structured methods', () => {
    // Objects/arrays canonicalize to absent like the SQL snapshot: the
    // row renders the description, never '[object Object]'.
    const html = renderPaymentHistoryHtml(
      {
        transactions: [
          {
            amount: 5000,
            created_at: '2024-02-06T23:30:00.000Z',
            description: 'DVA transfer',
            metadata: { payment_method: { name: 'cash' } },
          },
        ],
      } as ReceiptOrder,
      (amount: number) => `NGN ${amount}`
    );

    expect(html).toContain('DVA transfer');
    expect(html).not.toContain('[object Object]');
  });
});

describe('renderInvoiceTermsHtml', () => {
  it('renders terms, resolved notes, and FIRS like the emailed PDF', () => {
    const html = renderInvoiceTermsHtml(
      {
        invoice_note: 'Priority',
        notes: 'Shadowed',
        payment_due_date: '2026-05-20',
        payment_terms: 'Net 30',
        buyer_reference: 'PO-77',
        firs_irn: 'IRN-1',
        firs_csid: null,
      } as ReceiptOrder,
      false
    );

    expect(html).toContain('Invoice Terms');
    expect(html).toContain('Due Date: 20 May 2026');
    expect(html).toContain('Payment Terms: Net 30');
    expect(html).toContain('Priority');
    expect(html).not.toContain('Shadowed');
    expect(html).toContain('FIRS IRN: IRN-1');
  });

  it('omits terms blocks on paid receipts', () => {
    expect(
      renderInvoiceTermsHtml({ payment_terms: 'Net 30' } as ReceiptOrder, true)
    ).toBe('');
  });
});
