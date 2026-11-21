import { expect, it } from 'vitest';
import { checkoutDeliveryFormFields } from './checkout-delivery-form-fields';

it('passes the persisted delivery quote and its provider selection through to delivery', () => {
  const values = {
    selectedQuoteId: 'quote',
    selectedProviderRateId: 'rate',
    deliveryMethod: 'delivery',
    customerEmail: 'buyer@example.com',
  } as unknown as Parameters<typeof checkoutDeliveryFormFields>[0];
  expect(checkoutDeliveryFormFields(values)).toMatchObject({
    persistedSelectedQuoteId: 'quote',
    persistedSelectedProviderRateId: 'rate',
    deliveryMethod: 'delivery',
    customerEmail: 'buyer@example.com',
  });
});
