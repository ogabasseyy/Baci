import type { SupabaseClient } from '@supabase/supabase-js';
import { customerSavingsNonpaymentSchemas as schemas } from '@/schemas/customer-savings-nonpayment';

export async function getCustomerSavingsNonpaymentSettings({
  customerId,
  merchantId,
  supabase,
}: {
  customerId: string;
  merchantId: string;
  supabase: SupabaseClient;
}): Promise<{ savingsEnabled: boolean }> {
  try {
    const scope = schemas.settingsInput.parse({ customerId, merchantId });
    const { data, error } = await supabase.rpc(
      'get_customer_savings_feature_settings',
      {
        p_customer_id: scope.customerId,
        p_merchant_id: scope.merchantId,
      }
    );
    if (error) throw new Error('Settings lookup failed');
    const rows = schemas.settingsRows.parse(data);
    return {
      savingsEnabled: rows[0]?.customer_device_savings_enabled === true,
    };
  } catch {
    throw new Error('Unable to read savings settings');
  }
}
