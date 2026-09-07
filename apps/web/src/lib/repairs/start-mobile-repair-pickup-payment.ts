import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
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
    const response = await client.rpc('mobile_repair_pickup_payment_receipt', {
      ...args,
      p_result: result ?? null,
    });
    if (response.error)
      throw new Error(
        'Could not recover pickup payment. Retry the same request shortly.'
      );
    return mobileRepairPickupReceiptSchema.parse(response.data);
  }
  const claimed = await receipt();
  if (claimed.state === 'complete') return claimed.result;
  if (claimed.state !== 'claimed')
    throw new Error(
      'Pickup payment is still being reconciled. Retry status shortly or contact the store; do not start another repair.'
    );
  // The claim has no expiry/reclaim path: a lost provider outcome cannot safely be repeated.
  const result = await startRepairPickupPayment(paymentInput);
  const completed = await receipt(result);
  if (completed.state !== 'complete')
    throw new Error('Pickup payment recovery is pending. Retry shortly.');
  return completed.result;
}
