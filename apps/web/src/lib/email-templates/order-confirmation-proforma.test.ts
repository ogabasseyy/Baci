import { describe, expect, it } from 'vitest';
import {
  buildProformaIntroHtml,
  buildProformaNextStepsText,
  buildProformaPaymentHtml,
  buildProformaPaymentText,
  buildProformaTextIntro,
  type ProformaEmailInput,
  resolveOrderCtaHref,
  resolveProformaContext,
} from './order-confirmation-proforma';

function inputWith(overrides: Partial<ProformaEmailInput> = {}) {
  return {
    documentKind: 'proforma' as const,
    currency: 'NGN',
    total: 25000,
    merchantName: 'Test Store',
    merchantUrl: 'https://store.example.com',
    ...overrides,
  };
}

const account = {
  bankName: 'Test Bank',
  accountNumber: '0123456789',
  accountName: 'Baci / Ada',
};

describe('proforma context', () => {
  it('charges the outstanding balance, not the order total', () => {
    const context = resolveProformaContext(
      inputWith({ total: 25000, amountDue: 10000, virtualAccount: account })
    );

    expect(context).toEqual({
      transferAmount: 10000,
      hasAmountDue: true,
      virtualAccount: account,
    });
  });

  it('falls back to the total when nothing is due-tracked', () => {
    const context = resolveProformaContext(inputWith({ total: 25000 }));

    expect(context.transferAmount).toBe(25000);
    expect(context.hasAmountDue).toBe(true);
  });

  it('marks zero-due quotes as having nothing to transfer', () => {
    const context = resolveProformaContext(
      inputWith({ total: 25000, amountDue: 0, virtualAccount: account })
    );

    expect(context.hasAmountDue).toBe(false);
  });

  it('suppresses the naira DVA beside foreign-currency amounts', () => {
    const context = resolveProformaContext(
      inputWith({ currency: 'USD', virtualAccount: account })
    );

    expect(context.virtualAccount).toBeUndefined();
  });
});

describe('proforma CTA target', () => {
  it('opens the tracking page for documents with a payment link', () => {
    expect(
      resolveOrderCtaHref(
        inputWith({ paymentLink: 'https://store.example.com/track/1' })
      )
    ).toBe('https://store.example.com/track/1');
  });

  it('falls back to the storefront homepage otherwise', () => {
    expect(resolveOrderCtaHref(inputWith())).toBe('https://store.example.com');
    expect(
      resolveOrderCtaHref(
        inputWith({
          documentKind: 'confirmation',
          paymentLink: 'https://store.example.com/track/1',
        })
      )
    ).toBe('https://store.example.com');
  });
});

