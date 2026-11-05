import { getMerchantForApiRequest } from '@/lib/get-merchant-for-api-request';
import { createClient } from '@/lib/supabase/server';
import { requireExperienceOwner } from './authorization';
export async function resolveExperienceOwnerRequest(merchantId: string) {
  const client = await createClient();
  const auth = await client.auth.getUser();
  if (auth.error || !auth.data.user) throw Error('NOT_FOUND');
  const merchant = await getMerchantForApiRequest(client, auth.data.user.id, {
    requestedMerchantId: merchantId,
  });
  if (!merchant?.staffAccess.isOwner || merchant.merchantId !== merchantId)
    throw Error('NOT_FOUND');
  return requireExperienceOwner({ supabase: client, merchantId });
}
