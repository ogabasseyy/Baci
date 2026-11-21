import { expect, it } from '@jest/globals';
import { usePaymentMethodAvailability } from './usePaymentMethodAvailability';

it('keeps the server-enabled checkout methods when device savings is off', () => {
  const availability = usePaymentMethodAvailability({
    enabledMethods: ['paystack', 'korapay', 'klump'],
    methodDisabledReasons: {},
    orderTotal: 198_000,
    selectedMethod: 'klump',
    selectedTab: 'installments',
  });

  expect(availability.availableMethodIds).toEqual(['paystack', 'klump']);
  expect(availability.filteredMethods).toEqual([
    expect.objectContaining({ id: 'klump' }),
  ]);
  expect(availability.filteredMethods[0].disabled).not.toBe(true);
});
