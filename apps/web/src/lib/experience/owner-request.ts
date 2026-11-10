import { getMerchantForApiRequest } from '@/lib/get-merchant-for-api-request';
import { createClient } from '@/lib/supabase/server';
import { requireExperienceOwner } from './authorization';
export async function authenticateExperienceOwnerRequest() {
  const client = await createClient();
  const auth = await client.auth.getUser();
  if (auth.error || !auth.data.user) throw Error('NOT_FOUND');
  const userId = auth.data.user.id;
  return async (merchantId: string) => {
    const merchant = await getMerchantForApiRequest(client, userId, {
      requestedMerchantId: merchantId,
    });
    if (!merchant?.staffAccess.isOwner || merchant.merchantId !== merchantId)
      throw Error('NOT_FOUND');
    return requireExperienceOwner({ supabase: client, merchantId });
  };
}
export async function resolveExperienceOwnerRequest(merchantId: string) {
  const resolveOwner = await authenticateExperienceOwnerRequest();
  return resolveOwner(merchantId);
}
