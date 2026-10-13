import type { SupabaseClient } from '@supabase/supabase-js';

export async function purgeOrphanedJumiaAuthorizations(
  supabase: SupabaseClient
): Promise<number> {
  const { data, error } = await supabase.rpc(
    'purge_orphaned_jumia_authorizations'
  );

  if (error) {
    throw new Error(
      `Failed to purge orphaned Jumia authorizations: ${error.message}`
    );
  }

  return typeof data === 'number' ? data : 0;
}
