import { describe, expect, it } from 'vitest';
import {
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
});
