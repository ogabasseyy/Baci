import type { SupabaseClient } from '@supabase/supabase-js';
import type { CustomerRecord } from '@/lib/vtu-customer-resolution';

/**
 * Typed wrappers for the Phase 2 (epic #3694) checkout RPCs: customer
 * find/link and the settings projection. Identity is verified
 * inside the RPCs against the JWT — errors are 500-class (key kept)
 * and deliberately match none of the user-facing whitelist entries.
 * Transport-error messages mirror the old client-side resolver
 * ('Failed to look up VTU customer: ...') so logs stay comparable.
 */

export async function findCheckoutCustomerId(
  supabase: SupabaseClient,
  merchantId: string,
  userId: string
): Promise<string | null> {
  const { data, error } = await supabase.rpc('find_vtu_customer_for_checkout', {
    p_merchant_id: merchantId,
    p_user_id: userId,
  });
  if (error) {
    throw new Error(`Failed to look up VTU customer: ${error.message}`);
  }
  return data ?? null;
}

export async function linkCheckoutCustomerByEmail(
  supabase: SupabaseClient,
  merchantId: string,
  userId: string
): Promise<CustomerRecord | null> {
  const { data, error } = await supabase.rpc('link_vtu_customer_by_email', {
    p_merchant_id: merchantId,
    p_user_id: userId,
  });
  if (error) {
    throw new Error(`Failed to look up VTU customer: ${error.message}`);
  }
  const row = data?.[0];
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    email: row.email,
    first_name: row.first_name,
    last_name: row.last_name,
    phone: row.phone,
    user_id: row.user_id,
  };
}

/** All-null settings: the non-strict lookup-failure fallback. Every
 * flag reads as unset, so callers land on the VTU-disabled check. */
export const EMPTY_VTU_CHECKOUT_SETTINGS: VtuCheckoutSettings = {
  vtu_enabled: null,
  vtu_airtime_enabled: null,
  vtu_data_enabled: null,
  vtu_electricity_enabled: null,
  vtu_tv_enabled: null,
  vtu_betting_enabled: null,
  vtu_merchant_commission_rate: null,
  vtu_customer_cashback_enabled: null,
  vtu_customer_cashback_rate: null,
  paystack_enabled: null,
  korapay_enabled: null,
};

export interface VtuCheckoutSettings {
  vtu_enabled: boolean | null;
  vtu_airtime_enabled: boolean | null;
  vtu_data_enabled: boolean | null;
  vtu_electricity_enabled: boolean | null;
  vtu_tv_enabled: boolean | null;
  vtu_betting_enabled: boolean | null;
  vtu_merchant_commission_rate: number | null;
  vtu_customer_cashback_enabled: boolean | null;
  vtu_customer_cashback_rate: number | null;
  paystack_enabled: boolean | null;
  korapay_enabled: boolean | null;
}

/**
 * Membership-gated settings projection. Returns null for zero rows
 * (not-a-member OR no settings row — the caller resolves identity
 * before deciding between the customer 404 and VTU-disabled).
 * Throws the raw transport message; the caller adds lookup context
 * (strict policy) so the prefix is never doubled.
 */
export async function getVtuCheckoutSettings(
  supabase: SupabaseClient,
  merchantId: string,
  userId: string
): Promise<VtuCheckoutSettings | null> {
  const { data, error } = await supabase.rpc('get_vtu_checkout_settings', {
    p_merchant_id: merchantId,
    p_user_id: userId,
  });
  if (error) {
    throw new Error(error.message);
  }
  return data?.[0] ?? null;
}
