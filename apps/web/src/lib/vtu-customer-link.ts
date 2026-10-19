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
 * mid-checkout or a concurrent email claim won the race — so
 * re-read: when the winner linked the row to THIS same user (two
 * overlapping checkouts for one account), accept it — returning
 * null would 400 before the idempotency-key race, the client would
 * forget the shared key, and the retry would mint fresh and charge
 * twice (Codex R54 6rrFRL). A different user's claim (or a vanished
 * row) stays a definitive miss, null in both modes. Extracted from
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
    // Lost the atomic-claim race (or the row vanished): re-read and
    // accept only a same-user link (see docblock). No merchant
    // scope: id is the primary key, matching the update above.
    const { data: current, error: rereadError } = await supabase
      .from('customers')
      .select('id, email, first_name, last_name, phone, user_id')
      .eq('id', byEmail.id)
      .maybeSingle();
    if (rereadError) {
      throwIfStrictVtuLookupError({
        context: 'look up VTU customer',
        error: rereadError,
        strictLookups,
      });
      return null;
    }
    if (current?.user_id === userId) {
      return current as T & { user_id: string };
    }
    return null;
  }
  return { ...byEmail, user_id: userId };
}
