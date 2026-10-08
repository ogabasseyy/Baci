import 'server-only';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { piggyvestPrimaryWalletIdentitySchema } from '@/schemas/piggyvest-primary-wallet-onboarding';

export async function resolvePrimaryWalletIdentity(input: {
  supabase: SupabaseClient;
  user: User;
  merchantId: string;
}) {
  if (!input.user.email_confirmed_at || !input.user.email) return null;
  const { data, error } = await input.supabase
    .from('customers')
    .select('id, merchant_id, user_id, email, first_name, last_name, phone')
    .eq('merchant_id', input.merchantId)
    .eq('user_id', input.user.id)
    .maybeSingle();
  if (error || !data) return null;
  if (
    data.merchant_id !== input.merchantId ||
    data.user_id !== input.user.id ||
    typeof data.email !== 'string' ||
    data.email.toLowerCase() !== input.user.email.toLowerCase()
  )
    return null;
  const identity = piggyvestPrimaryWalletIdentitySchema.safeParse({
    merchantId: input.merchantId,
    customerId: data.id,
    userId: input.user.id,
    email: input.user.email.toLowerCase(),
    emailVerified: true,
    name: [data.first_name, data.last_name]
      .filter((part): part is string => typeof part === 'string')
      .join(' '),
    phone: data.phone,
  });
  return identity.success ? identity.data : null;
}
