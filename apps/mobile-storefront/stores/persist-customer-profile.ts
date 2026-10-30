import { supabase } from '@/lib/supabase';
import { WalletProfileNamesSchema } from '@/schemas/wallet-profile-names';
import { CUSTOMER_SELECT_COLUMNS } from './auth-customer-schema-compat';

export async function persistCustomerProfile(input: {
  customerId: string;
  merchantId: string;
  userId: string;
  updates: Record<string, unknown>;
}) {
  const hostedSandbox =
    process.env.EXPO_PUBLIC_HOSTED_STOREFRONT === '1' &&
    process.env.EXPO_PUBLIC_API_URL === 'https://staging.ogabassey.com' &&
    process.env.EXPO_PUBLIC_SUPABASE_URL ===
      'https://staging-auth.ogabassey.com';
  if (
    hostedSandbox &&
    Object.keys(input.updates).sort().join(',') === 'first_name,last_name' &&
    typeof input.updates.first_name === 'string' &&
    typeof input.updates.last_name === 'string'
  ) {
    const names = WalletProfileNamesSchema.parse(input.updates);
    return await supabase.rpc('set_customer_wallet_profile', {
      p_merchant_id: input.merchantId,
      p_expected_user_id: input.userId,
      p_first_name: names.first_name,
      p_last_name: names.last_name,
    });
  }
  if (
    hostedSandbox &&
    Object.keys(input.updates).length === 1 &&
    typeof input.updates.phone === 'string'
  ) {
    return await supabase.rpc('set_customer_wallet_phone', {
      p_merchant_id: input.merchantId,
      p_expected_user_id: input.userId,
      p_phone: input.updates.phone,
    });
  }
  return await supabase
    .from('customers')
    .update(input.updates)
    .eq('id', input.customerId)
    .eq('merchant_id', input.merchantId)
    .select(CUSTOMER_SELECT_COLUMNS)
    .single();
}
