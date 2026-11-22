import { beforeEach, expect, it, jest } from '@jest/globals';
import { deferredBankOfferCart } from '@/lib/deferred-bank-offer-cart';
import { useCartStore } from '@/stores/cart-store';
import { captureSubmittedCheckoutCart } from './capture-submitted-checkout-cart';

jest.mock('@/lib/deferred-bank-offer-cart', () => ({
  deferredBankOfferCart: { capture: jest.fn() },
}));
jest.mock('@/stores/cart-store', () => ({
  useCartStore: { getState: jest.fn() },
}));

const originalItem = { id: 'line-1', quantity: 1 };
const originalCart = {
  checkoutGeneration: 'generation-1',
  cartWideNegotiationActive: false,
  items: [originalItem],
};

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(useCartStore.getState).mockReturnValue(originalCart as never);
});

it('keeps the submitted items and Paystack cart identity after the live cart changes', () => {
  jest.mocked(deferredBankOfferCart.capture).mockReturnValueOnce('original');
  const submitted = captureSubmittedCheckoutCart('paystack');
  jest.mocked(useCartStore.getState).mockReturnValue({
    ...originalCart,
    checkoutGeneration: 'generation-2',
    items: [{ id: 'line-2', quantity: 2 }],
  } as never);

  expect(submitted).toEqual({
    checkoutCartIdentity: 'original',
    checkoutGenerationSnapshot: 'generation-1',
    groupNegotiationSnapshot: false,
    itemsSnapshot: [originalItem],
  });
  expect(submitted.itemsSnapshot).not.toBe(originalCart.items);
});

it('leaves cleanup unauthorized when checkout has no usable cart identity', () => {
  jest.mocked(deferredBankOfferCart.capture).mockReturnValueOnce(null);
  expect(
    captureSubmittedCheckoutCart('paystack').checkoutCartIdentity
  ).toBeNull();
});

it('preserves submitted quantities and variant attributes after an in-place live cart edit', () => {
  const liveItem = {
    ...originalItem,
    variant_attributes: { storage: '128GB' },
  };
  jest.mocked(useCartStore.getState).mockReturnValue({
    ...originalCart,
    items: [liveItem],
  } as never);
  const submitted = captureSubmittedCheckoutCart('paystack');

  liveItem.quantity = 2;
  liveItem.variant_attributes.storage = '256GB';

  expect(submitted.itemsSnapshot).toEqual([
    { ...originalItem, variant_attributes: { storage: '128GB' } },
  ]);
});

it.each([
  'korapay',
  'uba_redvault',
  null,
] as const)('does not capture a bank-offer cart for %s', (paymentMethod) => {
  expect(
    captureSubmittedCheckoutCart(paymentMethod).checkoutCartIdentity
  ).toBeNull();
  expect(deferredBankOfferCart.capture).not.toHaveBeenCalled();
});
