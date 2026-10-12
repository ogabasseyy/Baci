import type { SupabaseClient } from '@supabase/supabase-js';
import { throwIfStrictVtuLookupError } from '@/lib/vtu-strict-lookups';

/**
 * Links an email-matched guest customer row to the auth user and
 * confirms the write in the same round trip (update + select id).
 * Fail closed: history only shows rows whose user_id equals the
 * caller, so a silently unlinked row would vend into invisible
 * history. A link error is indeterminate — 5xx under strict, null
 * otherwise (self-heals on retry via the byUserId hit if the link
 * actually landed). A zero-row match means the row vanished
 * mid-checkout or a concurrent email claim won the race —
 * definitive miss, null in both modes. Extracted from
 * vtu-pending-transaction.ts per the Boy Scout Rule.
 */
export async function linkVtuCustomerByEmail<
  T extends { id: string; user_id: string | null },
>({
  byEmail,
  strictLookups = false,
  supabase,
  userId,
}: {
  byEmail: T;
  strictLookups?: boolean;
  supabase: SupabaseClient;
  userId: string;
}): Promise<(T & { user_id: string }) | null> {
  const { data: linked, error: linkError } = await supabase
    .from('customers')
    .update({ user_id: userId })
    .eq('id', byEmail.id)
    // Atomic claim: the resolver read user_id=null in an earlier
    // SELECT, so without this guard two concurrent checkouts for two
    // auth accounts sharing an email both UPDATE — the second steals
    // the link while the first still transacts as the row. The loser
    // now matches zero rows and fails closed. No merchant scope: id
    // is the primary key.
    .is('user_id', null)
    .select('id')
    .maybeSingle();

  if (linkError) {
    throwIfStrictVtuLookupError({
      context: 'look up VTU customer',
      error: linkError,
      strictLookups,
    });
    return null;
  }
  if (!linked) {
    return null;
  }
  return { ...byEmail, user_id: userId };
}
