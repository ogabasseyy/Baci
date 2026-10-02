import { normalizePaymentGateway } from '@/lib/payments/normalize-payment-gateway';

const INTERNAL_PAYMENT_GATEWAYS = new Set([
  'WALLET',
  'SAVINGS',
  'STORE_CREDIT',
  'CASH',
  'MANUAL',
  'PAY_ON_DELIVERY',
]);

export function isExternalPaymentGateway(gateway: string | null): boolean {
  // Legacy internal-payment rows may pad or re-case the gateway
  // (`Wallet`, ` wallet `): normalize before the set lookup so they are
  // not mistaken for external legs. Missing or blank gateways stay
  // external, as before.
  const normalized = normalizePaymentGateway(gateway);
  return normalized === '' || !INTERNAL_PAYMENT_GATEWAYS.has(normalized);
}
