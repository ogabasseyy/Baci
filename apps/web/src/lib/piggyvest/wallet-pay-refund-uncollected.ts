import 'server-only';
import type { WalletPayDeliverer } from './wallet-pay-drain';
import { refundWalletPayment, walletPayDelivery } from './wallet-pay-service';

/**
 * Drain deliverer for a product that can not deliver without the customer
 * (an IMEI check needs the identifier, which is never stored in plain text):
 * a confirmed payment nobody collected is failed under the drain's claim,
 * which opens exactly one refund, and the refund is sent. A customer who
 * comes back later sees the refunded outcome.
 */
export const refundUncollectedPayment: WalletPayDeliverer = async ({
  runtime,
  operationId,
  claimToken,
}) => {
  const answer = await walletPayDelivery(runtime).finish(
    operationId,
    'failed',
    claimToken
  );
  if (answer !== 'refund_owed' && answer !== 'duplicate')
    throw new Error('Uncollected payment could not be failed');
  await refundWalletPayment({ runtime, paymentId: operationId });
};
