import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { StorefrontLayoutJobInput } from '@/schemas/ai-jobs';

const receiptSchema = z.object({
  id: z.uuid(),
  merchant_id: z.uuid(),
  type: z.literal('storefront_layout_generation'),
  status: z.literal('pending'),
  created_at: z.string(),
});
export async function enqueueNativeLayout(
  client: SupabaseClient,
  merchantId: string,
  input: StorefrontLayoutJobInput
) {
  const { data, error } = await client.rpc('builder_private_enqueue', {
    p_merchant_id: merchantId,
    p_slug: input.pageSlug,
    p_input: input,
  });
  if (error) return { data: null, error: { code: error.code } };
  const parsed = receiptSchema.safeParse(data);
  if (!parsed.success || parsed.data.merchant_id !== merchantId)
    return { data: null, error: { code: 'INVALID_PRIVATE_JOB_RECEIPT' } };
  return { data: { ...parsed.data, input }, error: null };
}
