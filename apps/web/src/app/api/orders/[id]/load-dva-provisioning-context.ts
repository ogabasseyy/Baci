import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';

type DvaProvisioningContext =
  | { ok: true; payableAmount: number }
  | { code: string; error: string; ok: false; status: number };

export async function loadDvaProvisioningContext({
  merchantId,
  orderId,
  supabase,
}: {
  merchantId: string;
  orderId: string;
  supabase: SupabaseClient<Database>;
}): Promise<DvaProvisioningContext> {
  const { data: settings, error: settingsError } = await supabase
    .from('merchant_feature_settings')
    .select('paystack_enabled')
    .eq('merchant_id', merchantId)
    .maybeSingle();

  if (settingsError) {
    return {
      code: 'FEATURE_SETTINGS_LOOKUP_FAILED',
      error: 'Unable to verify Paystack availability',
      ok: false,
      status: 500,
    };
  }
  if (settings?.paystack_enabled === false) {
    return {
      code: 'GATEWAY_DISABLED',
      error: 'Paystack is not enabled for this merchant',
      ok: false,
      status: 400,
    };
  }

  const { data: payableAmount, error: refreshError } = await supabase.rpc(
    'refresh_paystack_order_payable_amount',
    { p_order_id: orderId }
  );
  if (refreshError) {
    return {
      code: 'PAYMENT_ACCOUNT_REFRESH_FAILED',
      error: 'Unable to refresh the automatic confirmation balance',
      ok: false,
      status: 500,
    };
  }

  return payableAmount !== null && payableAmount > 0
    ? { ok: true, payableAmount }
    : {
        code: 'NO_PAYABLE_AMOUNT',
        error: 'No payable amount remains for this order',
        ok: false,
        status: 400,
      };
}
