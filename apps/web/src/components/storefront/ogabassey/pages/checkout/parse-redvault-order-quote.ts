import type { RedvaultQuoteSummary } from './components/redvault/RedvaultPaymentOption';

export function parseRedvaultOrderQuote(
  response: unknown
): RedvaultQuoteSummary {
  if (!response || typeof response !== 'object' || !('redvault' in response)) {
    throw new Error('Unable to confirm REDVAULT savings for this order');
  }
  const redvault = response.redvault;
  if (!redvault || typeof redvault !== 'object' || !('quote' in redvault)) {
    throw new Error('Unable to confirm REDVAULT savings for this order');
  }
  const quote = redvault.quote;
  if (!quote || typeof quote !== 'object') {
    throw new Error('Unable to confirm REDVAULT savings for this order');
  }
  function money(key: string): number {
    const value: unknown = Reflect.get(quote as object, key);
    if (
      typeof value !== 'number' ||
      !Number.isSafeInteger(value) ||
      value < 0
    ) {
      throw new Error('Invalid or incomplete REDVAULT summary amount');
    }
    return value;
  }
  if (!('mixed_basket' in quote) || typeof quote.mixed_basket !== 'boolean') {
    throw new Error('Incomplete REDVAULT summary');
  }
  const productSubtotalKobo = money('product_subtotal_kobo');
  const eligibleSubtotalKobo = money('eligible_subtotal_kobo');
  const ineligibleSubtotalKobo = money('ineligible_subtotal_kobo');
  const discountKobo = money('discount_kobo');
  const assuranceFeeKobo = money('assurance_fee_kobo');
  const taxKobo = money('tax_kobo');
  const shippingKobo = money('shipping_kobo');
  const giftWrappingKobo = money('gift_wrapping_kobo');
  const payableKobo = money('payable_kobo');
  const expectedPayableKobo =
    productSubtotalKobo -
    discountKobo +
    assuranceFeeKobo +
    taxKobo +
    shippingKobo +
    giftWrappingKobo;

  if (
    productSubtotalKobo !== eligibleSubtotalKobo + ineligibleSubtotalKobo ||
    discountKobo > eligibleSubtotalKobo ||
    !Number.isSafeInteger(expectedPayableKobo) ||
    payableKobo !== expectedPayableKobo ||
    quote.mixed_basket !== (ineligibleSubtotalKobo > 0)
  ) {
    throw new Error('Inconsistent REDVAULT summary');
  }

  return {
    productSubtotalKobo,
    eligibleSubtotalKobo,
    ineligibleSubtotalKobo,
    discountKobo,
    assuranceFeeKobo,
    taxKobo,
    shippingKobo,
    giftWrappingKobo,
    payableKobo,
    mixedBasket: quote.mixed_basket,
  };
}
