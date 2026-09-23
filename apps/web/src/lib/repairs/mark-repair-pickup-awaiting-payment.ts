import { createRepairPickupReceiverClient } from '@/lib/repairs/repair-pickup-receiver-client';

/** Marks a newly created unpaid pickup as awaiting Paystack confirmation. */
export async function markRepairPickupAwaitingPayment(options: {
  merchantId: string;
  repairId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = createRepairPickupReceiverClient(options.merchantId);
  const { data, error } = await supabase.rpc(
    'mark_repair_pickup_awaiting_payment',
    {
      p_merchant_id: options.merchantId,
      p_repair_id: options.repairId,
    }
  );

  if (error) {
    console.error('Mark repair pickup awaiting payment failed:', error);
    return {
      ok: false,
      error:
        'We could not prepare pickup payment for this request. Please try again shortly.',
    };
  }

  const row = Array.isArray(data) ? data[0] : data;
  const marked =
    row && typeof row === 'object' && 'marked' in row
      ? Boolean((row as { marked: unknown }).marked)
      : Boolean(row);

  if (!marked) {
    return {
      ok: false,
      error:
        'We could not prepare pickup payment for this request. Please try again shortly.',
    };
  }

  return { ok: true };
}