describe('proforma payment html', () => {
  it('renders transfer instructions with escaped account fields', () => {
    const html = buildProformaPaymentHtml(
      inputWith({
        virtualAccount: { ...account, accountName: '<Ada> & Co' },
      }),
      resolveProformaContext(
        inputWith({
          virtualAccount: { ...account, accountName: '<Ada> & Co' },
        })
      )
    );

    expect(html).toContain('Complete Your Bank Transfer');
    expect(html).toContain('&lt;Ada&gt; &amp; Co');
    expect(html).not.toContain('<Ada>');
  });

  it('omits the block for confirmations, missing accounts, or zero due', () => {
    const full = inputWith({ virtualAccount: account });
    expect(
      buildProformaPaymentHtml(
        { ...full, documentKind: 'confirmation' },
        resolveProformaContext(full)
      )
    ).toBe('');
    expect(
      buildProformaPaymentHtml(inputWith(), resolveProformaContext(inputWith()))
    ).toBe('');
    const zeroDue = inputWith({ amountDue: 0, virtualAccount: account });
    expect(
      buildProformaPaymentHtml(zeroDue, resolveProformaContext(zeroDue))
    ).toBe('');
    // Even a flagged confirmation renders nothing without an account or
    // an outstanding balance.
    const flaggedNoAccount = inputWith({
      documentKind: 'confirmation',
      balanceDueInstructions: true,
    });
    expect(
      buildProformaPaymentHtml(
        flaggedNoAccount,
        resolveProformaContext(flaggedNoAccount)
      )
    ).toBe('');
    const flaggedZeroDue = inputWith({
      documentKind: 'confirmation',
      balanceDueInstructions: true,
      amountDue: 0,
      virtualAccount: account,
    });
    expect(
      buildProformaPaymentHtml(
        flaggedZeroDue,
        resolveProformaContext(flaggedZeroDue)
      )
    ).toBe('');
  });

  it('renders the residual-balance block for flagged confirmations', () => {
    const flagged = inputWith({
      documentKind: 'confirmation',
      balanceDueInstructions: true,
      total: 25000,
      amountDue: 10000,
      virtualAccount: account,
    });
    const context = resolveProformaContext(flagged);
    const html = buildProformaPaymentHtml(flagged, context);

    expect(html).toContain('Complete Your Bank Transfer');
    expect(html).toContain('0123456789');
    const text = buildProformaPaymentText(flagged, context);
    expect(text).toContain('Payment Details');
    expect(text).toContain('0123456789');
    expect(text).toContain('Test Bank');
  });

  it('keeps confirmation copy commercial on the balance intros', () => {
    const flagged = inputWith({
      documentKind: 'confirmation',
      balanceDueInstructions: true,
      total: 25000,
      amountDue: 10000,
      virtualAccount: account,
    });
    const context = resolveProformaContext(flagged);

    expect(buildProformaIntroHtml(flagged, context)).toContain(
      'outstanding balance'
    );
    expect(buildProformaIntroHtml(flagged, context)).not.toContain('quotation');
    const steps = buildProformaNextStepsText(flagged, context);
    expect(steps).toContain('outstanding balance');
    expect(steps).not.toContain('this quote');
  });
});

describe('proforma intros', () => {
  it('addresses the payer for payment requests with an account', () => {
    const withAccount = inputWith({
      documentKind: 'payment_request',
      virtualAccount: account,
    });
    expect(
      buildProformaIntroHtml(withAccount, resolveProformaContext(withAccount))
    ).toContain('Share the transfer details with your payer');
  });

  it('falls back to merchant contact without an account', () => {
    const noAccount = inputWith({ documentKind: 'payment_request' });
    expect(
      buildProformaIntroHtml(noAccount, resolveProformaContext(noAccount))
    ).toContain('No payment account is assigned yet');
  });

  it('covers quotation and request text variants', () => {
    expect(buildProformaTextIntro('proforma', true)).toContain('quotation');
    expect(buildProformaTextIntro('proforma', false)).toContain(
      'No payment is due'
    );
    expect(buildProformaTextIntro('payment_request', true)).toContain(
      'Share the transfer details'
    );
    expect(buildProformaTextIntro(undefined, false)).toContain(
      'No payment is due'
    );
  });
});

describe('proforma text bodies', () => {
  it('renders plain-text account details', () => {
    const full = inputWith({ virtualAccount: account });
    const text = buildProformaPaymentText(full, resolveProformaContext(full));

    expect(text).toContain('0123456789');
    expect(text).toContain('Test Bank');
  });

  it('routes next steps through transfer details, never the tracking link', () => {
    const full = inputWith({
      virtualAccount: account,
      paymentLink: 'https://store.example.com/track/1',
    });
    const steps = buildProformaNextStepsText(
      full,
      resolveProformaContext(full)
    );

    expect(steps).toContain('Complete your bank transfer');
    expect(steps).toContain('https://store.example.com/track/1');
  });

  it('names the request noun for payment requests without accounts', () => {
    const noAccount = inputWith({ documentKind: 'payment_request' });
    const steps = buildProformaNextStepsText(
      noAccount,
      resolveProformaContext(noAccount)
    );

    expect(steps).toContain('No payment account was assigned to this request');
  });
});
