import type { SupabaseClient } from '@supabase/supabase-js';
import { sanitizeForLog } from '@/lib/sanitize-core';

export async function resolveMerchantIdBySlug(
  merchantSlug: string,
  supabase: Pick<SupabaseClient, 'from'>
) {
  const { data: merchant, error } = await supabase
    .from('merchants')
    .select('id')
    .eq('slug', merchantSlug)
    .single();

  if (error || !merchant) {
    console.debug('[API/Orders] Failed to resolve merchant slug', {
      merchantSlug: sanitizeForLog(merchantSlug),
      error: error?.message ? sanitizeForLog(error.message) : null,
    });
    return null;
  }

  return merchant.id;
}
