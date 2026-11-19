import 'server-only';
import { REDVAULT_MAX_ALLOCATION_UNITS_PER_QUOTE } from '@baci/shared/contracts';
import type { BankCardOffer } from '@/schemas/bank-card-offer';

type CatalogLine = {
  itemId: string;
  productId: string;
  unitPriceKobo: number;
  quantity: number;
};

const BASIS_POINTS = 10_000n;

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

  const eligibleProducts = new Set(offer.eligibleProductIds);
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
      item.quantity > REDVAULT_MAX_ALLOCATION_UNITS_PER_QUOTE - units
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
    if (eligibleProducts.has(item.productId)) eligibleSubtotal += subtotal;
  }

  const productSubtotalKobo = safeAmount(productSubtotal);
  const eligibleSubtotalKobo = safeAmount(eligibleSubtotal);
  const roundedDiscount =
    (eligibleSubtotal * BigInt(offer.discountBasisPoints) + BASIS_POINTS / 2n) /
    BASIS_POINTS;
  const cap = BigInt(offer.maximumDiscountKobo);
  const discount = roundedDiscount < cap ? roundedDiscount : cap;
  if (discount === 0n || discount >= productSubtotal) return null;

  // Allocate against running eligible value so the stored unit discounts sum
  // to the capped total, including when the proportion contains half a kobo.
  let eligibleValue = 0n;
  let allocatedDiscount = 0n;
  const allocations = items.map((item) => {
    const eligible = eligibleProducts.has(item.productId);
    const unitNetAmountsKobo = Array.from({ length: item.quantity }, () => {
      if (!eligible) return item.unitPriceKobo;
      eligibleValue += BigInt(item.unitPriceKobo);
      const next =
        (eligibleValue * discount + eligibleSubtotal / 2n) / eligibleSubtotal;
      const unitDiscount = next - allocatedDiscount;
      allocatedDiscount = next;
      return item.unitPriceKobo - Number(unitDiscount);
    });
    return { ...item, unitNetAmountsKobo };
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
