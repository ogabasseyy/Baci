/**
 * Fail-safe allow-list of order payment methods verified to route the GIG
 * shipping fee to Baci (Paystack split card, Korapay, UBA RedVault split,
 * Baci-held invoice/payforme DVA, Juicyway, Klump, internal credit). Any other
 * method -- credit_direct, oxygen, bank_transfer, pod, cash, manual, imports,
 * unknown or future providers -- books from the merchant shipping wallet.
 * Mirrors private.is_non_retaining_checkout_payment_method (20261109180000).
 * Adding a method requires evidence it records retained_shipping_amount.
 */
const GIGL_SHIPPING_RETAINING_PAYMENT_METHODS: ReadonlySet<string> = new Set([
  'card',
  'paystack',
  'korapay',
  'uba_redvault',
  'invoice',
  'payforme',
  'juicyway',
  'klump',
  'wallet',
  'savings',
  'store_credit',
]);

export function isGiglShippingRetainingPaymentMethod(
  paymentMethod: string | null | undefined
): boolean {
  return GIGL_SHIPPING_RETAINING_PAYMENT_METHODS.has(
    (paymentMethod ?? '').trim().toLowerCase()
  );
}
