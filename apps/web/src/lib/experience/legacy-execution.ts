import type { SupabaseClient } from '@supabase/supabase-js';
import { experienceId } from '@/schemas/experience-id';
/** Normal RLS client; admission and mode entry share the website transaction lock. */
export async function admitLegacyExecution(
  client: SupabaseClient,
  merchantId: string
) {
  const started = await client.rpc('experience_begin_legacy_execution', {
    p_merchant: merchantId,
  });
  if (started.error || !experienceId.safeParse(started.data).success)
    throw Error('LEGACY_EXECUTION_DENIED');
  const lease = started.data as string;
  let acknowledged = false;
  return async () => {
    if (acknowledged) return;
    const ended = await client.rpc('experience_complete_legacy_execution', {
      p_merchant: merchantId,
      p_lease: lease,
    });
    if (ended.error || ended.data !== true)
      throw Error('LEGACY_ACKNOWLEDGEMENT_REQUIRED');
    acknowledged = true;
  };
}
