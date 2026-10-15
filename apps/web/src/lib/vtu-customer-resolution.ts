import type { SupabaseClient, User } from '@supabase/supabase-js';
import { linkVtuCustomerByEmail } from '@/lib/vtu-customer-link';
import { throwIfStrictVtuLookupError } from '@/lib/vtu-strict-lookups';

export interface CustomerRecord {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  user_id: string | null;
}

/**
 * Resolves the merchant customer row for an auth user: exact match on
 * `user_id`, else an unlinked email match (linked on the spot unless
 * `linkEmailMatch` is false), else null. An email match linked to a
 * DIFFERENT auth user returns null (tenant isolation — every caller
 * fails closed).
 *
 * Read-only mode exists for pre-guard resolution (the replay path
 * resolves ownership BEFORE the customer/merchant/fingerprint guards
 * run): linking there would write customers.user_id before a
 * mismatched replay is rejected. The unlinked row is returned as-is
 * so the guard can still compare ids (Codex R86 P1).
 *
 * Unverified sessions resolve to null (Muse R109 HIGH): the email
 * claim alone proves nothing — an account carrying a victim's
 * address must never link or spend as their guest row — and the
 * gate covers the byUserId hit too, so a row claimed before this
 * fix stays unspendable. Mirrors resolvePrimaryWalletIdentity's
 * `email_confirmed_at` gate: app logins (email OTP, Google, Apple)
 * always verify, so no legit session changes behavior, and the
 * gate holds under either hosted-confirmation setting. Every
 * caller already fails closed on null.
 *
 * Extracted from `vtu-pending-transaction.ts` per the 300-line Boy
 * Scout Rule (Codex R63 6ruGlr); the preparation module re-exports
 * this, so existing callers are untouched.
 */
export async function resolveVtuCustomer({
  supabase,
  merchantId,
  linkEmailMatch = true,
  strictLookups = false,
  user,
}: {
  supabase: SupabaseClient;
  merchantId: string;
  /**
   * Link an unlinked email match on the spot. False = read-only:
   * return the row unlinked (pre-guard replay resolution).
   */
  linkEmailMatch?: boolean;
  /** Strict policy (see vtu-strict-lookups): throw instead of null. */
  strictLookups?: boolean;
  user: User;
}) {
  if (!user.email_confirmed_at || !user.email) {
    return null;
  }
  const { data: byUserId, error: byUserIdError } = await supabase
    .from('customers')
    .select('id, email, first_name, last_name, phone, user_id')
    .eq('merchant_id', merchantId)
    .eq('user_id', user.id)
    .maybeSingle();
  throwIfStrictVtuLookupError({
    context: 'look up VTU customer',
    error: byUserIdError,
    strictLookups,
  });

  if (byUserId) {
    return byUserId as CustomerRecord;
  }

  if (!user.email) {
    return null;
  }

  const { data: byEmail, error: byEmailError } = await supabase
    .from('customers')
    .select('id, email, first_name, last_name, phone, user_id')
    .eq('merchant_id', merchantId)
    .eq('email', user.email)
    .maybeSingle();
  throwIfStrictVtuLookupError({
    context: 'look up VTU customer',
    error: byEmailError,
    strictLookups,
  });

  if (byEmail && !byEmail.user_id) {
    if (!linkEmailMatch) {
      return byEmail as CustomerRecord;
    }
    return linkVtuCustomerByEmail({
      byEmail,
      strictLookups,
      supabase,
      userId: user.id,
    });
  }

  // Tenant isolation: an email-matched row linked to a DIFFERENT auth
  // user must never be returned — every caller would otherwise transact
  // as that customer (all callers fail closed on null). The email claim
  // alone cannot distinguish the owner from an account squatting on an
  // unverified address.
  if (byEmail?.user_id && byEmail.user_id !== user.id) {
    return null;
  }

  return (byEmail as CustomerRecord | null) ?? null;
}
