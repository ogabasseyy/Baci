import { supabase } from '@/lib/supabase';

const CUSTOMER_SEARCH_FIELDS = [
  'first_name',
  'last_name',
  'email',
  'phone',
] as const;

/** Upper bound so a very common term cannot build an oversized URL filter. */
export const MAX_MATCHED_CUSTOMER_IDS = 50;

function escapeIlikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

function quoteFilterValue(value: string): string {
  return `"${value.replace(/[\\"]/g, '\\$&')}"`;
}

/**
 * Orders keep a snapshot of the name typed at checkout, which can differ from
 * the customer's profile (e.g. "Johnathan" vs "Jonathan"). Find the merchant's
 * customer profiles that match the search so their orders match too.
 */
export async function findCustomerIdsMatchingSearch(
  merchantId: string,
  searchTerm: string
): Promise<string[]> {
  const pattern = quoteFilterValue(`%${escapeIlikePattern(searchTerm)}%`);
  const filter = CUSTOMER_SEARCH_FIELDS.map(
    (field) => `${field}.ilike.${pattern}`
  ).join(',');

  const { data, error } = await supabase
    .from('customers')
    .select('id')
    .eq('merchant_id', merchantId)
    .or(filter)
    .limit(MAX_MATCHED_CUSTOMER_IDS);

  if (error) {
    // Profile matching only widens results; order-field search still works.
    console.warn('Customer profile search failed for orders list', {
      message: error.message,
    });
    return [];
  }

  return (data ?? [])
    .map((row: { id: unknown }) => row.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
}
