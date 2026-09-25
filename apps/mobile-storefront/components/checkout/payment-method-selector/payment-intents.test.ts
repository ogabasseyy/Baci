import {
  bnplEligibilityHint,
  isIntentSelected,
  PAYMENT_INTENTS,
  type PaymentIntent,
} from './payment-intents';

const intentById = (id: PaymentIntent['id']): PaymentIntent => {
  const intent = PAYMENT_INTENTS.find((candidate) => candidate.id === id);
  if (!intent) throw new Error(`missing intent: ${id}`);
  return intent;
};

describe('PAYMENT_INTENTS', () => {
  it('exposes the four checkout intents in intent-first order', () => {
    expect(PAYMENT_INTENTS.map((intent) => intent.id)).toEqual([
      'full',
      'installments',
      'payforme',
      'invoice',
    ]);
  });

  it('maps each intent onto a payment tab, pinning a method for direct intents', () => {
    expect(intentById('full').tab).toBe('full');
    expect(intentById('full').method).toBeUndefined();

    expect(intentById('installments').tab).toBe('installments');
    expect(intentById('installments').method).toBeUndefined();

    expect(intentById('payforme')).toMatchObject({
      tab: 'pay_later',
      method: 'payforme',
    });
    expect(intentById('invoice')).toMatchObject({
      tab: 'pay_later',
      method: 'invoice',
    });
  });
});

describe('isIntentSelected', () => {
  it('treats an instrument-bearing intent as selected on tab match alone', () => {
    const full = intentById('full');

    // Any concrete instrument under the `full` tab counts as selected.
    expect(isIntentSelected(full, 'full', 'paystack')).toBe(true);
    expect(isIntentSelected(full, 'full', 'bank_transfer')).toBe(true);
    expect(isIntentSelected(full, 'installments', 'paystack')).toBe(false);
  });

  it('requires both tab and method to match for a terminal intent', () => {
    const payforme = intentById('payforme');
    const invoice = intentById('invoice');

    expect(isIntentSelected(payforme, 'pay_later', 'payforme')).toBe(true);
    // Same tab, different method → the sibling invoice intent owns it.
    expect(isIntentSelected(payforme, 'pay_later', 'invoice')).toBe(false);
    expect(isIntentSelected(invoice, 'pay_later', 'invoice')).toBe(true);
  });
});

describe('bnplEligibilityHint', () => {
  it('points below-minimum orders at the floor', () => {
    expect(bnplEligibilityHint(5000)).toBe('Available for orders from ₦10,000');
  });

  it('points above-maximum orders at the ceiling', () => {
    expect(bnplEligibilityHint(5_000_001)).toBe(
      'Available for orders up to ₦5,000,000'
    );
  });

  it('falls back to the floor hint for a non-finite total', () => {
    expect(bnplEligibilityHint(Number.NaN)).toBe(
      'Available for orders from ₦10,000'
    );
  });
});
