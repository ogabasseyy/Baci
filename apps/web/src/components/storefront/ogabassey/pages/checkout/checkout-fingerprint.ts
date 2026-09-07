import type { PendingCheckoutFingerprintInput } from './pending-checkout-order';
import { getMerchantRateId } from './delivery-quote-utils';

function normalizeText(value: string | null | undefined): string {
  return (value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeVariantAttributes(attributes?: Record<string, string>) {
  if (!attributes) return undefined;

  return Object.fromEntries(
    Object.entries(attributes)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, normalizeText(value)])
  );
}

export function buildPendingCheckoutFingerprint(
  input: PendingCheckoutFingerprintInput
): string {
  const normalizedItems = [...input.items]
    .map((item) => ({
      product_id: item.product_id,
      name: normalizeText(item.name),
      quantity: item.quantity,
      price: item.price,
      variantId: item.variantId || undefined,
      variantAttributes: normalizeVariantAttributes(item.variantAttributes),
      has_assurance: Boolean(item.has_assurance),
      assurance_fee: item.assurance_fee || 0,
    }))
    .sort((left, right) =>
      `${left.product_id}:${left.variantId || ''}:${left.name}`.localeCompare(
        `${right.product_id}:${right.variantId || ''}:${right.name}`
      )
    );

  // Merchant door rates share null provider + often the same fee; their stable
  // `mrate_<uuid>` selection must distinguish fingerprints. Carrier quote UUIDs
  // still refresh after gateway navigation and stay omitted.
  const merchantRateId = input.selectedQuoteId
    ? getMerchantRateId(input.selectedQuoteId)
    : null;

  return JSON.stringify({
    merchantId: input.merchantId,
    customerEmail: normalizeText(input.customerEmail),
    customerName: normalizeText(input.customerName),
    customerPhone: normalizeText(input.customerPhone),
    deliveryMethod: input.deliveryMethod,
    shippingFee: input.shippingFee,
    shippingProvider: normalizeText(input.shippingProvider),
    merchantRateId,
    shippingAddress: {
      address: normalizeText(input.shippingAddress.address),
      city: normalizeText(input.shippingAddress.city),
      state: normalizeText(input.shippingAddress.state),
      phone: normalizeText(input.shippingAddress.phone),
    },
    items: normalizedItems,
    useWalletCredit: input.useWalletCredit,
    walletAmountUsed: input.walletAmountUsed,
    discountCode: normalizeText(input.discountCode) || null,
  });
}
