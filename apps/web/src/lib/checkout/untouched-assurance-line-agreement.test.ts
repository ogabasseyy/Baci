import { resolveAddedLineAssurance } from '@baci/shared/lib';
import { describe, expect, it } from 'vitest';
import { buildCheckoutOrderItems } from './build-order-items';

const OGABASSEY_POLICY = {
  smartCartProEnabled: true,
  merchantSlug: 'ogabassey',
  shippingInsuranceEnabled: true,
};

describe('untouched assurance line agreement', () => {
  it('charges, displays, and ships assurance consistently for an untouched Ogabassey line', () => {
    // The shopper never touched the toggle: the default is materialized at
    // add time, so the stored line, the fee, and the order payload agree.
    const stored = resolveAddedLineAssurance(
      undefined,
      undefined,
      OGABASSEY_POLICY
    );
    expect(stored).toBe(true);

    const [payload] = buildCheckoutOrderItems([
      {
        id: 'prod_1',
        name: 'iPhone 15 Pro',
        quantity: 1,
        price: 500000,
        hasAssurance: stored,
      },
    ]);
    expect(payload.has_assurance).toBe(true);
    expect(payload.assurance_fee).toBeGreaterThan(0);
  });

  it('keeps an explicit opt-out fee-free through the payload', () => {
    const stored = resolveAddedLineAssurance(
      false,
      undefined,
      OGABASSEY_POLICY
    );
    expect(stored).toBe(false);

    const [payload] = buildCheckoutOrderItems([
      {
        id: 'prod_1',
        name: 'iPhone 15 Pro',
        quantity: 1,
        price: 500000,
        hasAssurance: stored,
      },
    ]);
    expect(payload.has_assurance).toBe(false);
    expect(payload.assurance_fee).toBe(0);
  });

  it('keeps an untouched voucher line fee-free through the payload', () => {
    const stored = resolveAddedLineAssurance(undefined, undefined, {
      ...OGABASSEY_POLICY,
      hasQuizVoucher: true,
    });
    expect(stored).toBe(false);

    const [payload] = buildCheckoutOrderItems([
      {
        id: 'prod_1',
        name: 'Free prize',
        quantity: 1,
        price: 500000,
        hasAssurance: stored,
        quizAwardId: 'award_1',
        quizVoucherToken: 'token_1',
      },
    ]);
    expect(payload.has_assurance).toBe(false);
    expect(payload.assurance_fee).toBe(0);
    expect(payload.price).toBe(0);
  });
});
