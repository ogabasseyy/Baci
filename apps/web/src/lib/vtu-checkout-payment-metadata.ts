import { piggyvestPaymentSourceMetadata } from '@/lib/vtu-piggyvest-wallet-paid';

/**
 * How a prepared VTU row is paid, as persisted in its metadata.
 *
 * - `paymentSource` (PiggyVest wallet only): the row is paid from the
 *   PiggyVest main wallet and vended only under that payment's delivery
 *   claim (vtu-piggyvest-wallet-paid).
 * - `paymentSplit`: written ONLY for checkout-sourced rows whenever
 *   walletAmount > 0 (including the wallet-only case where wallet ===
 *   amount and card === 0). Phase B.5's debit hook in
 *   fulfillPendingVtuTransaction reads `paymentSplit.wallet > 0` as the
 *   signal to call redeem_vtu_wallet_payment (skipped for PiggyVest rows),
 *   and the intent claim's funding gate requires it.
 *
 * Source gate: non-checkout flows (loyalty_reward / gift / direct /
 * storefront_modal) settle via different paths and the refund helper would
 * skip a non-checkout row, leaving any debit stranded. The schema enforces
 * this at the API boundary (`walletAmount is only valid for checkout-sourced
 * purchases`) and the fulfillment debit gate at the money-movement layer;
 * this keeps the persisted metadata coherent with both.
 */
export function checkoutPaymentMetadata(input: {
  source: string;
  paymentMethod?: 'store_credit' | 'piggyvest_wallet';
  walletAmount?: number;
  purchaseAmount: number;
}) {
  return {
    ...piggyvestPaymentSourceMetadata(input.source, input.paymentMethod),
    ...(input.source === 'checkout' &&
    input.walletAmount &&
    input.walletAmount > 0
      ? {
          paymentSplit: {
            wallet: input.walletAmount,
            card: input.purchaseAmount - input.walletAmount,
          },
        }
      : {}),
  };
}
