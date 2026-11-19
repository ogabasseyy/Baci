import 'server-only';
import type { WalletPayDeliverer } from './wallet-pay-drain';
import { refundWalletPayment, walletPayDelivery } from './wallet-pay-service';

/**
 * Drain deliverer for an IMEI check, which can not be delivered without the
 * customer (the identifier is never stored in plain text). If the check was
 * already saved (a delivery that lost its fulfilment write), the payment is
 * recorded as fulfilled, never refunded. Otherwise the delivery is failed
 * under the drain's claim, which opens exactly one refund, and the refund is
 * sent. A customer who comes back later sees the saved or refunded outcome.
 */
export const refundUncollectedPayment: WalletPayDeliverer = async ({
  runtime,
  operationId,
  claimToken,
}) => {
  const delivery = walletPayDelivery(runtime);
  if (await delivery.isImeiDelivered(operationId)) {
    const answer = await delivery.finish(operationId, 'fulfilled', claimToken);
    if (answer !== 'fulfilled' && answer !== 'duplicate')
      throw new Error('Delivered payment could not be recorded');
    return;
  }
  const answer = await delivery.finish(operationId, 'failed', claimToken);
  if (answer !== 'refund_owed' && answer !== 'duplicate')
    throw new Error('Uncollected payment could not be failed');
  await refundWalletPayment({ runtime, paymentId: operationId });
};
