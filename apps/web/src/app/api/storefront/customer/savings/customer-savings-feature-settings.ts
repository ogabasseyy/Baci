import type { SupabaseClient } from '@supabase/supabase-js';

// Leaf copy of the savings feature-settings lookup for routes that must not
// import `./shared`: shared.ts transitively reaches the service credential
// authority (vtu/kuda debug chain), which the event-pipeline boundary forbids
// for new API import graphs. Keep the RPC name, arguments, and mapping
// identical to getCustomerSavingsFeatureSettings in ./shared.ts.
interface FeatureSettingsRow {
  customer_device_savings_auto_debit_enabled?: boolean | null;
  customer_device_savings_enabled?: boolean | null;
  paystack_enabled?: boolean | null;
}

export async function getPrimaryCustomerSavingsFeatureSettings({
  customerId,
  merchantId,
  supabase,
}: {
  customerId: string;
  merchantId: string;
  supabase: SupabaseClient;
}) {
  const { data, error } = await supabase.rpc(
    'get_customer_savings_feature_settings',
    {
      p_customer_id: customerId,
      p_merchant_id: merchantId,
    }
  );

  if (error) {
    throw error;
  }

  const row = (Array.isArray(data) ? data[0] : null) as FeatureSettingsRow | null;
  const settings = row ?? {};
  return {
    autoDebitEnabled:
      settings.customer_device_savings_auto_debit_enabled === true,
    paystackEnabled: settings.paystack_enabled !== false,
    savingsEnabled: settings.customer_device_savings_enabled === true,
  };
}
