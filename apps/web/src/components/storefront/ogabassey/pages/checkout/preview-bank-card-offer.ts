import type { CheckoutOrderItem } from '@/lib/checkout/build-order-items';
import { calculateBankCardOfferDiscount } from '@/lib/checkout/calculate-bank-card-offer-discount';
import type { BrowserBankCardOffer } from '@/lib/checkout/get-browser-bank-card-offers';

export type BankCardOfferSelection = {
  id: string;
  discountKobo: number;
  payableKobo: number;
};

function toKobo(amount: number) {
  const kobo = Math.round(amount * 100);
  return Number.isSafeInteger(kobo) &&
    kobo >= 0 &&
    Math.abs(amount - kobo / 100) < 1e-8
    ? kobo
    : null;
}

export function previewBankCardOffer(
  offer: BrowserBankCardOffer,
  items: readonly CheckoutOrderItem[],
  fees: readonly number[],
  now: number
): BankCardOfferSelection | null {
  if (now < Date.parse(offer.startsAt) || now >= Date.parse(offer.endsAt))
    return null;
  const eligible = new Set(
    offer.eligibleProductIds.map((id) => id.toLowerCase())
  );
  let subtotal = 0n;
  let eligibleSubtotal = 0n;
  let adjustments = 0n;
  let quantity = 0;
  for (const item of items) {
    const price = toKobo(item.price);
    const assurance = toKobo(item.assurance_fee);
    if (
      price === null ||
      assurance === null ||
      item.voucher_token ||
      !Number.isSafeInteger(item.quantity) ||
      item.quantity < 1 ||
      item.quantity > 10_000 - quantity
    )
      return null;

    quantity += item.quantity;
    const lineTotal = BigInt(price) * BigInt(item.quantity);
    subtotal += lineTotal;
    adjustments += BigInt(assurance);
    if (eligible.has(item.product_id.toLowerCase()))
      eligibleSubtotal += lineTotal;
  }
  for (const fee of fees) {
    const kobo = toKobo(fee);
    if (kobo === null) return null;
    adjustments += BigInt(kobo);
  }
  const discount = calculateBankCardOfferDiscount(
    eligibleSubtotal,
    offer.discountBasisPoints,
    offer.maximumDiscountKobo
  );
  const payable = subtotal - discount + adjustments;
  if (
    discount <= 0n ||
    discount >= subtotal ||
    payable > BigInt(Number.MAX_SAFE_INTEGER)
  )
    return null;
  return {
    id: offer.id,
    discountKobo: Number(discount),
    payableKobo: Number(payable),
  };
}
