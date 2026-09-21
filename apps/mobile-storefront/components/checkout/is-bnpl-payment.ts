import type { PaymentMethodType } from '@/components/checkout/PaymentMethodSelector';

const BNPL_PAYMENT_METHODS = new Set<PaymentMethodType>([
  'credpal',
  'credit_direct',
  'klump',
]);

export function isBnplPayment(payment: PaymentMethodType): boolean {
  return BNPL_PAYMENT_METHODS.has(payment);
}
