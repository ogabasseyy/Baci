import { usePaymentMethodAvailability } from './usePaymentMethodAvailability';

describe('usePaymentMethodAvailability', () => {
  it('hides Klump even when stale saved settings or selection enable it', () => {
    const result = usePaymentMethodAvailability({
      enabledMethods: ['klump'],
      methodDisabledReasons: {},
      orderTotal: 100000,
      selectedMethod: 'klump',
      selectedTab: 'installments',
    });
    expect(result.filteredMethods).toEqual([]);
    expect(result.hasBNPLMethods).toBe(false);
    expect(result.availableMethodIds).not.toContain('klump');
  });

  it('returns the available method ids across tabs after enabled and hidden filters', () => {
    const result = usePaymentMethodAvailability({
      enabledMethods: ['invoice', 'payforme', 'klump'],
      hiddenMethods: ['payforme'],
      methodDisabledReasons: {},
      orderTotal: 100000,
      selectedMethod: 'invoice',
      selectedTab: 'pay_later',
    });

    expect(result.availableMethodIds).toEqual(['invoice']);
  });

  it('respects explicit methodDisabledReasons overrides', () => {
    const result = usePaymentMethodAvailability({
      enabledMethods: ['paystack'],
      methodDisabledReasons: { paystack: 'Temporarily unavailable' },
      orderTotal: 100000,
      selectedMethod: 'paystack',
      selectedTab: 'full',
    });

    const paystack = result.filteredMethods.find(
      (method) => method.id === 'paystack'
    );
    expect(paystack?.disabled).toBe(true);
    expect(paystack?.disabledReason).toBe('Temporarily unavailable');
  });
});
