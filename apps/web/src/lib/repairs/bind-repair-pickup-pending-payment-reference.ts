import { createRepairPickupReceiverClient } from '@/lib/repairs/repair-pickup-receiver-client';

/** Persists the generated RPU reference on an awaiting unpaid pickup before Paystack init. */
export async function bindRepairPickupPendingPaymentReference(options: {
  merchantId: string;
  reference: string;
  repairId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = createRepairPickupReceiverClient(options.merchantId);
  const { data, error } = await supabase.rpc(
    'bind_repair_pickup_pending_payment_reference',
    {
      p_merchant_id: options.merchantId,
      p_reference: options.reference,
      p_repair_id: options.repairId,
    }
  );

  if (error) {
    console.error(
      'Bind repair pickup pending payment reference failed:',
      error
    );
    return {
      ok: false,
      error:
        'We could not prepare pickup payment for this request. Please try again shortly.',
    };
  }

  const row = Array.isArray(data) ? data[0] : data;
  const bound =
    row && typeof row === 'object' && 'bound' in row
      ? Boolean((row as { bound: unknown }).bound)
      : Boolean(row);

  if (!bound) {
    return {
      ok: false,
      error:
        'We could not prepare pickup payment for this request. Please try again shortly.',
    };
  }

  return { ok: true };
}
