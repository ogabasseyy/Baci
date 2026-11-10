import type { SupabaseClient } from '@supabase/supabase-js';
/** Unknown/error is not a legacy-mode permission. Staff receive metadata only. */
export async function readExperienceAuthoringMode(
  client: SupabaseClient,
  merchantId: string
): Promise<'legacy' | 'full-code' | 'unavailable'> {
  try {
    const r = await client.rpc('experience_authoring_mode_for_merchant', {
      p_merchant: merchantId,
    });
    return !r.error && (r.data === 'legacy' || r.data === 'full-code')
      ? r.data
      : 'unavailable';
  } catch {
    return 'unavailable';
  }
}
