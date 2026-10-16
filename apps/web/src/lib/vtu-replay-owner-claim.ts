import type { SupabaseClient } from '@supabase/supabase-js';
import type { authenticateApiRequest } from '@/lib/api-auth';
import { linkVtuCustomerByEmail } from '@/lib/vtu-customer-link';

type ReplayAuthUser = NonNullable<
  Awaited<ReturnType<typeof authenticateApiRequest>>['user']
>;

/**
 * Claims the replay owner for fulfillment (Muse R128 MEDIUM).
 *
 * The wallet-only fresh path links the customer before recording the
 * key row, but legacy/manual key rows can reference an unlinked guest
 * customer. Ownership resolution returns such a row for its verified
 * email owner (linkEmailMatch:false by R86 — resolution must not link
 * before the replay guards reject), so without this step a replay
 * would debit a row never bound to the caller — and the replay
 * overlay would silently no-op on it (its RPC requires
 * customers.user_id = auth.uid()), vending against stale
 * phone/reference.
 *
 * Call AFTER all replay guards pass, BEFORE the overlay: linked rows
 * short-circuit on one indexed read; unlinked rows are claimed
 * atomically (linkVtuCustomerByEmail matches user_id IS NULL and
 * accepts only a same-user race winner). Null = vanished row, row
 * owned by someone else, or an unverified-email caller — the route
 * must 400 (fail closed, force a fresh key), never fulfill.
 */
export async function claimReplayCustomerOwner({
  customerId,
  supabase,
  user,
}: {
  customerId: string;
  supabase: SupabaseClient;
  user: ReplayAuthUser;
}): Promise<{ id: string; user_id: string } | null> {
  const { data: row, error } = await supabase
    .from('customers')
    .select('id, email, user_id')
    .eq('id', customerId)
    .maybeSingle();

  if (error || !row) {
    return null;
  }
  if (row.user_id) {
    return row.user_id === user.id
      ? (row as { id: string; user_id: string })
      : null;
  }
  // Unlinked replay owner: only the verified-email owner may claim
  // (mirrors resolveVtuCustomer's email-fallback gate — a
  // phone-verified session carrying an unverified address must not
  // link or spend as that address's row).
  if (!user.email_confirmed_at || !user.email || row.email !== user.email) {
    return null;
  }
  return linkVtuCustomerByEmail({
    byEmail: { id: row.id, user_id: null },
    strictLookups: true,
    supabase,
    userId: user.id,
  });
}
