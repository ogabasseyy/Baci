import { supabase } from '@/lib/supabase';
import type { NegotiationCardRequest } from './NegotiationCard';

// Module-scope helpers keep try/throw out of the component body so React
// Compiler can memoize the screen (try/finally + throw-in-try are bailouts).
export async function loadNegotiationRequests(
  merchantId: string
): Promise<NegotiationCardRequest[]> {
  // NOTE: `negotiation_requests` has no top-level `current_price` column —
  // selecting it returns a 400 ("column does not exist") and breaks the whole
  // screen. The pre-offer price lives in `item_info.current_price` (single-item
  // offers only); whole-cart "total" offers carry no per-item price. Derive the
  // display price from item_info so the query stays valid.
  const { data, error } = await supabase
    .from('negotiation_requests')
    .select(
      'id, customer_id, type, status, offered_price, item_info, cart_snapshot, customer_email, customer_phone, counter_offer, created_at, evidence_url'
    )
    .eq('merchant_id', merchantId)
    .order('created_at', { ascending: false });

  if (error) throw error;

  const userIds = [
    ...new Set((data ?? []).map((row) => row.customer_id).filter(Boolean)),
  ];
  const guestEmails = [
    ...new Set(
      (data ?? [])
        .filter((row) => !row.customer_id && row.customer_email)
        .map((row) => row.customer_email)
    ),
  ];
  const [profiles, guests] = await Promise.all([
    userIds.length
      ? supabase
          .from('customers')
          .select('user_id, full_name, first_name, last_name')
          .eq('merchant_id', merchantId)
          .in('user_id', userIds)
      : { data: [], error: null },
    guestEmails.length
      ? supabase
          .from('customers')
          .select('email, full_name, first_name, last_name')
          .eq('merchant_id', merchantId)
          .in('email', guestEmails)
      : { data: [], error: null },
  ]);
  if (profiles.error) throw profiles.error;
  if (guests.error) throw guests.error;
  const guestNames = new Map(
    (guests.data ?? []).map((profile) => [
      profile.email,
      profile.full_name?.trim() ||
        [profile.first_name, profile.last_name]
          .filter(Boolean)
          .join(' ')
          .trim(),
    ])
  );
  const names = new Map(
    (profiles.data ?? []).map((profile) => [
      profile.user_id,
      profile.full_name?.trim() ||
        [profile.first_name, profile.last_name]
          .filter(Boolean)
          .join(' ')
          .trim(),
    ])
  );
  return (data ?? []).map((row) => ({
    ...row,
    customer_name:
      (row.customer_id
        ? names.get(row.customer_id)
        : guestNames.get(row.customer_email)) || null,
    // cart_snapshot is arbitrary client-supplied JSONB; coerce anything that
    // isn't an array to null so one malformed row can't crash the list on .map.
    cart_snapshot: Array.isArray(row.cart_snapshot) ? row.cart_snapshot : null,
    current_price: row.item_info?.current_price ?? null,
  })) as NegotiationCardRequest[];
}
