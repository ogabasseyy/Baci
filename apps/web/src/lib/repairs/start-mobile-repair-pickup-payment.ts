import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { reconcileMobileRepairPickupPayment } from '@/lib/repairs/reconcile-mobile-repair-pickup-payment';
import { createRepairPickupReceiverClient } from '@/lib/repairs/repair-pickup-receiver-client';
import { startRepairPickupPayment } from '@/lib/repairs/start-repair-pickup-payment';
import type { StartRepairPickupPaymentInput } from '@/lib/repairs/start-repair-pickup-payment-types';
import { mobileRepairPickupReceiptSchema } from '@/schemas/mobile-repair-pickup-receipt';

export async function startMobileRepairPickupPayment(
  input: StartRepairPickupPaymentInput & { requestId: string }
) {
  const { requestId, ...paymentInput } = input;
  const args = {
    p_merchant_id: input.merchantId,
    p_request_id: requestId,
    p_request_hash: createHash('sha256')
      .update(JSON.stringify(paymentInput))
      .digest('hex'),
    p_owner: randomUUID(),
  };
  async function receipt(result?: unknown) {
    // Re-sign after provider work: the scoped JWT has a short lifetime.
    const client = createRepairPickupReceiverClient(
      input.merchantId,
      new Date(),
      'server-payment-start'
    );
    const response = await client.rpc(
      'mobile_repair_pickup_payment_receipt_v2',
      {
        ...args,
        p_result: result ?? null,
      }
    );
    if (response.error)
      throw new Error(
        'Could not recover pickup payment. Retry the same request shortly.'
      );
    return mobileRepairPickupReceiptSchema.parse(response.data);
  }
  const claimed = await receipt();
  if (claimed.state === 'complete') return claimed.result;
  if (claimed.state === 'unknown')
    return reconcileMobileRepairPickupPayment(claimed.result, input.merchantId);
  if (claimed.state !== 'claimed')
    throw new Error(
      'Pickup payment is still being reconciled. Retry status shortly or contact the store; do not start another repair.'
    );
  const begun = await createRepairPickupReceiverClient(
    input.merchantId,
    new Date(),
    'server-payment-start'
  ).rpc('begin_mobile_repair_pickup_payment', args);
  if (begun.error || begun.data !== true)
    throw new Error(
      'Pickup payment claim changed. Retry the same request shortly.'
    );
  const result = await startRepairPickupPayment({
    ...paymentInput,
    onPaymentInitializationStarted: async (checkpoint) => {
      const saved = await receipt(checkpoint);
      if (saved.state !== 'unknown')
        throw new Error('Could not preserve payment recovery.');
    },
  });
  const completed = await receipt(result);
  if (completed.state !== 'complete' && completed.state !== 'unknown')
    throw new Error('Pickup payment recovery is pending. Retry shortly.');
  return completed.result;
}
