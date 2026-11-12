import 'server-only';
import type { WalletPayPurpose } from '@/schemas/piggyvest-wallet-pay';
import type { WalletPayDeliverer } from './wallet-pay-drain';
import { refundUncollectedPayment } from './wallet-pay-refund-uncollected';

/**
 * Per-product handlers the wallet pay drain uses for confirmed payments
 * nobody collected. A product without one is skipped (its payment waits, and
 * the daily report lists it). Products register here as they are wired.
 */
export const WALLET_PAY_DELIVERERS: Partial<
  Record<WalletPayPurpose, WalletPayDeliverer>
> = {
  // An IMEI check needs the identifier the customer re-sends; it is never
  // stored in plain text, so an uncollected paid check is refunded.
  imei_check: refundUncollectedPayment,
};
