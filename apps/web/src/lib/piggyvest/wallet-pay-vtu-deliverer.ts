import 'server-only';
import type { WalletPayDeliverer } from './wallet-pay-drain';
import { refundWalletPayment, walletPayDelivery } from './wallet-pay-service';

/**
 * Drain deliverer for airtime, data and bills paid from the PiggyVest
 * wallet. It never vends: the purchase runs only in the customer's own
 * checkout request. It records how the purchase ended, from the database
 * (piggyvest_primary.vtu_wallet_payment_delivery_state): vended = fulfilled;
 * failed (or never sent, which the database closes as failed) = failed under
 * this claim, which opens exactly one refund, and the refund is sent. A vend
 * that may still be in flight is left to the VTU requery; the drain asks
 * again once the claim lapses. A payment that matches no purchase is
 * refunded.
 */
export const settleVtuWalletPayment: WalletPayDeliverer = async ({
  runtime,
  operationId,
  claimToken,
}) => {
  const delivery = walletPayDelivery(runtime);
  const state = await delivery.vtuDeliveryState(operationId);
  if (state === 'processing') return;
  // A confirmed payment with no matching purchase (mismatch) can never be
  // delivered: it is failed under this claim, so its one refund is sent,
  // instead of being retried forever (Muse).
  const outcome = state === 'success' ? 'fulfilled' : 'failed';
  const answer = await delivery.finish(operationId, outcome, claimToken);
  const expected = outcome === 'fulfilled' ? 'fulfilled' : 'refund_owed';
  if (answer !== expected && answer !== 'duplicate')
    throw new Error('VTU wallet payment outcome could not be recorded');
  if (outcome === 'failed')
    await refundWalletPayment({ runtime, paymentId: operationId });
};
