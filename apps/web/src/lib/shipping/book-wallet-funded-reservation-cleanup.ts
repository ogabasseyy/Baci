import type { SupabaseClient } from '@supabase/supabase-js';
import {
  refundMerchantShippingCharge,
  type reserveMerchantShippingCharge,
} from './merchant-shipping-charge';

type ReleaseLock = () => Promise<void>;
export type WalletChargeReservation = Awaited<
  ReturnType<typeof reserveMerchantShippingCharge>
>;

/**
 * Detect reserved or provider_submitting charges so reserve/recovery runs
 * before quote refresh (active submissions block quote replacement).
 * Uses a staff-authorized SECURITY DEFINER projection — table RLS alone is
 * owner-scoped for SELECT and staff retries would otherwise miss the charge.
 */
export async function hasActiveMerchantShippingCharge(
  supabase: SupabaseClient,
  orderId: string,
  quoteId: string
): Promise<boolean | null> {
  if (typeof supabase.rpc !== 'function') return false;
  try {
    const result = await supabase.rpc('has_active_merchant_shipping_charge', {
      p_order_id: orderId,
      p_quote_id: quoteId,
    });
    if (!result || typeof result !== 'object') return null;
    const typed = result as {
      data?: unknown;
      error?: { message?: string } | null;
    };
    if (typed.error) return null;
    return typed.data === true;
  } catch {
    return null;
  }
}

export async function cleanupPreSubmissionReservation(
  supabase: SupabaseClient,
  reservation: WalletChargeReservation,
  reasonCode: string,
  releaseLock?: ReleaseLock
): Promise<void> {
  try {
    await refundMerchantShippingCharge(
      supabase,
      reservation.charge.chargeId,
      reservation.token,
      reasonCode
    );
  } catch {
    console.error('Wallet shipping refund failed during cleanup.');
  }
  if (releaseLock) {
    try {
      await releaseLock();
    } catch {
      console.error('Booking lock release failed during cleanup.');
    }
  }
}
