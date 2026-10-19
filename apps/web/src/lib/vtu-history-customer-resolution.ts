import type { SupabaseClient } from '@supabase/supabase-js';
import { withMerchantSlugAliasFallback } from '@/lib/with-merchant-slug-alias-fallback';

export type HistoryMerchantCustomerResolution =
  | { kind: 'ok'; merchantId: string; customerId: string }
  | { kind: 'merchantError' }
  | { kind: 'noMerchant' }
  | { kind: 'customerError' }
  | { kind: 'noCustomer' };

/**
 * Merchant + customer scope for the VTU history GET. The merchant
 * lookup is alias-aware and strict (mirrors checkout): a processing
 * tab open across a store rename polls with the stale slug, and an
 * alias-DB failure is a retryable 500, never a 404 the backfill
 * would treat as terminal. Unverified sessions resolve to noCustomer
 * BEFORE any customer lookup (Muse R150 M2, mirrors checkout's R109
 * gate): the gate covers the byUserId hit too, so a row linked
 * before R109 (or through any unverified path) stays unreadable —
 * history carries prepaid voucher PINs, unspendable must also mean
 * unreadable. Verified email OR verified phone opens the lookup
 * (phone-auth logins carry no email). The customer then resolves by
 * auth user id, then by email — but the email fallback only accepts
 * a row already linked to THIS auth user (tenant isolation: the
 * email claim alone proves nothing, and linking on a GET would let
 * an attacker claim a victim's guest history). Unlinked and
 * mismatched rows resolve to noCustomer (empty list). Extracted
 * from the history route per the Boy Scout Rule.
 */
export async function resolveHistoryMerchantCustomer({
  supabase,
  merchantSlug,
  user,
}: {
  supabase: SupabaseClient;
  merchantSlug: string;
  user: {
    id: string;
    email?: string | null;
    email_confirmed_at?: string | null;
    phone?: string | null;
    phone_confirmed_at?: string | null;
  };
}): Promise<HistoryMerchantCustomerResolution> {
  // Alias-aware (mirrors checkout): a processing tab open across a
  // store rename polls with the stale slug; without the fallback the
  // backfill 404s, treats it as permanent, and never settles. Strict:
  // an alias-DB failure throws (retryable 5xx via the outer catch),
  // never a 404 the backfill would treat as terminal.
  const { data: merchant, error: merchantError } =
    await withMerchantSlugAliasFallback(
      merchantSlug,
      (resolvedSlug) =>
        supabase
          .from('merchants')
          .select('id')
          .eq('slug', resolvedSlug)
          .maybeSingle(),
      { strict: true }
    );

  // A lookup ERROR is indeterminate (retryable), not "not found": a
  // transient DB blip must not present as a permanent 404 either.
  if (merchantError) {
    console.error('Failed to resolve VTU history merchant:', merchantError);
    return { kind: 'merchantError' };
  }

  if (!merchant) {
    return { kind: 'noMerchant' };
  }

  // Verified-identifier gate (Muse R150 M2, mirrors checkout R109):
  // an unverified session reads nothing, even when a row is already
  // linked to its user id — unspendable must mean unreadable while
  // the projection carries prepaid voucher PINs.
  const emailVerified = Boolean(user.email_confirmed_at && user.email);
  const phoneVerified = Boolean(user.phone_confirmed_at && user.phone);
  if (!emailVerified && !phoneVerified) {
    return { kind: 'noCustomer' };
  }

  // Customer lookups are strict like the merchant lookup above: a
  // transient DB blip must 500 (retryable), never present as empty
  // history — pollers would burn their finite retry budget on
  // successful-looking empty responses (Codex R55 6rrMIW).
  const { data: customerByUserId, error: customerByUserIdError } =
    await supabase
      .from('customers')
      .select('id, user_id')
      .eq('merchant_id', merchant.id)
      .eq('user_id', user.id)
      .maybeSingle();

  if (customerByUserIdError) {
    console.error(
      'Failed to resolve VTU history customer by user id:',
      customerByUserIdError
    );
    return { kind: 'customerError' };
  }

  if (customerByUserId) {
    return {
      kind: 'ok',
      merchantId: merchant.id,
      customerId: customerByUserId.id,
    };
  }

  // The email fallback needs a VERIFIED email (Muse R119 MEDIUM):
  // the claim alone proves nothing. Same-user acceptance stays as
  // defense in depth. (Phone-only sessions resolve by user_id
  // above — their rows are linked at session claim — so gating the
  // email fallback cannot lock them out.)
  if (user.email && user.email_confirmed_at) {
    // Keep this GET read-only. VTU checkout resolves and links email-matched
    // customers through resolveVtuCustomer before creating payment rows.
    const { data: customerByEmail, error: customerByEmailError } =
      await supabase
        .from('customers')
        .select('id, user_id')
        .eq('merchant_id', merchant.id)
        .eq('email', user.email)
        .maybeSingle();

    if (customerByEmailError) {
      console.error(
        'Failed to resolve VTU history customer by email:',
        customerByEmailError
      );
      return { kind: 'customerError' };
    }

    // Tenant isolation: the email claim alone proves nothing (a guest
    // row pre-created with this email may belong to someone else, and
    // an attacker can register an unverified account on it), so only
    // a row already linked to THIS auth user is accepted. Unlinked
    // (null) and mismatched rows fall through to the empty list —
    // never link here: first-claimer-wins on a GET would let an
    // attacker permanently claim a victim's guest history.
    if (customerByEmail?.user_id === user.id) {
      return {
        kind: 'ok',
        merchantId: merchant.id,
        customerId: customerByEmail.id,
      };
    }
  }

  return { kind: 'noCustomer' };
}
