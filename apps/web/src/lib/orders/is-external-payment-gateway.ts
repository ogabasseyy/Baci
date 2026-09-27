const INTERNAL_PAYMENT_GATEWAYS = new Set([
  'wallet',
  'savings',
  'store_credit',
  'cash',
  'manual',
  'pay_on_delivery',
]);

export function isExternalPaymentGateway(gateway: string | null): boolean {
  return !gateway || !INTERNAL_PAYMENT_GATEWAYS.has(gateway);
}
