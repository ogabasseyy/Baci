import 'server-only';
import type { BankCardOffer } from '@/schemas/bank-card-offer';
import { calculateBankCardOfferDiscount } from './calculate-bank-card-offer-discount';

type CatalogLine = {
  itemId: string;
  productId: string;
  unitPriceKobo: number;
  quantity: number;
};

const BANK_CARD_OFFER_MAX_ALLOCATION_UNITS = 10_000;

function safeAmount(amount: bigint) {
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Bank offer subtotal exceeds the safe integer range');
  }
  return Number(amount);
}

/** The caller must pass merchant-scoped catalog lines, priced on the server. */
export function quoteBankCardOffer({
  offer,
  merchantId,
  items,
  now,
}: {
  offer: BankCardOffer;
  merchantId: string;
  items: readonly CatalogLine[];
  now: number;
}) {
  const startsAt = Date.parse(offer.startsAt);
  const endsAt = Date.parse(offer.endsAt);
  if (
    !offer.enabled ||
    offer.merchantId !== merchantId ||
    !Number.isFinite(now) ||
    !Number.isFinite(startsAt) ||
    !Number.isFinite(endsAt) ||
    now < startsAt ||
    now >= endsAt
  ) {
    return null;
  }

  const eligibleProducts = new Set(
    offer.eligibleProductIds.map((id) => id.toLowerCase())
  );
  const itemIds = new Set<string>();
  let units = 0;
  let productSubtotal = 0n;
  let eligibleSubtotal = 0n;
  for (const item of items) {
    if (!item.itemId.trim() || itemIds.has(item.itemId)) {
      throw new Error('Bank offer item IDs must be nonempty and unique');
    }
    itemIds.add(item.itemId);
    if (
      !Number.isSafeInteger(item.quantity) ||
      item.quantity < 1 ||
      item.quantity > BANK_CARD_OFFER_MAX_ALLOCATION_UNITS - units
    ) {
      throw new Error('Bank offer quantity is outside the allocation limit');
    }
    if (!Number.isSafeInteger(item.unitPriceKobo) || item.unitPriceKobo < 0) {
      throw new Error(
        'Bank offer unit price must be a nonnegative kobo amount'
      );
    }
    units += item.quantity;
    const subtotal = BigInt(item.unitPriceKobo) * BigInt(item.quantity);
    productSubtotal += subtotal;
    if (eligibleProducts.has(item.productId.toLowerCase()))
      eligibleSubtotal += subtotal;
  }

  const productSubtotalKobo = safeAmount(productSubtotal);
  const eligibleSubtotalKobo = safeAmount(eligibleSubtotal);
  const discount = calculateBankCardOfferDiscount(
    eligibleSubtotal,
    offer.discountBasisPoints,
    offer.maximumDiscountKobo
  );
  // Bank offers require a positive merchandise balance, even when delivery
  // or other fees would leave a nonzero amount to charge.
  if (discount === 0n || discount >= productSubtotal) return null;

  // Unit discounts are differences between rounded cumulative shares. The
  // final share divides eligibleSubtotal * discount by eligibleSubtotal,
  // so those differences add up to the exact capped discount.
  let eligibleValue = 0n;
  let allocatedDiscount = 0n;
  const allocations = items.map((item) => {
    const eligible = eligibleProducts.has(item.productId.toLowerCase());
    const unitNetAmountsKobo = Array.from({ length: item.quantity }, () => {
      if (!eligible) return item.unitPriceKobo;
      eligibleValue += BigInt(item.unitPriceKobo);
      // For an odd divisor there is no exact half remainder. Adding its
      // floor rounds up only once the integer remainder exceeds half.
      const next =
        (eligibleValue * discount + eligibleSubtotal / 2n) / eligibleSubtotal;
      const unitDiscount = next - allocatedDiscount;
      allocatedDiscount = next;
      return item.unitPriceKobo - Number(unitDiscount);
    });
    return {
      ...item,
      productId: item.productId.toLowerCase(),
      unitNetAmountsKobo,
    };
  });

  return {
    merchantId,
    approvedTermsReference: offer.approvedTermsReference,
    endsAt: offer.endsAt,
    paymentPolicy: {
      partnership: offer.id,
      bankCode: offer.bankCode,
      issuerName: offer.verifiedIssuerName,
      cardBrands: [...offer.cardBrands],
    },
    productSubtotalKobo,
    eligibleSubtotalKobo,
    discountKobo: Number(discount),
    allocations,
  };
}
