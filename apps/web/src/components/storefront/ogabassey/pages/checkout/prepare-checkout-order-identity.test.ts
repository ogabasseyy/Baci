import { expect, it } from 'vitest';
import type { CheckoutOrderItem } from '@/lib/checkout/build-order-items';
import { prepareCheckoutOrderIdentity } from './prepare-checkout-order-identity';

const items: CheckoutOrderItem[] = [
  {
    product_id: 'phone-1',
    name: 'Test phone',
    quantity: 1,
    price: 1000,
    value: 1000,
    has_assurance: true,
    assurance_fee: 50,
    variantId: 'blue-128',
    variantAttributes: { color: 'Blue', storage: '128GB' },
  },
];

const identityInput = {
  merchantId: 'merchant-1',
  customerEmail: 'buyer@example.test',
  customerName: 'Ada Okon',
  customerPhone: '+2348031234567',
  deliveryMethod: 'door' as const,
  shippingFee: 500,
  shippingProvider: 'GIGL',
  selectedQuoteId: 'mrate_rate-1',
  shippingAddress: {
    address: '12 Broad Street',
    city: 'Lagos Island',
    state: 'Lagos',
    phone: '+2348031234567',
  },
  items,
  useWalletCredit: true,
  walletAmountUsed: 300,
  discountCode: 'SAVE10',
  giftWrappingCost: 100,
};

it('normalizes gateway identity while preserving the complete order item projection', () => {
  const prepared = prepareCheckoutOrderIdentity({
    ...identityInput,
    paymentMethod: 'korapay',
  });

  expect(prepared.normalizedPaymentMethod).toBe('card');
  expect(prepared.items).toEqual(items);
  expect(JSON.parse(prepared.checkoutFingerprint)).toMatchObject({
    merchantRateId: 'rate-1',
    items: [{ variantId: 'blue-128', has_assurance: true, assurance_fee: 50 }],
    discountCode: 'save10',
    walletAmountUsed: 300,
    giftWrappingCost: 100,
  });
  expect(
    prepareCheckoutOrderIdentity({
      ...identityInput,
      paymentMethod: 'paystack',
    }).checkoutFingerprint
  ).toBe(prepared.checkoutFingerprint);
});

it('keeps Redvault identities fenced from card methods for the same checkout data', () => {
  const ordinary = prepareCheckoutOrderIdentity({
    ...identityInput,
    paymentMethod: 'paystack',
  });
  const redvault = prepareCheckoutOrderIdentity({
    ...identityInput,
    paymentMethod: 'uba_redvault',
  });

  expect(redvault.normalizedPaymentMethod).toBe('uba_redvault');
  expect(redvault.checkoutFingerprint).toBe(
    `uba_redvault:${ordinary.checkoutFingerprint}`
  );
});
