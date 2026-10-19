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
 * fix stays unspendable. Either Supabase-confirmed identifier
 * opens the authoritative user_id lookup: verified-email sessions
 * AND verified-phone sessions (phone-auth storefront logins carry
 * no email; the session route links their customer row by user_id
 * via claim_customer_on_phone_auth — Codex R116 P1). The EMAIL
 * fallback still requires a verified email: a phone-confirmed
 * session with an unverified address attached must never link or
 * spend as that address's row. Every caller already fails closed
 * on null.
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
  const emailVerified = Boolean(user.email_confirmed_at && user.email);
  const phoneVerified = Boolean(user.phone_confirmed_at && user.phone);
  if (!emailVerified && !phoneVerified) {
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

  // The email fallback needs a VERIFIED email — not just a claim. A
  // phone-verified session carrying an unverified address must not
  // link or spend as that address's row.
  if (!emailVerified || !user.email) {
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
