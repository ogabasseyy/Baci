import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';

export interface LoyaltyManualRecord {
  id: string;
  points_balance: number | null;
  lifetime_points: number | null;
  current_tier: string | null;
}

const MAX_CREATE_ATTEMPTS = 5;
const UNIQUE_VIOLATION = '23505';

const RECORD_COLUMNS = 'id, points_balance, lifetime_points, current_tier';

// referral_code is varchar(20); the mint fills it.
function mintReferralCode(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 20).toUpperCase();
}

// Create a customer_loyalty row for manual awards, retrying referral-code
// collisions like the enrollment RPC: the case-insensitive unique index
// can reject a blindly generated code. The probe avoids the exception
// path in the common case; on a unique violation the row is re-read, so
// a concurrent enrollment or purchase award that created it first is
// adopted instead of surfacing a 500. Returns null when creation fails.
export async function createLoyaltyRecordWithRetry(
  supabase: SupabaseClient<Database>,
  merchantId: string,
  customerId: string
): Promise<LoyaltyManualRecord | null> {
  for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt += 1) {
    const referralCode = mintReferralCode();

    const { data: clash } = await supabase
      .from('customer_loyalty')
      .select('id')
      .eq('merchant_id', merchantId)
      .eq('referral_code', referralCode)
      .maybeSingle();
    if (clash) {
      continue;
    }

    const { data, error } = await supabase
      .from('customer_loyalty')
      .insert({
        customer_id: customerId,
        merchant_id: merchantId,
        points_balance: 0,
        lifetime_points: 0,
        referral_code: referralCode,
      })
      .select(RECORD_COLUMNS)
      .single();
    if (!error) {
      return data;
    }
    if (error.code !== UNIQUE_VIOLATION) {
      console.error('Error creating loyalty record:', error);
      return null;
    }

    const { data: existing } = await supabase
      .from('customer_loyalty')
      .select(RECORD_COLUMNS)
      .eq('merchant_id', merchantId)
      .eq('customer_id', customerId)
      .maybeSingle();
    if (existing) {
      return existing;
    }
  }

  console.error('Loyalty record creation exhausted referral-code retries');
  return null;
}
