import { supabase } from '@/lib/supabase';

/**
 * Whether open provider-refund evidence (or a failed check) should suppress
 * the manual-refund offer at confirm time: money may already have moved, so
 * only the neutral cancel is safe. Uses the normal authenticated client and
 * the merchant-safe wrapper over the refund manager's evidence gate.
 */
export async function refundEvidenceBlocksChoice(
  orderId: string
): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc(
      'order_has_unresolved_refund_evidence',
      { p_order_id: orderId }
    );
    return Boolean(error) || data !== false;
  } catch {
    return true;
  }
}
