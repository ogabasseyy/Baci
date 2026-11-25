import { usePaymentMethodAvailability } from './usePaymentMethodAvailability';

describe('usePaymentMethodAvailability', () => {
  it('flags installments unavailable below BNPL minimum', () => {
    const result = usePaymentMethodAvailability({
      enabledMethods: ['klump'],
      methodDisabledReasons: {},
      orderTotal: 5000,
      selectedMethod: 'klump',
      selectedTab: 'installments',
    });

    const klump = result.filteredMethods.find(
      (method) => method.id === 'klump'
    );
    expect(result.isBNPLEligible).toBe(false);
    expect(klump?.disabled).toBe(true);
    expect(klump?.disabledReason).toContain('Minimum order');
  });

  it('keeps klump enabled when partial wallet credit leaves net payable within bounds', () => {
    const result = usePaymentMethodAvailability({
      enabledMethods: ['klump'],
      methodDisabledReasons: {},
      orderTotal: 100000,
      selectedMethod: 'klump',
      selectedTab: 'installments',
      walletSelection: { amount: 10000, use: true },
    });

    const klump = result.filteredMethods.find(
      (method) => method.id === 'klump'
    );
    expect(result.isBNPLEligible).toBe(true);
    expect(klump?.disabled).toBeUndefined();
    expect(klump?.disabledReason).toBeUndefined();
  });

  it('keeps klump enabled when partial savings credit leaves net payable within bounds', () => {
    const result = usePaymentMethodAvailability({
      enabledMethods: ['klump'],
      methodDisabledReasons: {},
      orderTotal: 100000,
      savingsSelection: {
        amount: 5000,
        goalId: 'goal-1',
        use: true,
      },
      selectedMethod: 'klump',
      selectedTab: 'installments',
    });

    const klump = result.filteredMethods.find(
      (method) => method.id === 'klump'
    );
    expect(result.isBNPLEligible).toBe(true);
    expect(klump?.disabled).toBeUndefined();
    expect(klump?.disabledReason).toBeUndefined();
  });

  it('disables installment financing when wallet credit covers 100% of the order', () => {
    const result = usePaymentMethodAvailability({
      enabledMethods: ['klump'],
      methodDisabledReasons: {},
      orderTotal: 100000,
      selectedMethod: 'klump',
      selectedTab: 'installments',
      walletSelection: { amount: 100000, use: true },
    });

    const klump = result.filteredMethods.find(
      (method) => method.id === 'klump'
    );
    expect(result.isBNPLEligible).toBe(false);
    expect(klump?.disabled).toBe(true);
    expect(klump?.disabledReason).toBe(
      'No payable balance remains for installment financing'
    );
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

    expect(result.availableMethodIds).toEqual(['klump', 'invoice']);
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

  it('keeps Klump available at the maximum order amount boundary', () => {
    const result = usePaymentMethodAvailability({
      enabledMethods: ['klump'],
      methodDisabledReasons: {},
      orderTotal: 1_000_000,
      selectedMethod: 'klump',
      selectedTab: 'installments',
    });

    const klump = result.filteredMethods.find(
      (method) => method.id === 'klump'
    );
    expect(klump).toBeDefined();
    expect(klump?.disabled).not.toBe(true);
    expect(result.hasBNPLMethods).toBe(true);
  });

  it('does not hide Klump from disabled reason wording alone', () => {
    const result = usePaymentMethodAvailability({
      enabledMethods: ['klump'],
      methodDisabledReasons: { klump: 'Maximum order: copy changed' },
      orderTotal: 1_000_001,
      selectedMethod: 'klump',
      selectedTab: 'installments',
    });

    const klump = result.filteredMethods.find(
      (method) => method.id === 'klump'
    );
    expect(klump).toBeDefined();
    expect(klump?.disabledReason).toBe('Maximum order: copy changed');
    expect(result.hasBNPLMethods).toBe(true);
  });

  it('removes Klump from installment methods above the maximum order amount', () => {
    const result = usePaymentMethodAvailability({
      enabledMethods: ['klump'],
      hiddenMethods: ['klump'],
      methodDisabledReasons: { klump: 'Maximum order: ₦1,000,000' },
      orderTotal: 1_000_001,
      selectedMethod: 'klump',
      selectedTab: 'installments',
    });

    expect(result.filteredMethods.some((method) => method.id === 'klump')).toBe(
      false
    );
    expect(result.hasBNPLMethods).toBe(false);
  });
});
