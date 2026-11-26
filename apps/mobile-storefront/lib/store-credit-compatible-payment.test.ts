import {
  isStoreCreditCompatiblePayment,
  type StoreCreditPaymentMethod,
  type StoreCreditPaymentTab,
} from './store-credit-compatible-payment';

describe('isStoreCreditCompatiblePayment', () => {
  it.each([
    'paystack',
    'korapay',
    'bank_transfer',
  ] as const)('allows %s full-payment settlement', (selectedPayment) => {
    expect(
      isStoreCreditCompatiblePayment({
        paymentTab: 'full',
        selectedPayment,
      })
    ).toBe(true);
  });

  it('verifies installment and pay later support for compatible methods', () => {
    expect(
      isStoreCreditCompatiblePayment({
        paymentTab: 'installments',
        selectedPayment: 'credpal',
      })
    ).toBe(true);
    expect(
      isStoreCreditCompatiblePayment({
        paymentTab: 'installments',
        selectedPayment: 'oxygen',
      })
    ).toBe(true);
    expect(
      isStoreCreditCompatiblePayment({
        paymentTab: 'installments',
        selectedPayment: 'klump',
      })
    ).toBe(true);
    expect(
      isStoreCreditCompatiblePayment({
        paymentTab: 'installments',
        selectedPayment: 'credit_direct',
      })
    ).toBe(true);
    expect(
      isStoreCreditCompatiblePayment({
        paymentTab: 'pay_later',
        selectedPayment: 'invoice',
      })
    ).toBe(true);
  });

  it('rejects unsupported payment methods across all tabs', () => {
    expect(
      isStoreCreditCompatiblePayment({
        paymentTab: 'full',
        selectedPayment: 'pay_on_delivery',
      })
    ).toBe(false);
    expect(
      isStoreCreditCompatiblePayment({
        paymentTab: 'installments',
        selectedPayment: 'pay_on_delivery',
      })
    ).toBe(false);
  });

  it.each([
    { paymentTab: null, selectedPayment: 'paystack' },
    { paymentTab: undefined, selectedPayment: 'paystack' },
    { paymentTab: '', selectedPayment: 'paystack' },
    { paymentTab: 'delayed', selectedPayment: 'paystack' },
    { paymentTab: 'full', selectedPayment: null },
    { paymentTab: 'full', selectedPayment: undefined },
    { paymentTab: 'full', selectedPayment: '' },
    { paymentTab: 'full', selectedPayment: 'PAYSTACK' },
    { paymentTab: 'full', selectedPayment: 'crypto' },
    { paymentTab: 'full', selectedPayment: 'cheque' },
  ])('rejects invalid runtime input %#', ({ paymentTab, selectedPayment }) => {
    expect(
      isStoreCreditCompatiblePayment({
        paymentTab: paymentTab as StoreCreditPaymentTab,
        selectedPayment: selectedPayment as StoreCreditPaymentMethod,
      })
    ).toBe(false);
  });
});
