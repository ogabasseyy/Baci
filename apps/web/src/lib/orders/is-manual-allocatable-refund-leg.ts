import { normalizeRefundMoneyField } from './normalize-refund-money-field';

const MANUAL_ALLOCATABLE_GATEWAYS = new Set([
  'STORE_CREDIT',
  'CASH',
  'MANUAL',
  'PAY_ON_DELIVERY',
]);

/**
 * Cash-like legs the merchant covers with manual refund rows. Mirrors
 * the aggregate claim's internal-leg set exactly: wallet/savings legs
 * reverse through their own ledgers and stay out, and missing or
 * blank gateways stay external, as before.
 */
export function isManualAllocatableRefundLeg(gateway: unknown): boolean {
  return MANUAL_ALLOCATABLE_GATEWAYS.has(normalizeRefundMoneyField(gateway));
}
